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

// Helper function to send WebSocket notifications
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

// Helper function to create notifications
async function createNotification(db, notificationData) {
  try {
    const notificationsCollection = db.collection('notifications');
    const result = await notificationsCollection.insertOne({
      ...notificationData,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    return result.insertedId;
  } catch (error) {
    console.error('❌ Failed to create notification:', error);
    return null;
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'
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
        body: JSON.stringify({ error: 'Only owners and admins can manage bookings' })
      };
    }
    
    const db = await connectToDatabase();
    const bookingsCollection = db.collection('bookings');
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const notificationsCollection = db.collection('notifications');
    const sessionsCollection = db.collection('websocket_sessions');
    
    const ownerId = new ObjectId(decoded.userId);
    
    // GET - Get owner's booking requests
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      const query = { ownerId };
      
      // Filter by status
      if (params.status) {
        query.status = params.status;
      } else {
        // Default: show pending and confirmed bookings
        query.status = { $in: ['pending', 'confirmed', 'active'] };
      }
      
      // Filter by house
      if (params.houseId) {
        query.houseId = new ObjectId(params.houseId);
      }
      
      // Filter by date range
      if (params.startDate && params.endDate) {
        query.createdAt = {
          $gte: new Date(params.startDate),
          $lte: new Date(params.endDate)
        };
      }
      
      // Pagination
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;
      
      // Sorting
      let sort = { createdAt: -1 };
      if (params.sortBy === 'checkin') sort = { checkInDate: 1 };
      if (params.sortBy === 'checkout') sort = { checkOutDate: 1 };
      if (params.sortBy === 'amount') sort = { totalAmount: -1 };
      
      const bookings = await bookingsCollection.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray();
      
      // Enrich with property and renter details
      const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
        const house = await housesCollection.findOne(
          { _id: booking.houseId },
          { projection: { title: 1, images: 1, 'location.address': 1, 'location.city': 1 } }
        );
        
        const renter = await usersCollection.findOne(
          { _id: booking.renterId },
          { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, profileImage: 1 } }
        );
        
        return {
          ...booking,
          property: house ? {
            title: house.title,
            mainImage: house.images?.[0],
            address: house.location?.address,
            city: house.location?.city
          } : null,
          renter: renter ? {
            name: `${renter.firstName} ${renter.lastName}`,
            email: renter.email,
            phone: renter.phone,
            profileImage: renter.profileImage
          } : null
        };
      }));
      
      const total = await bookingsCollection.countDocuments(query);
      
      // Get booking statistics
      const stats = await bookingsCollection.aggregate([
        { $match: { ownerId } },
        { $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalRevenue: {
            $sum: {
              $cond: [{ $in: ["$status", ["confirmed", "active", "completed"]] }, "$totalAmount", 0]
            }
          }
        }}
      ]).toArray();
      
      // Get unread notifications count for bookings
      const unreadBookingNotifications = await notificationsCollection.countDocuments({
        userId: ownerId,
        category: 'booking',
        isRead: false
      });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Owner bookings retrieved successfully',
          bookings: enrichedBookings,
          stats: stats.reduce((acc, stat) => {
            acc[stat._id] = {
              count: stat.count,
              revenue: stat.totalRevenue
            };
            return acc;
          }, {}),
          notifications: {
            unreadCount: unreadBookingNotifications,
            pendingBookings: await bookingsCollection.countDocuments({
              ownerId,
              status: 'pending'
            })
          },
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        })
      };
    }
    
    // PUT - Update booking status (accept/reject/cancel)
    if (event.httpMethod === 'PUT') {
      const bookingId = event.pathParameters?.id;
      
      if (!bookingId || !ObjectId.isValid(bookingId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid booking ID is required' })
        };
      }
      
      const body = JSON.parse(event.body);
      const { action, reason, notes } = body;
      
      // Validate action
      const validActions = ['accept', 'reject', 'cancel', 'complete'];
      if (!validActions.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Invalid action. Must be one of: accept, reject, cancel, complete' 
          })
        };
      }
      
      // Find the booking
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
        ownerId
      });
      
      if (!booking) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Booking not found' })
        };
      }
      
      // Validate state transitions
      const stateTransition = {
        pending: ['accept', 'reject', 'cancel'],
        confirmed: ['cancel', 'active', 'complete'],
        active: ['complete'],
        completed: [],
        cancelled: [],
        rejected: []
      };
      
      if (!stateTransition[booking.status]?.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Cannot ${action} booking with status: ${booking.status}` 
          })
        };
      }
      
      // Prepare update
      const updateFields = {
        updatedAt: new Date()
      };
      
      let newStatus = booking.status;
      let message = '';
      
      switch (action) {
        case 'accept':
          newStatus = 'confirmed';
          updateFields.confirmedAt = new Date();
          updateFields.confirmedBy = ownerId;
          message = 'Booking request accepted';
          break;
          
        case 'reject':
          newStatus = 'rejected';
          updateFields.rejectedAt = new Date();
          updateFields.rejectionReason = reason;
          message = 'Booking request rejected';
          break;
          
        case 'cancel':
          newStatus = 'cancelled';
          updateFields.cancelledAt = new Date();
          updateFields.cancelledBy = ownerId;
          updateFields.cancellationReason = reason;
          message = 'Booking cancelled';
          break;
          
        case 'complete':
          newStatus = 'completed';
          updateFields.completedAt = new Date();
          updateFields.completedBy = ownerId;
          updateFields.completionNotes = notes;
          message = 'Booking marked as completed';
          break;
      }
      
      updateFields.status = newStatus;
      updateFields.statusHistory = booking.statusHistory || [];
      updateFields.statusHistory.push({
        from: booking.status,
        to: newStatus,
        action: action,
        by: ownerId,
        reason: reason,
        notes: notes,
        at: new Date()
      });
      
      // Check for overlapping bookings when accepting
      if (action === 'accept') {
        const overlappingBookings = await bookingsCollection.find({
          _id: { $ne: new ObjectId(bookingId) },
          houseId: booking.houseId,
          status: { $in: ['confirmed', 'active'] },
          $or: [
            {
              checkInDate: { $lte: booking.checkOutDate },
              checkOutDate: { $gte: booking.checkInDate }
            }
          ]
        }).toArray();
        
        if (overlappingBookings.length > 0) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ 
              error: 'Cannot accept booking due to date conflicts with existing bookings',
              conflictingBookings: overlappingBookings.map(b => ({
                id: b._id,
                checkIn: b.checkInDate,
                checkOut: b.checkOutDate,
                status: b.status
              }))
            })
          };
        }
      }
      
      // Update booking
      const result = await bookingsCollection.findOneAndUpdate(
        { _id: new ObjectId(bookingId), ownerId },
        { $set: updateFields },
        { returnDocument: 'after' }
      );
      
      // ========== NOTIFICATION SYSTEM INTEGRATION ==========
      try {
        // Get property details
        const house = await housesCollection.findOne(
          { _id: booking.houseId },
          { projection: { title: 1, images: 1, 'location.address': 1 } }
        );
        
        // Get owner details
        const owner = await usersCollection.findOne(
          { _id: ownerId },
          { projection: { firstName: 1, lastName: 1, email: 1 } }
        );
        
        // Get renter details
        const renter = await usersCollection.findOne(
          { _id: booking.renterId },
          { projection: { firstName: 1, lastName: 1, email: 1 } }
        );
        
        let notificationType, notificationTitle, notificationMessage, notificationEmoji;
        
        switch (action) {
          case 'accept':
            notificationType = 'booking_confirmed';
            notificationTitle = '🎉 Booking Confirmed!';
            notificationMessage = `Your booking request for "${house?.title || 'the property'}" has been approved`;
            notificationEmoji = '✅';
            break;
            
          case 'reject':
            notificationType = 'booking_rejected';
            notificationTitle = '❌ Booking Declined';
            notificationMessage = `Your booking request for "${house?.title || 'the property'}" was declined${reason ? `: ${reason}` : ''}`;
            notificationEmoji = '❌';
            break;
            
          case 'cancel':
            notificationType = 'booking_cancelled';
            notificationTitle = '⚠️ Booking Cancelled';
            notificationMessage = `Your booking for "${house?.title || 'the property'}" has been cancelled${reason ? `: ${reason}` : ''}`;
            notificationEmoji = '⚠️';
            break;
            
          case 'complete':
            notificationType = 'booking_completed';
            notificationTitle = '🏁 Booking Completed';
            notificationMessage = `Your stay at "${house?.title || 'the property'}" has been completed`;
            notificationEmoji = '🏁';
            break;
        }
        
        // 1. Create database notification for renter
        const renterNotification = {
          userId: booking.renterId,
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          data: {
            bookingId: booking._id,
            bookingCode: booking.bookingCode,
            houseId: booking.houseId,
            ownerId: ownerId.toString(),
            ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
            action: action,
            reason: reason,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            totalAmount: booking.totalAmount,
            propertyTitle: house?.title,
            propertyAddress: house?.location?.address
          },
          isRead: false,
          priority: action === 'accept' ? 'high' : action === 'reject' ? 'medium' : 'low',
          category: 'booking',
          senderId: ownerId,
          createdAt: new Date(),
          actionUrl: `/renter/bookings/${booking._id}`,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        };
        
        await notificationsCollection.insertOne(renterNotification);
        
        // 2. Send real-time WebSocket notification to renter if online
        const renterSession = await sessionsCollection.findOne({ 
          userId: booking.renterId, 
          isActive: true 
        });
        
        if (renterSession) {
          await sendWebSocketNotification(renterSession.connectionId, {
            _id: new ObjectId().toString(),
            type: notificationType,
            title: notificationTitle,
            message: notificationMessage,
            data: {
              bookingId: booking._id.toString(),
              bookingCode: booking.bookingCode,
              propertyTitle: house?.title,
              ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
              action: action,
              reason: reason,
              amount: booking.totalAmount,
              checkInDate: booking.checkInDate.toISOString().split('T')[0],
              checkOutDate: booking.checkOutDate.toISOString().split('T')[0]
            },
            isRead: false,
            priority: action === 'accept' ? 'high' : action === 'reject' ? 'medium' : 'low',
            category: 'booking',
            createdAt: new Date().toISOString(),
            actionUrl: `/renter/bookings/${booking._id}`
          });
        }
        
        // 3. Create database notification for owner (confirmation)
        const ownerNotification = {
          userId: ownerId,
          type: `booking_${action}ed`,
          title: `${notificationEmoji} Booking ${action.charAt(0).toUpperCase() + action.slice(1)}ed`,
          message: `You ${action}ed the booking request from ${renter?.firstName} ${renter?.lastName}`,
          data: {
            bookingId: booking._id,
            bookingCode: booking.bookingCode,
            houseId: booking.houseId,
            renterId: booking.renterId.toString(),
            renterName: renter ? `${renter.firstName} ${renter.lastName}` : 'Renter',
            action: action,
            reason: reason,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            totalAmount: booking.totalAmount,
            propertyTitle: house?.title
          },
          isRead: false,
          priority: 'medium',
          category: 'booking',
          senderId: booking.renterId,
          createdAt: new Date(),
          actionUrl: `/owner/bookings/${booking._id}`,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        };
        
        await notificationsCollection.insertOne(ownerNotification);
        
        // 4. If booking is accepted, reject other pending bookings for same dates
        if (action === 'accept') {
          const otherPendingBookings = await bookingsCollection.find({
            _id: { $ne: new ObjectId(bookingId) },
            houseId: booking.houseId,
            status: 'pending',
            $or: [
              {
                checkInDate: { $lte: booking.checkOutDate },
                checkOutDate: { $gte: booking.checkInDate }
              }
            ]
          }).toArray();
          
          if (otherPendingBookings.length > 0) {
            // Update all conflicting bookings
            await bookingsCollection.updateMany(
              {
                _id: { $in: otherPendingBookings.map(b => b._id) }
              },
              {
                $set: {
                  status: 'rejected',
                  rejectedAt: new Date(),
                  rejectionReason: 'Dates no longer available (booking accepted for another renter)',
                  updatedAt: new Date()
                }
              }
            );
            
            // Create notifications for each rejected booking
            for (const pendingBooking of otherPendingBookings) {
              const otherRenter = await usersCollection.findOne(
                { _id: pendingBooking.renterId },
                { projection: { firstName: 1, lastName: 1 } }
              );
              
              // Create notification for rejected renter
              await notificationsCollection.insertOne({
                userId: pendingBooking.renterId,
                type: 'booking_auto_rejected',
                title: '⏰ Booking Unavailable',
                message: `The dates you requested for "${house?.title || 'the property'}" are no longer available`,
                data: {
                  bookingId: pendingBooking._id,
                  bookingCode: pendingBooking.bookingCode,
                  houseId: booking.houseId,
                  originalCheckInDate: pendingBooking.checkInDate,
                  originalCheckOutDate: pendingBooking.checkOutDate,
                  propertyTitle: house?.title,
                  reason: 'Another renter\'s booking was accepted for these dates'
                },
                isRead: false,
                priority: 'medium',
                category: 'booking',
                senderId: ownerId,
                createdAt: new Date(),
                actionUrl: `/renter/bookings/${pendingBooking._id}`,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              });
              
              // Send WebSocket notification if renter is online
              const otherRenterSession = await sessionsCollection.findOne({ 
                userId: pendingBooking.renterId, 
                isActive: true 
              });
              
              if (otherRenterSession) {
                await sendWebSocketNotification(otherRenterSession.connectionId, {
                  _id: new ObjectId().toString(),
                  type: 'booking_auto_rejected',
                  title: '⏰ Booking Unavailable',
                  message: `The dates you requested are no longer available`,
                  data: {
                    bookingId: pendingBooking._id.toString(),
                    propertyTitle: house?.title,
                    reason: 'Another renter\'s booking was accepted for these dates'
                  },
                  isRead: false,
                  priority: 'medium',
                  category: 'booking',
                  createdAt: new Date().toISOString(),
                  actionUrl: `/renter/bookings/${pendingBooking._id}`
                });
              }
            }
            
            console.log(`📢 Auto-rejected ${otherPendingBookings.length} conflicting bookings`);
          }
        }
        
        console.log('📢 Booking notification sent successfully');
        
      } catch (notificationError) {
        console.error('❌ Booking notification failed:', notificationError);
        // Don't fail the booking update if notifications fail
      }
      // ========== END NOTIFICATION SYSTEM ==========
      
      // If booking is accepted, mark other pending bookings for same dates as rejected
      if (action === 'accept') {
        await bookingsCollection.updateMany(
          {
            _id: { $ne: new ObjectId(bookingId) },
            houseId: booking.houseId,
            status: 'pending',
            $or: [
              {
                checkInDate: { $lte: booking.checkOutDate },
                checkOutDate: { $gte: booking.checkInDate }
              }
            ]
          },
          {
            $set: {
              status: 'rejected',
              rejectedAt: new Date(),
              rejectionReason: 'Dates no longer available (booking accepted for another renter)',
              updatedAt: new Date()
            }
          }
        );
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message,
          booking: result,
          action: action,
          newStatus: newStatus,
          notification: {
            sent: true,
            message: `Renter has been notified about the ${action} action`
          }
        })
      };
    }
    
  } catch (error) {
    console.error('❌ Owner bookings error:', error);
    
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
        details: error.message 
      })
    };
  }
};