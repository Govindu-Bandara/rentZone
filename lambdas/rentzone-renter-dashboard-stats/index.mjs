import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
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
    console.log('[Renter Dashboard] Starting dashboard data fetch...');
    
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    if (decoded.role !== 'renter') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only renters can access renter dashboard' })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const bookingsCollection = db.collection('bookings');
    const favoritesCollection = db.collection('favorites');
    const housesCollection = db.collection('houses');
    const messagesCollection = db.collection('messages');
    
    const renterId = new ObjectId(decoded.userId);
    
    console.log(`[Renter Dashboard] Fetching data for user: ${renterId}`);
    
    // ========== GET USER PROFILE ==========
    const user = await usersCollection.findOne(
      { _id: renterId },
      { projection: { 
        firstName: 1, 
        lastName: 1, 
        email: 1, 
        phone: 1, 
        profileImage: 1,
        preferences: 1,
        createdAt: 1
      }}
    );
    
    if (!user) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }
    
    console.log(`[Renter Dashboard] User found: ${user.email}`);
    
    // ========== GET ALL STATS IN PARALLEL ==========
    const [
      activeBookings,
      favoriteCount,
      unreadMessages,
      bookingRequests,
      recentlyViewedCount
    ] = await Promise.all([
      // Active bookings count
      bookingsCollection.countDocuments({
        renterId,
        status: { $in: ['confirmed', 'active'] }
      }),
      
      // Favorites count
      favoritesCollection.countDocuments({ userId: renterId }),
      
      // Unread messages count
      messagesCollection.countDocuments({
        receiverId: renterId,
        isRead: false
      }),
      
      // Booking requests count
      bookingsCollection.countDocuments({
        renterId,
        status: 'pending'
      }),
      
      // Recently viewed count (last 14 days)
      (async () => {
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        
        return housesCollection.countDocuments({
          'viewedBy.userId': renterId,
          'viewedBy.viewedAt': { $gte: fourteenDaysAgo }
        });
      })()
    ]);
    
    console.log(`[Renter Dashboard] Stats - Active: ${activeBookings}, Favorites: ${favoriteCount}`);
    
    // ========== GET RECENT BOOKINGS WITH PROPERTY DETAILS ==========
    const recentBookings = await bookingsCollection.find({
      renterId
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
    
    // Enrich bookings with property details
    const enrichedBookings = await Promise.all(recentBookings.map(async (booking) => {
      const property = await housesCollection.findOne(
        { _id: booking.houseId },
        { projection: { title: 1, images: 1, location: 1, price: 1, isVerified: 1 } }
      );
      
      return {
        id: booking._id?.toString(),
        propertyId: booking.houseId?.toString(),
        propertyTitle: property?.title,
        propertyLocation: property?.location,
        propertyPrice: property?.price,
        propertyImage: property?.images?.[0],
        propertyVerified: property?.isVerified || false,
        status: booking.status,
        checkIn: booking.checkInDate,
        checkOut: booking.checkOutDate,
        totalAmount: booking.totalAmount,
        createdAt: booking.createdAt
      };
    }));
    
    console.log(`[Renter Dashboard] Recent bookings fetched: ${enrichedBookings.length}`);
    
    // ========== GET RECENT ACTIVITIES ==========
    const recentActivities = [];
    
    // Add booking activities (last 3)
    for (const booking of enrichedBookings.slice(0, 3)) {
      const activityDate = new Date(booking.createdAt);
      const hoursAgo = Math.floor((Date.now() - activityDate.getTime()) / (1000 * 60 * 60));
      const daysAgo = Math.floor(hoursAgo / 24);
      
      let timeString;
      if (hoursAgo < 1) {
        timeString = 'Just now';
      } else if (hoursAgo < 24) {
        timeString = hoursAgo === 1 ? '1 hour ago' : `${hoursAgo} hours ago`;
      } else if (daysAgo === 1) {
        timeString = 'Yesterday';
      } else if (daysAgo < 7) {
        timeString = `${daysAgo} days ago`;
      } else {
        timeString = activityDate.toLocaleDateString();
      }
      
      recentActivities.push({
        type: 'booking',
        description: `Booking request for ${booking.propertyTitle || 'a property'}`,
        timestamp: timeString,
        date: booking.createdAt,
        status: booking.status
      });
    }
    
    // Get recent favorites
    const recentFavorites = await favoritesCollection.find({
      userId: renterId
    })
    .sort({ createdAt: -1 })
    .limit(2)
    .toArray();
    
    // Add favorite activities
    for (const favorite of recentFavorites) {
      const property = await housesCollection.findOne(
        { _id: favorite.houseId },
        { projection: { title: 1 } }
      );
      
      const activityDate = new Date(favorite.createdAt);
      const hoursAgo = Math.floor((Date.now() - activityDate.getTime()) / (1000 * 60 * 60));
      const daysAgo = Math.floor(hoursAgo / 24);
      
      let timeString;
      if (hoursAgo < 1) {
        timeString = 'Just now';
      } else if (hoursAgo < 24) {
        timeString = hoursAgo === 1 ? '1 hour ago' : `${hoursAgo} hours ago`;
      } else if (daysAgo === 1) {
        timeString = 'Yesterday';
      } else if (daysAgo < 7) {
        timeString = `${daysAgo} days ago`;
      } else {
        timeString = activityDate.toLocaleDateString();
      }
      
      recentActivities.push({
        type: 'favorite',
        description: `Added ${property?.title || 'a property'} to favorites`,
        timestamp: timeString,
        date: favorite.createdAt
      });
    }
    
    // Sort activities by date (most recent first)
    recentActivities.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // ========== GET UPCOMING BOOKINGS ==========
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const upcomingBookings = await bookingsCollection.countDocuments({
      renterId,
      status: { $in: ['confirmed', 'active'] },
      checkInDate: { $lte: thirtyDaysFromNow }
    });
    
    // ========== COMPILE DASHBOARD DATA ==========
    const dashboardData = {
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage,
        memberSince: user.createdAt
      },
      stats: {
        savedProperties: favoriteCount,
        activeBookings,
        unreadMessages,
        bookingRequests,
        recentlyViewed: recentlyViewedCount,
        upcomingBookings
      },
      recentBookings: enrichedBookings,
      recentActivities: recentActivities.slice(0, 5),
      preferences: user.preferences || {},
      // API endpoints for frontend to fetch detailed data
      apiEndpoints: {
        recommendations: '/recommendations?limit=6',
        recentlyViewed: '/recently-viewed?limit=6',
        favorites: '/favorites',
        bookings: '/renter/bookings',
        messages: '/messages'
      }
    };
    
    console.log('[Renter Dashboard] Dashboard data compiled successfully');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Renter dashboard stats retrieved successfully',
        stats: dashboardData
      })
    };
    
  } catch (error) {
    console.error('[Renter Dashboard] Error:', error);
    console.error('[Renter Dashboard] Error stack:', error.stack);
    
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Unauthorized - Invalid or missing token' 
        })
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