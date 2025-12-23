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
        body: JSON.stringify({ error: 'Only owners can view their listings' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const bookingsCollection = db.collection('bookings');
    
    const ownerId = new ObjectId(decoded.userId);
    const params = event.queryStringParameters || {};
    
    // Build query for owner's listings
    const query = { ownerId };
    
    // Filter by verification status if provided
    if (params.verificationStatus) {
      query.verificationStatus = params.verificationStatus;
    }
    
    // Filter by isVerified
    if (params.isVerified !== undefined) {
      query.isVerified = params.isVerified === 'true';
    }
    
    // Filter by property status (approved, etc.)
    if (params.status) {
      query.status = params.status;
    } else {
      // Default: only show approved properties
      query.status = 'approved';
    }
    
    // Filter by property type
    if (params.propertyType) {
      query.propertyType = params.propertyType;
    }
    
    // Filter by rental type
    if (params.rentalType) {
      query.rentalType = params.rentalType;
    }
    
    // Filter by city
    if (params.city) {
      query['location.city'] = new RegExp(params.city, 'i');
    }
    
    // Search by title
    if (params.search) {
      query.title = new RegExp(params.search, 'i');
    }
    
    // Pagination
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Sorting
    let sort = { createdAt: -1 };
    if (params.sortBy === 'price-asc') sort = { 'price.amount': 1 };
    if (params.sortBy === 'price-desc') sort = { 'price.amount': -1 };
    if (params.sortBy === 'views') sort = { views: -1 };
    if (params.sortBy === 'updated') sort = { updatedAt: -1 };
    if (params.sortBy === 'verification') sort = { isVerified: -1, createdAt: -1 };
    
    // Get listings with booking counts
    const listings = await housesCollection
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();
    
    // Get booking counts for each property
    const listingsWithStats = await Promise.all(listings.map(async (listing) => {
      const bookingStats = await bookingsCollection.aggregate([
        { $match: { houseId: listing._id } },
        { $group: { 
          _id: "$status",
          count: { $sum: 1 },
          totalRevenue: { 
            $sum: { 
              $cond: [{ $in: ["$status", ["confirmed", "completed"]] }, "$totalAmount", 0] 
            }
          }
        }}
      ]).toArray();
      
      // Format booking stats
      const stats = {
        totalBookings: 0,
        pendingBookings: 0,
        confirmedBookings: 0,
        completedBookings: 0,
        cancelledBookings: 0,
        totalRevenue: 0
      };
      
      bookingStats.forEach(stat => {
        stats.totalBookings += stat.count;
        stats[`${stat._id}Bookings`] = stat.count;
        stats.totalRevenue += stat.totalRevenue || 0;
      });
      
      // Format verification status for display
      let verificationBadge = null;
      if (listing.isVerified) {
        verificationBadge = {
          type: 'verified',
          label: 'Verified',
          color: 'green',
          icon: 'check-circle'
        };
      } else if (listing.verificationStatus === 'pending') {
        verificationBadge = {
          type: 'pending',
          label: 'Verification Pending',
          color: 'yellow',
          icon: 'clock'
        };
      } else if (listing.verificationStatus === 'rejected') {
        verificationBadge = {
          type: 'rejected',
          label: 'Verification Rejected',
          color: 'red',
          icon: 'x-circle'
        };
      }
      
      // Add admin badges
      const adminBadges = listing.badges?.map(badge => {
        const badgeConfigs = {
          'verified': { label: 'Verified', color: 'green', icon: 'shield-check' },
          'premium': { label: 'Premium', color: 'purple', icon: 'star' },
          'new': { label: 'New', color: 'blue', icon: 'sparkles' },
          'trending': { label: 'Trending', color: 'orange', icon: 'trending-up' },
          'best_value': { label: 'Best Value', color: 'teal', icon: 'award' }
        };
        return badgeConfigs[badge] || { label: badge, color: 'gray', icon: 'badge' };
      }) || [];
      
      return {
        ...listing,
        verificationBadge,
        adminBadges,
        bookingStats: stats,
        performance: {
          viewToBookingRatio: listing.views > 0 ? ((stats.confirmedBookings / listing.views) * 100).toFixed(1) : 0,
          avgRating: listing.rating || 0,
          reviewCount: listing.reviewCount || 0
        }
      };
    }));
    
    const total = await housesCollection.countDocuments(query);
    
    // Get statistics for owner dashboard
    const ownerStats = await housesCollection.aggregate([
      { $match: { ownerId, status: 'approved' } },
      { $group: { 
        _id: "$verificationStatus", 
        count: { $sum: 1 },
        totalViews: { $sum: "$views" },
        totalFavorites: { $sum: "$favorites" },
        avgRating: { $avg: "$rating" }
      }}
    ]).toArray();
    
    const verificationStats = ownerStats.reduce((acc, stat) => {
      acc[stat._id] = {
        count: stat.count,
        totalViews: stat.totalViews,
        totalFavorites: stat.totalFavorites,
        avgRating: stat.avgRating
      };
      return acc;
    }, {});
    
    // Get overall owner stats
    const overallStats = {
      totalProperties: await housesCollection.countDocuments({ ownerId, status: 'approved' }),
      verifiedProperties: await housesCollection.countDocuments({ ownerId, isVerified: true }),
      pendingVerification: await housesCollection.countDocuments({ ownerId, verificationStatus: 'pending' }),
      totalViews: listingsWithStats.reduce((sum, listing) => sum + (listing.views || 0), 0),
      totalFavorites: listingsWithStats.reduce((sum, listing) => sum + (listing.favorites || 0), 0),
      totalRevenue: listingsWithStats.reduce((sum, listing) => sum + (listing.bookingStats?.totalRevenue || 0), 0)
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Owner listings retrieved successfully',
        listings: listingsWithStats,
        verificationStats,
        overallStats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        verificationSummary: {
          verifiedCount: overallStats.verifiedProperties,
          pendingCount: overallStats.pendingVerification,
          verificationRate: overallStats.totalProperties > 0 
            ? ((overallStats.verifiedProperties / overallStats.totalProperties) * 100).toFixed(1)
            : 0
        }
      })
    };
    
  } catch (error) {
    console.error('Owner listings error:', error);
    
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