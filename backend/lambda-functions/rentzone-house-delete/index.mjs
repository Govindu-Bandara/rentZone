import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

async function getConnectionString() {
  if (cachedConnectionString) return cachedConnectionString;
  
  const command = new GetParameterCommand({
    Name: process.env.MONGODB_URI_PARAM,
    WithDecryption: true
  });
  
  const response = await ssmClient.send(command);
  cachedConnectionString = response.Parameter.Value;
  return cachedConnectionString;
}

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  
  const connectionString = await getConnectionString();
  const client = await MongoClient.connect(connectionString);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }
  
  const token = authHeader.substring(7);
  return jwt.verify(token, process.env.JWT_SECRET);
}

// Helper function to send WebSocket notifications (consistent with other functions)
async function sendWebSocketNotification(connectionId, notificationData) {
  try {
    if (!process.env.WEBSOCKET_ENDPOINT) {
      console.log('WebSocket endpoint not configured');
      return false;
    }
    
    const apiGatewayClient = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_ENDPOINT
    });
    
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: 'notification',
        notification: notificationData
      })
    });
    
    await apiGatewayClient.send(command);
    console.log(`✅ WebSocket notification sent to connection: ${connectionId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send WebSocket notification:', error.message);
    return false;
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    if (decoded.role !== 'owner' && decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Only owners and admins can delete house listings',
          message: 'You must be a property owner or admin to delete listings'
        })
      };
    }
    
    const houseId = event.pathParameters?.id;
    
    if (!houseId || !ObjectId.isValid(houseId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid house ID is required' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const bookingsCollection = db.collection('bookings');
    const favoritesCollection = db.collection('favorites');
    const notificationsCollection = db.collection('notifications');
    const sessionsCollection = db.collection('websocket_sessions');
    
    const existingHouse = await housesCollection.findOne({ _id: new ObjectId(houseId) });
    
    if (!existingHouse) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'House not found' })
      };
    }
    
    // Check if user owns this house or is admin (consistent with other functions)
    if (existingHouse.ownerId.toString() !== decoded.userId && decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'You do not have permission to delete this house',
          message: 'Only property owners or admins can delete their own listings'
        })
      };
    }
    
    // Check for active bookings (prevent deletion if there are active/pending bookings)
    const activeBookings = await bookingsCollection.countDocuments({
      houseId: new ObjectId(houseId),
      status: { $in: ['pending', 'confirmed', 'active'] }
    });
    
    if (activeBookings > 0 && decoded.role !== 'admin') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Cannot delete property with active bookings',
          message: 'Please cancel or complete all bookings before deleting the property',
          activeBookings,
          suggestion: 'You can deactivate the listing instead of deleting it'
        })
      };
    }
    
    // For admins, allow deletion but with additional checks
    if (decoded.role === 'admin' && activeBookings > 0) {
      const body = JSON.parse(event.body || '{}');
      const { forceDelete, adminNotes } = body;
      
      if (!forceDelete) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Property has active bookings',
            message: 'Add forceDelete: true in request body to proceed',
            activeBookings,
            warning: 'This will cancel all active bookings for this property'
          })
        };
      }
      
      // Cancel all active bookings
      await bookingsCollection.updateMany(
        {
          houseId: new ObjectId(houseId),
          status: { $in: ['pending', 'confirmed', 'active'] }
        },
        {
          $set: {
            status: 'cancelled',
            cancellationReason: `Property deleted by admin: ${adminNotes || 'No reason provided'}`,
            cancelledBy: new ObjectId(decoded.userId),
            cancelledByEmail: decoded.email,
            cancelledAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
    }
    
    // Soft delete - mark as deleted (consistent with admin-users function)
    const deleteFields = {
      status: 'deleted',
      isActive: false,
      deletedAt: new Date(),
      deletedBy: new ObjectId(decoded.userId),
      deletedByEmail: decoded.email,
      deleteReason: event.body ? JSON.parse(event.body).reason : 'No reason provided',
      updatedAt: new Date()
    };
    
    // Add to audit trail
    deleteFields.auditTrail = existingHouse.auditTrail || [];
    deleteFields.auditTrail.push({
      action: 'delete',
      performedBy: decoded.userId,
      performedByEmail: decoded.email,
      timestamp: new Date(),
      previousStatus: existingHouse.status,
      deleteReason: deleteFields.deleteReason
    });
    
    const result = await housesCollection.findOneAndUpdate(
      { _id: new ObjectId(houseId) },
      { $set: deleteFields },
      { returnDocument: 'after' }
    );
    
    // Remove from favorites collection
    await favoritesCollection.deleteMany({
      houseId: new ObjectId(houseId)
    });
    
    // ========== NOTIFICATION SYSTEM INTEGRATION (Consistent with other functions) ==========
    try {
      // Get owner details
      const owner = await usersCollection.findOne(
        { _id: existingHouse.ownerId },
        { projection: { firstName: 1, lastName: 1, email: 1 } }
      );
      
      // Create notification for owner
      const ownerNotification = {
        userId: existingHouse.ownerId,
        type: 'listing_deleted',
        title: '🗑️ Listing Deleted',
        message: `Your listing "${existingHouse.title}" has been ${decoded.role === 'admin' ? 'removed by admin' : 'deleted'}`,
        data: {
          listingId: existingHouse._id,
          title: existingHouse.title,
          deletedBy: decoded.email,
          deletedAt: new Date(),
          reason: deleteFields.deleteReason,
          adminAction: decoded.role === 'admin',
          cancelledBookings: activeBookings
        },
        isRead: false,
        priority: 'high',
        category: 'listing',
        senderId: new ObjectId(decoded.userId),
        createdAt: new Date(),
        actionUrl: decoded.role === 'admin' ? `/admin/listings/deleted` : `/owner/listings`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };
      
      await notificationsCollection.insertOne(ownerNotification);
      
      // Send real-time WebSocket notification if owner is online
      const ownerSession = await sessionsCollection.findOne({ 
        userId: existingHouse.ownerId, 
        isActive: true 
      });
      
      if (ownerSession) {
        await sendWebSocketNotification(ownerSession.connectionId, {
          _id: new ObjectId().toString(),
          type: 'listing_deleted',
          title: '🗑️ Listing Deleted',
          message: `Your listing "${existingHouse.title}" has been deleted`,
          data: {
            listingId: existingHouse._id.toString(),
            title: existingHouse.title,
            deletedBy: decoded.email,
            adminAction: decoded.role === 'admin'
          },
          isRead: false,
          priority: 'high',
          category: 'listing',
          createdAt: new Date().toISOString(),
          actionUrl: decoded.role === 'admin' ? `/admin/listings/deleted` : `/owner/listings`
        });
      }
      
      // Notify users who had this in favorites
      const favoriteUsers = await favoritesCollection.find({
        houseId: new ObjectId(houseId)
      }).toArray();
      
      if (favoriteUsers.length > 0) {
        const favoriteUserIds = favoriteUsers.map(f => f.userId);
        
        for (const userId of favoriteUserIds) {
          const userNotification = {
            userId,
            type: 'favorite_removed',
            title: '⭐ Favorite Property Removed',
            message: `A property you saved "${existingHouse.title}" is no longer available`,
            data: {
              listingId: existingHouse._id,
              title: existingHouse.title,
              reason: 'Property deleted by owner',
              removedAt: new Date()
            },
            isRead: false,
            priority: 'medium',
            category: 'favorite',
            senderId: existingHouse.ownerId,
            createdAt: new Date(),
            actionUrl: '/renter/favorites',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          };
          
          await notificationsCollection.insertOne(userNotification);
          
          // Send WebSocket notification if user is online
          const userSession = await sessionsCollection.findOne({ 
            userId, 
            isActive: true 
          });
          
          if (userSession) {
            await sendWebSocketNotification(userSession.connectionId, {
              _id: new ObjectId().toString(),
              type: 'favorite_removed',
              title: '⭐ Favorite Property Removed',
              message: `"${existingHouse.title}" is no longer available`,
              data: {
                listingId: existingHouse._id.toString(),
                title: existingHouse.title
              },
              isRead: false,
              priority: 'medium',
              category: 'favorite',
              createdAt: new Date().toISOString(),
              actionUrl: '/renter/favorites'
            });
          }
        }
        
        console.log(`📢 Notified ${favoriteUserIds.length} users who had this property in favorites`);
      }
      
      console.log('📢 Listing deletion notifications sent');
      
    } catch (notificationError) {
      console.error('❌ Listing deletion notification failed:', notificationError);
      // Don't fail the deletion if notifications fail
    }
    // ========== END NOTIFICATION SYSTEM ==========
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'House deleted successfully',
        houseId,
        deletedAt: new Date().toISOString(),
        deletedBy: decoded.email,
        softDelete: true,
        notifications: {
          ownerNotified: true,
          favoritesCleaned: true,
          activeBookingsHandled: activeBookings > 0
        },
        stats: {
          favoritesRemoved: await favoritesCollection.countDocuments({ houseId: new ObjectId(houseId) }),
          bookingsCancelled: activeBookings
        }
      })
    };
    
  } catch (error) {
    console.error('❌ Delete house error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};