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

async function logSystemActivity(db, level, category, message, userEmail, ipAddress, details) {
  try {
    const systemLogsCollection = db.collection('system_logs');
    
    await systemLogsCollection.insertOne({
      level,
      category,
      message,
      ipAddress: ipAddress || 'INTERNAL',
      userEmail: userEmail || null,
      details: details || null,
      timestamp: new Date(),
      source: 'listing_verification',
      severity: level === 'ERROR' ? 'high' : (level === 'WARNING' ? 'medium' : 'low')
    });
  } catch (error) {
    console.error('Failed to log system activity:', error);
  }
}

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
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    if (decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can verify listings' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const notificationsCollection = db.collection('notifications');
    const sessionsCollection = db.collection('websocket_sessions');
    
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      const query = {};
      
      if (params.verificationStatus) {
        query.verificationStatus = params.verificationStatus;
      } else {
        query.verificationStatus = 'pending';
      }
      
      query.status = 'approved';
      
      if (params.propertyType) {
        query.propertyType = params.propertyType;
      }
      
      if (params.rentalType) {
        query.rentalType = params.rentalType;
      }
      
      if (params.city) {
        query['location.city'] = new RegExp(params.city, 'i');
      }
      
      if (params.priority === 'high') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query.createdAt = { $lte: weekAgo };
      }
      
      if (params.priority === 'new') {
        const dayAgo = new Date();
        dayAgo.setDate(dayAgo.getDate() - 1);
        query.createdAt = { $gte: dayAgo };
      }
      
      if (params.search) {
        const searchRegex = new RegExp(params.search, 'i');
        query.$or = [
          { title: searchRegex },
          { description: searchRegex },
          { ownerEmail: searchRegex }
        ];
      }
      
      if (params.startDate && params.endDate) {
        query.createdAt = {
          $gte: new Date(params.startDate),
          $lte: new Date(params.endDate)
        };
      }
      
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;
      
      let sort = { createdAt: -1 };
      if (params.sortBy === 'oldest') sort = { createdAt: 1 };
      if (params.sortBy === 'price') sort = { 'price.amount': -1 };
      if (params.sortBy === 'views') sort = { views: -1 };
      if (params.sortBy === 'priority') {
        sort = { 
          createdAt: 1,
          views: -1 
        };
      }
      
      const listings = await housesCollection.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray();
      
      const enrichedListings = await Promise.all(listings.map(async (listing) => {
        const owner = await usersCollection.findOne(
          { _id: listing.ownerId },
          { projection: { 
            firstName: 1, 
            lastName: 1, 
            email: 1, 
            phone: 1, 
            profileImage: 1,
            isVerified: 1,
            rating: 1,
            totalProperties: 1,
            createdAt: 1
          }}
        );
        
        let verificationScore = 100;
        const completenessIssues = [];
        
        if (!listing.images || listing.images.length < 3) {
          verificationScore -= 20;
          completenessIssues.push('Need at least 3 images');
        }
        
        if (!listing.description || listing.description.length < 100) {
          verificationScore -= 15;
          completenessIssues.push('Description too short (min 100 chars)');
        }
        
        if (!listing.location?.coordinates) {
          verificationScore -= 25;
          completenessIssues.push('Missing location coordinates');
        }
        
        if (!listing.amenities || listing.amenities.length < 5) {
          verificationScore -= 10;
          completenessIssues.push('Add more amenities');
        }
        
        if (!listing.propertyDetails?.squareFeet) {
          verificationScore -= 5;
          completenessIssues.push('Missing square footage');
        }
        
        if (!listing.rules || listing.rules.length === 0) {
          verificationScore -= 5;
          completenessIssues.push('Add house rules');
        }
        
        if (!listing.tags || listing.tags.length === 0) {
          verificationScore -= 5;
          completenessIssues.push('Add property tags');
        }
        
        const suspiciousPatterns = [];
        if (listing.title && listing.title.match(/free|urgent|discount|cheap|quick/i)) {
          suspiciousPatterns.push('Suspicious title');
          verificationScore -= 10;
        }
        
        if (listing.price.amount < 10) {
          suspiciousPatterns.push('Unrealistically low price');
          verificationScore -= 20;
        }
        
        if (listing.description && listing.description.includes('http') && 
            listing.description.split('http').length > 2) {
          suspiciousPatterns.push('Multiple external links');
          verificationScore -= 15;
        }
        
        let verificationPriority = 'medium';
        if (verificationScore < 60) verificationPriority = 'high';
        if (verificationScore > 85) verificationPriority = 'low';
        
        const daysLive = Math.floor((new Date() - new Date(listing.createdAt)) / (1000 * 60 * 60 * 24));
        
        return {
          ...listing,
          owner: owner ? {
            _id: owner._id,
            name: `${owner.firstName} ${owner.lastName}`,
            email: owner.email,
            phone: owner.phone,
            isVerified: owner.isVerified,
            rating: owner.rating || 0,
            totalProperties: owner.totalProperties || 0,
            memberSince: owner.createdAt
          } : null,
          verificationScore,
          verificationPriority,
          suspiciousPatterns,
          completenessIssues,
          daysLive: daysLive,
          completeness: {
            images: listing.images?.length || 0,
            descriptionLength: listing.description?.length || 0,
            hasCoordinates: !!listing.location?.coordinates,
            amenitiesCount: listing.amenities?.length || 0,
            hasRules: listing.rules?.length > 0,
            hasTags: listing.tags?.length > 0
          }
        };
      }));
      
      const total = await housesCollection.countDocuments(query);
      
      const verificationStats = await housesCollection.aggregate([
        { $group: { 
          _id: "$verificationStatus", 
          count: { $sum: 1 },
          avgViews: { $avg: "$views" },
          avgRating: { $avg: "$rating" }
        }}
      ]).toArray();
      
      const stats = verificationStats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          avgViews: stat.avgViews,
          avgRating: stat.avgRating
        };
        return acc;
      }, {});
      
      if (stats.pending) {
        const pendingListings = await housesCollection.find({ verificationStatus: 'pending' }).toArray();
        
        stats.pending.byPriority = {
          high: enrichedListings.filter(l => l.verificationPriority === 'high').length,
          medium: enrichedListings.filter(l => l.verificationPriority === 'medium').length,
          low: enrichedListings.filter(l => l.verificationPriority === 'low').length
        };
        
        stats.pending.avgVerificationScore = enrichedListings.length > 0 
          ? enrichedListings.reduce((sum, l) => sum + l.verificationScore, 0) / enrichedListings.length 
          : 0;
          
        stats.pending.avgDaysLive = pendingListings.length > 0
          ? pendingListings.reduce((sum, l) => {
              const days = Math.floor((new Date() - new Date(l.createdAt)) / (1000 * 60 * 60 * 24));
              return sum + days;
            }, 0) / pendingListings.length
          : 0;
      }
      
      const pendingVerifications = await housesCollection.countDocuments({ 
        verificationStatus: 'pending' 
      });
      
      const adminStats = {
        pendingVerifications,
        verifiedToday: await housesCollection.countDocuments({
          verificationStatus: 'verified',
          verifiedAt: { 
            $gte: new Date(new Date().setHours(0, 0, 0, 0)) 
          }
        }),
        rejectedToday: await housesCollection.countDocuments({
          verificationStatus: 'rejected',
          rejectedAt: { 
            $gte: new Date(new Date().setHours(0, 0, 0, 0)) 
          }
        })
      };
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Listings for verification retrieved successfully',
          listings: enrichedListings,
          stats,
          adminStats,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          },
          verificationSummary: {
            pendingCount: stats.pending?.count || 0,
            verifiedCount: stats.verified?.count || 0,
            rejectedCount: stats.rejected?.count || 0,
            avgVerificationScore: stats.pending?.avgVerificationScore || 0,
            avgDaysPending: stats.pending?.avgDaysLive || 0,
            highPriority: stats.pending?.byPriority?.high || 0,
            reviewedBy: decoded.email,
            reviewedAt: new Date().toISOString()
          }
        })
      };
    }
    
    if (event.httpMethod === 'PUT') {
      const listingId = event.pathParameters?.id;
      
      if (!listingId || !ObjectId.isValid(listingId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid listing ID is required' })
        };
      }
      
      const body = JSON.parse(event.body);
      const { action, reason, notes, badgeType } = body;
      
      const validActions = ['verify', 'reject', 'feature', 'unfeature', 'add_badge'];
      if (!validActions.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid action. Must be one of: ${validActions.join(', ')}` 
          })
        };
      }
      
      const listing = await housesCollection.findOne({ _id: new ObjectId(listingId) });
      
      if (!listing) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Listing not found' })
        };
      }
      
      const owner = await usersCollection.findOne(
        { _id: listing.ownerId },
        { projection: { firstName: 1, lastName: 1, email: 1 } }
      );
      
      const updateFields = {
        updatedAt: new Date()
      };
      
      let message = '';
      let notificationType = '';
      let notificationTitle = '';
      let notificationMessage = '';
      
      switch (action) {
        case 'verify':
          updateFields.isVerified = true;
          updateFields.verificationStatus = 'verified';
          updateFields.verifiedAt = new Date();
          updateFields.verifiedBy = new ObjectId(decoded.userId);
          updateFields.verifiedByEmail = decoded.email;
          updateFields.verificationNotes = notes;
          
          message = `Listing "${listing.title}" has been verified by admin`;
          notificationType = 'listing_verified';
          notificationTitle = '✅ Listing Verified!';
          notificationMessage = `Your listing "${listing.title}" has been verified and is now fully visible to renters`;
          break;
          
        case 'reject':
          if (!reason || reason.trim().length < 10) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ 
                error: 'Rejection reason is required (minimum 10 characters)' 
              })
            };
          }
          
          updateFields.verificationStatus = 'rejected';
          updateFields.rejectedAt = new Date();
          updateFields.rejectedBy = new ObjectId(decoded.userId);
          updateFields.rejectionReason = reason;
          updateFields.rejectionNotes = notes;
          
          message = `Listing "${listing.title}" verification was rejected`;
          notificationType = 'listing_rejected';
          notificationTitle = '❌ Listing Verification Rejected';
          notificationMessage = `Your listing "${listing.title}" verification was rejected: ${reason}`;
          break;
          
        case 'feature':
          updateFields.isFeatured = true;
          updateFields.featuredAt = new Date();
          updateFields.featuredBy = new ObjectId(decoded.userId);
          updateFields.featuredNotes = notes;
          message = `Listing "${listing.title}" has been featured`;
          notificationType = 'listing_featured';
          notificationTitle = '⭐ Listing Featured!';
          notificationMessage = `Your listing "${listing.title}" has been featured and will appear in premium search results`;
          break;
          
        case 'unfeature':
          updateFields.isFeatured = false;
          updateFields.unfeaturedAt = new Date();
          updateFields.unfeaturedBy = new ObjectId(decoded.userId);
          updateFields.unfeaturedReason = reason;
          message = `Listing "${listing.title}" has been unfeatured`;
          notificationType = 'listing_unfeatured';
          notificationTitle = '⚠️ Listing Unfeatured';
          notificationMessage = `Your listing "${listing.title}" has been removed from featured listings${reason ? `: ${reason}` : ''}`;
          break;
          
        case 'add_badge':
          if (!badgeType) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ 
                error: 'Badge type is required' 
              })
            };
          }
          
          const validBadges = ['verified', 'premium', 'new', 'trending', 'best_value'];
          if (!validBadges.includes(badgeType)) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ 
                error: `Invalid badge type. Must be one of: ${validBadges.join(', ')}` 
              })
            };
          }
          
          updateFields.badges = listing.badges || [];
          if (!updateFields.badges.includes(badgeType)) {
            updateFields.badges.push(badgeType);
          }
          updateFields.badgeAddedAt = new Date();
          updateFields.badgeAddedBy = new ObjectId(decoded.userId);
          message = `Badge "${badgeType}" added to listing "${listing.title}"`;
          notificationType = 'badge_added';
          notificationTitle = '🏆 Badge Added!';
          notificationMessage = `Your listing "${listing.title}" received a "${badgeType.replace('_', ' ')}" badge`;
          break;
      }
      
      updateFields.verificationHistory = listing.verificationHistory || [];
      updateFields.verificationHistory.push({
        action,
        performedBy: decoded.userId,
        performedByEmail: decoded.email,
        reason,
        notes,
        timestamp: new Date(),
        changes: Object.keys(updateFields)
      });
      
      const result = await housesCollection.findOneAndUpdate(
        { _id: new ObjectId(listingId) },
        { $set: updateFields },
        { returnDocument: 'after' }
      );
      
      const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
      
      switch (action) {
        case 'verify':
          await logSystemActivity(db, 'INFO', 'Listing', 
            `Listing "${listing.title}" has been verified by admin`, 
            decoded.email, 
            ipAddress, 
            {
              listingId: listingId,
              listingTitle: listing.title,
              verifiedBy: decoded.email,
              verificationNotes: notes,
              ownerId: listing.ownerId.toString(),
              ownerEmail: owner?.email
            }
          );
          break;
          
        case 'reject':
          await logSystemActivity(db, 'WARNING', 'Listing',
            `Listing "${listing.title}" verification was rejected: ${reason}`,
            decoded.email,
            ipAddress,
            {
              listingId: listingId,
              listingTitle: listing.title,
              rejectedBy: decoded.email,
              rejectionReason: reason,
              ownerId: listing.ownerId.toString(),
              ownerEmail: owner?.email
            }
          );
          break;
          
        case 'feature':
          await logSystemActivity(db, 'INFO', 'Admin',
            `Listing "${listing.title}" has been featured`,
            decoded.email,
            ipAddress,
            {
              listingId: listingId,
              listingTitle: listing.title,
              featuredBy: decoded.email,
              featuredNotes: notes
            }
          );
          break;
          
        case 'unfeature':
          await logSystemActivity(db, 'WARNING', 'Admin',
            `Listing "${listing.title}" has been unfeatured: ${reason}`,
            decoded.email,
            ipAddress,
            {
              listingId: listingId,
              listingTitle: listing.title,
              unfeaturedBy: decoded.email,
              unfeaturedReason: reason
            }
          );
          break;
          
        case 'add_badge':
          await logSystemActivity(db, 'INFO', 'Listing',
            `Badge "${badgeType}" added to listing "${listing.title}"`,
            decoded.email,
            ipAddress,
            {
              listingId: listingId,
              listingTitle: listing.title,
              badgeType: badgeType,
              addedBy: decoded.email
            }
          );
          break;
      }
      
      try {
        const ownerNotification = {
          userId: listing.ownerId,
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          data: {
            listingId: listing._id,
            title: listing.title,
            action: action,
            reason: reason,
            notes: notes,
            performedBy: decoded.email,
            performedAt: new Date(),
            propertyType: listing.propertyType,
            city: listing.location?.city,
            price: listing.price?.amount,
            badgeType: badgeType
          },
          isRead: false,
          priority: action === 'reject' ? 'high' : 'medium',
          category: 'verification',
          senderId: new ObjectId(decoded.userId),
          createdAt: new Date(),
          actionUrl: `/owner/listings/${listing._id}`,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        };
        
        await notificationsCollection.insertOne(ownerNotification);
        
        const ownerSession = await sessionsCollection.findOne({ 
          userId: listing.ownerId, 
          isActive: true 
        });
        
        if (ownerSession) {
          await sendWebSocketNotification(ownerSession.connectionId, {
            _id: new ObjectId().toString(),
            type: notificationType,
            title: notificationTitle,
            message: notificationMessage,
            data: {
              listingId: listing._id.toString(),
              title: listing.title,
              action: action,
              reason: reason,
              badgeType: badgeType,
              performedBy: decoded.email
            },
            isRead: false,
            priority: action === 'reject' ? 'high' : 'medium',
            category: 'verification',
            createdAt: new Date().toISOString(),
            actionUrl: `/owner/listings/${listing._id}`
          });
        }
        
        const adminNotification = {
          userId: new ObjectId(decoded.userId),
          type: `admin_${action}`,
          title: `📋 ${action.charAt(0).toUpperCase() + action.slice(1)}d Listing`,
          message: `You ${action}ed listing "${listing.title}" owned by ${owner?.firstName || 'Owner'}`,
          data: {
            listingId: listing._id,
            title: listing.title,
            ownerId: listing.ownerId,
            ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Owner',
            ownerEmail: owner?.email,
            action: action,
            reason: reason,
            notes: notes,
            badgeType: badgeType,
            listingCity: listing.location?.city,
            listingPrice: listing.price?.amount
          },
          isRead: false,
          priority: 'low',
          category: 'admin',
          senderId: listing.ownerId,
          createdAt: new Date(),
          actionUrl: `/admin/listings/${listing._id}`,
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        };
        
        await notificationsCollection.insertOne(adminNotification);
        
        console.log(`📢 Listing ${action} notification sent to owner ${listing.ownerId}`);
        
      } catch (notificationError) {
        console.error('❌ Listing notification failed:', notificationError);
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message,
          listing: result,
          action: action,
          notification: {
            sent: true,
            type: notificationType,
            ownerNotified: true,
            ownerEmail: owner?.email
          }
        })
      };
    }
    
  } catch (error) {
    console.error('❌ Verify listings error:', error);
    
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    await logSystemActivity(db, 'ERROR', 'Admin',
      `Listing verification error: ${error.message}`,
      decoded?.email || null,
      ipAddress,
      {
        error: error.message,
        listingId: event.pathParameters?.id,
        adminEmail: decoded?.email
      }
    );
    
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