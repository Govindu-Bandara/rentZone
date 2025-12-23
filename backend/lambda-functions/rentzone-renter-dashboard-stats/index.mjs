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
    
    if (decoded.role !== 'renter') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only renters can access renter dashboard' })
      };
    }
    
    const db = await connectToDatabase();
    const bookingsCollection = db.collection('bookings');
    const favoritesCollection = db.collection('favorites');
    const messagesCollection = db.collection('messages');
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    
    const renterId = new ObjectId(decoded.userId);
    
    // ========== GET ALL STATS IN PARALLEL FOR BETTER PERFORMANCE ==========
    
    const [
      savedProperties,
      activeBookings,
      unreadMessages,
      bookingRequests,
      user,
      recentlyViewedCount
    ] = await Promise.all([
      // Get saved properties count
      favoritesCollection.countDocuments({ userId: renterId }),
      
      // Get active bookings count
      bookingsCollection.countDocuments({
        renterId,
        status: { $in: ['confirmed', 'active'] }
      }),
      
      // Get unread messages count
      messagesCollection.countDocuments({
        receiverId: renterId,
        isRead: false
      }),
      
      // Get booking requests count
      bookingsCollection.countDocuments({
        renterId,
        status: 'pending'
      }),
      
      // Get user profile
      usersCollection.findOne(
        { _id: renterId },
        { projection: { password: 0, preferences: 1, firstName: 1, lastName: 1, email: 1, profileImage: 1 } }
      ),
      
      // Get recently viewed count (last 14 days)
      (async () => {
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        
        return housesCollection.countDocuments({
          'viewedBy.userId': renterId,
          'viewedBy.viewedAt': { $gte: fourteenDaysAgo }
        });
      })()
    ]);
    
    // ========== GET ADDITIONAL STATS ==========
    
    // Get upcoming bookings (next 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const upcomingBookings = await bookingsCollection.countDocuments({
      renterId,
      status: { $in: ['confirmed', 'active'] },
      checkInDate: { $lte: thirtyDaysFromNow }
    });
    
    // Get favorite types stats (optional, can be removed if not needed)
    const favoriteTypes = await favoritesCollection.aggregate([
      { $match: { userId: renterId } },
      { $lookup: {
          from: 'houses',
          localField: 'houseId',
          foreignField: '_id',
          as: 'house'
        }
      },
      { $unwind: '$house' },
      { $group: {
          _id: '$house.propertyType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 3 }
    ]).toArray();
    
    // Get booking status distribution
    const bookingStatusStats = await bookingsCollection.aggregate([
      { $match: { renterId } },
      { $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Renter dashboard stats retrieved successfully',
        stats: {
          user: {
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            profileImage: user.profileImage
          },
          counts: {
            savedProperties,
            activeBookings,
            unreadMessages,
            bookingRequests,
            recentlyViewed: recentlyViewedCount,
            upcomingBookings
          },
          // Additional insights
          insights: {
            favoritePropertyTypes: favoriteTypes.map(type => ({
              type: type._id,
              count: type.count
            })),
            bookingStatusDistribution: bookingStatusStats.reduce((acc, stat) => {
              acc[stat._id] = stat.count;
              return acc;
            }, {})
          },
          preferences: user.preferences || {},
          // API endpoints for frontend to fetch detailed data
          apiEndpoints: {
            recommendations: '/recommendations?limit=6',
            recentlyViewed: '/recently-viewed?limit=6',
            favorites: '/favorites',
            bookings: '/renter-bookings',
            messages: '/get-messages'
          }
        }
      })
    };
    
  } catch (error) {
    console.error('Renter dashboard error:', error);
    
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
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};