import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

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
  const client = await MongoClient.connect(connectionString, {
    serverSelectionTimeoutMS: 10000
  });
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

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
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
        body: JSON.stringify({ error: 'Only owners and admins can access dashboard stats' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const bookingsCollection = db.collection('bookings');
    const usersCollection = db.collection('users');
    const favoritesCollection = db.collection('favorites');
    const messagesCollection = db.collection('messages');
    
    const ownerId = new ObjectId(decoded.userId);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // ========== PROPERTY STATS ==========
    
    // Get total approved properties
    const totalProperties = await housesCollection.countDocuments({ 
      ownerId, 
      status: 'approved' 
    });
    
    // Get active properties
    const activeProperties = await housesCollection.countDocuments({ 
      ownerId, 
      status: 'approved',
      isActive: true 
    });
    
    // Get verified properties
    const verifiedProperties = await housesCollection.countDocuments({ 
      ownerId, 
      isVerified: true 
    });
    
    // Get properties pending verification
    const pendingVerification = await housesCollection.countDocuments({ 
      ownerId, 
      verificationStatus: 'pending' 
    });
    
    // Get rejected properties
    const rejectedProperties = await housesCollection.countDocuments({ 
      ownerId, 
      verificationStatus: 'rejected' 
    });
    
    // Get featured properties
    const featuredProperties = await housesCollection.countDocuments({ 
      ownerId, 
      isFeatured: true 
    });
    
    // Properties by verification status
    const propertiesByVerification = await housesCollection.aggregate([
      { $match: { ownerId, status: 'approved' } },
      { $group: { 
        _id: "$verificationStatus", 
        count: { $sum: 1 },
        totalViews: { $sum: "$views" },
        totalFavorites: { $sum: "$favorites" },
        avgRating: { $avg: "$rating" }
      }}
    ]).toArray();
    
    // Get recent properties (last 7 days)
    const recentProperties = await housesCollection.find({ 
      ownerId,
      createdAt: { $gte: sevenDaysAgo }
    })
    .sort({ createdAt: -1 })
    .limit(3)
    .toArray();
    
    // ========== BOOKING STATS ==========
    
    // Get recent bookings (last 30 days)
    const recentBookings = await bookingsCollection.countDocuments({
      ownerId,
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    // Get booking revenue (last 30 days)
    const recentRevenue = await bookingsCollection.aggregate([
      { 
        $match: { 
          ownerId,
          status: { $in: ['confirmed', 'completed'] },
          createdAt: { $gte: thirtyDaysAgo }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 }
        } 
      }
    ]).toArray();
    
    const totalRevenue = recentRevenue.length > 0 ? recentRevenue[0].total : 0;
    const recentBookingCount = recentRevenue.length > 0 ? recentRevenue[0].count : 0;
    
    // Get pending booking requests
    const pendingBookings = await bookingsCollection.find({
      ownerId,
      status: 'pending'
    }).sort({ createdAt: -1 }).limit(5).toArray();
    
    // Get booking success rate
    const bookingStats = await bookingsCollection.aggregate([
      { $match: { ownerId } },
      { $group: { 
        _id: "$status", 
        count: { $sum: 1 }
      }}
    ]).toArray();
    
    const totalBookings = bookingStats.reduce((sum, stat) => sum + stat.count, 0);
    const confirmedBookings = bookingStats.find(stat => stat._id === 'confirmed')?.count || 0;
    const bookingSuccessRate = totalBookings > 0 ? (confirmedBookings / totalBookings) * 100 : 0;
    
    // Get upcoming bookings (next 30 days)
    const today = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(today.getDate() + 30);
    
    const upcomingBookings = await bookingsCollection.find({
      ownerId,
      status: { $in: ['confirmed', 'active'] },
      checkInDate: { $gte: today, $lte: nextMonth }
    })
    .sort({ checkInDate: 1 })
    .limit(5)
    .toArray();
    
    // ========== PERFORMANCE STATS ==========
    
    // Get top performing properties
    const topProperties = await housesCollection.find({ 
      ownerId, 
      status: 'approved' 
    })
    .sort({ views: -1, favorites: -1 })
    .limit(3)
    .toArray();
    
    // Get views and favorites totals
    const performanceStats = await housesCollection.aggregate([
      { $match: { ownerId, status: 'approved' } },
      { $group: { 
        _id: null, 
        totalViews: { $sum: "$views" },
        totalFavorites: { $sum: "$favorites" },
        avgRating: { $avg: "$rating" },
        totalReviews: { $sum: "$reviewCount" }
      }}
    ]).toArray();
    
    // Get property views in last 7 days
    const recentViews = await housesCollection.aggregate([
      { $match: { ownerId } },
      { $unwind: { path: "$viewedBy", preserveNullAndEmptyArrays: true } },
      { $match: { "viewedBy.viewedAt": { $gte: sevenDaysAgo } } },
      { $group: { _id: null, count: { $sum: 1 } } }
    ]).toArray();
    
    // ========== MESSAGES STATS ==========
    
    // Get unread messages count
    const unreadMessages = await messagesCollection.countDocuments({
      receiverId: ownerId,
      isRead: false
    });
    
    // Get recent messages
    const recentMessages = await messagesCollection.find({
      $or: [
        { senderId: ownerId },
        { receiverId: ownerId }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
    
    // ========== USER PROFILE ==========
    
    // Get user profile
    const ownerProfile = await usersCollection.findOne(
      { _id: ownerId },
      { projection: { 
        firstName: 1, 
        lastName: 1, 
        email: 1,
        phone: 1,
        profileImage: 1,
        createdAt: 1,
        rating: 1,
        responseRate: 1,
        responseTime: 1,
        isVerified: 1,
        totalProperties: 1,
        bio: 1
      }}
    );
    
    // Get user's favorite count (how many times their properties were favorited)
    const totalFavoritesReceived = await housesCollection.aggregate([
      { $match: { ownerId } },
      { $group: { _id: null, total: { $sum: "$favorites" } } }
    ]).toArray();
    
    // ========== PREPARE RESPONSE ==========
    
    const verificationStats = propertiesByVerification.reduce((acc, stat) => {
      acc[stat._id] = {
        count: stat.count,
        totalViews: stat.totalViews || 0,
        totalFavorites: stat.totalFavorites || 0,
        avgRating: stat.avgRating || 0
      };
      return acc;
    }, {});
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Owner dashboard stats retrieved successfully',
        dashboard: {
          greeting: `Hello, ${ownerProfile?.firstName || 'Owner'}!`,
          summary: {
            totalProperties,
            activeProperties,
            recentBookings: recentBookingCount,
            totalRevenue,
            unreadMessages,
            verificationProgress: totalProperties > 0 ? ((verifiedProperties / totalProperties) * 100).toFixed(1) : 0
          },
          user: {
            ...ownerProfile,
            memberSince: ownerProfile?.createdAt,
            responseRate: ownerProfile?.responseRate || 0,
            responseTime: ownerProfile?.responseTime || '24 hours',
            totalFavoritesReceived: totalFavoritesReceived[0]?.total || 0
          },
          properties: {
            overview: {
              total: totalProperties,
              active: activeProperties,
              featured: featuredProperties,
              recent: recentProperties.length
            },
            verification: {
              verified: verifiedProperties,
              pending: pendingVerification,
              rejected: rejectedProperties,
              rate: totalProperties > 0 ? ((verifiedProperties / totalProperties) * 100).toFixed(1) : 0,
              details: verificationStats
            },
            performance: {
              totalViews: performanceStats[0]?.totalViews || 0,
              totalFavorites: performanceStats[0]?.totalFavorites || 0,
              avgRating: performanceStats[0]?.avgRating || 0,
              totalReviews: performanceStats[0]?.totalReviews || 0,
              recentViews: recentViews[0]?.count || 0
            },
            recent: recentProperties.map(property => ({
              id: property._id,
              title: property.title,
              city: property.location?.city,
              price: property.price?.amount,
              isVerified: property.isVerified,
              verificationStatus: property.verificationStatus,
              images: property.images?.[0],
              views: property.views || 0,
              createdAt: property.createdAt
            })),
            topPerforming: topProperties.map(property => ({
              id: property._id,
              title: property.title,
              views: property.views || 0,
              favorites: property.favorites || 0,
              isVerified: property.isVerified,
              verificationStatus: property.verificationStatus,
              rating: property.rating || 0,
              city: property.location?.city
            }))
          },
          bookings: {
            overview: {
              total: totalBookings,
              recent: recentBookingCount,
              successRate: bookingSuccessRate.toFixed(1),
              revenue: totalRevenue
            },
            pendingRequests: pendingBookings.map(booking => ({
              id: booking._id,
              propertyName: booking.propertyName || 'Property',
              renterName: booking.renterName,
              checkInDate: booking.checkInDate,
              checkOutDate: booking.checkOutDate,
              totalAmount: booking.totalAmount,
              status: booking.status,
              createdAt: booking.createdAt,
              nights: booking.nights || 1
            })),
            upcoming: upcomingBookings.map(booking => ({
              id: booking._id,
              propertyName: booking.propertyName || 'Property',
              renterName: booking.renterName,
              checkInDate: booking.checkInDate,
              checkOutDate: booking.checkOutDate,
              totalAmount: booking.totalAmount,
              status: booking.status,
              guests: booking.guests || 1
            })),
            statusBreakdown: bookingStats.reduce((acc, stat) => {
              acc[stat._id] = stat.count;
              return acc;
            }, {})
          },
          messages: {
            unread: unreadMessages,
            recent: recentMessages.map(msg => ({
              id: msg._id,
              subject: msg.subject || 'No Subject',
              preview: msg.content?.substring(0, 50) + '...',
              sender: msg.senderName,
              isRead: msg.isRead,
              createdAt: msg.createdAt
            }))
          },
          verification: {
            summary: {
              pendingCount: pendingVerification,
              verifiedCount: verifiedProperties,
              rejectedCount: rejectedProperties,
              progress: totalProperties > 0 ? ((verifiedProperties / totalProperties) * 100).toFixed(1) : 0
            },
            insights: {
              averageVerificationTime: '2-3 days', // This would be calculated from verification history
              commonRejectionReasons: pendingVerification > 0 ? [
                'Missing property photos',
                'Incomplete description',
                'Unverified contact information'
              ] : [],
              tips: [
                'Add clear photos of all rooms',
                'Write detailed property description',
                'Verify your contact information'
              ]
            },
            actionItems: pendingVerification > 0 ? [
              `${pendingVerification} properties awaiting admin verification`,
              'Ensure all property details are complete',
              'Respond promptly to admin verification requests'
            ] : [
              'All properties are verified!',
              'Consider adding more properties',
              'Keep property information updated'
            ]
          }
        },
        meta: {
          timePeriod: 'Last 30 days',
          timestamp: new Date().toISOString(),
          ownerId: decoded.userId,
          reportGenerated: new Date().toISOString(),
          dataFreshness: 'real-time'
        }
      })
    };
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    
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