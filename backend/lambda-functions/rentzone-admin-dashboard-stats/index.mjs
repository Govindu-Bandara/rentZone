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
    
    if (decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can access admin dashboard' })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const housesCollection = db.collection('houses');
    const bookingsCollection = db.collection('bookings');
    const reviewsCollection = db.collection('reviews');
    
    // Get time range for statistics (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // ========== USER STATISTICS ==========
    const totalUsers = await usersCollection.countDocuments({});
    const activeUsers = await usersCollection.countDocuments({ isActive: true });
    const totalOwners = await usersCollection.countDocuments({ role: 'owner' });
    const totalRenters = await usersCollection.countDocuments({ role: 'renter' });
    const suspendedUsers = await usersCollection.countDocuments({ isSuspended: true });
    
    // New users in last 30 days
    const newUsersLast30Days = await usersCollection.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    // User growth by day (for chart)
    const userGrowth = await usersCollection.aggregate([
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      { $limit: 30 }
    ]).toArray();
    
    // ========== PROPERTY STATISTICS ==========
    const totalProperties = await housesCollection.countDocuments({});
    const approvedProperties = await housesCollection.countDocuments({ status: 'approved' });
    const pendingProperties = await housesCollection.countDocuments({ status: 'pending' });
    const activeProperties = await housesCollection.countDocuments({ isActive: true });
    const featuredProperties = await housesCollection.countDocuments({ isFeatured: true });
    
    // Properties by type
    const propertiesByType = await housesCollection.aggregate([
      { $group: { _id: "$propertyType", count: { $sum: 1 } } }
    ]).toArray();
    
    // ========== BOOKING STATISTICS ==========
    const totalBookings = await bookingsCollection.countDocuments({});
    const confirmedBookings = await bookingsCollection.countDocuments({ status: 'confirmed' });
    const activeBookings = await bookingsCollection.countDocuments({ status: 'active' });
    const completedBookings = await bookingsCollection.countDocuments({ status: 'completed' });
    const cancelledBookings = await bookingsCollection.countDocuments({ status: 'cancelled' });
    
    // Revenue statistics
    const revenueStats = await bookingsCollection.aggregate([
      { 
        $match: { 
          status: { $in: ['confirmed', 'active', 'completed'] } 
        } 
      },
      { 
        $group: { 
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
          averageBookingValue: { $avg: "$totalAmount" },
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    // Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyRevenue = await bookingsCollection.aggregate([
      { 
        $match: { 
          status: { $in: ['confirmed', 'active', 'completed'] },
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          revenue: { $sum: "$totalAmount" },
          bookings: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]).toArray();
    
    // ========== REVIEW STATISTICS ==========
    const totalReviews = await reviewsCollection.countDocuments({});
    const averageRating = await reviewsCollection.aggregate([
      { $group: { _id: null, average: { $avg: "$rating" } } }
    ]).toArray();
    
    // ========== FRAUD MONITORING STATISTICS ==========
    // (Based on your screenshot - flagged accounts)
    const highRiskUsers = await usersCollection.countDocuments({ 
      riskScore: { $gte: 70 },
      isFlagged: true 
    });
    
    const mediumRiskUsers = await usersCollection.countDocuments({ 
      riskScore: { $gte: 40, $lt: 70 },
      isFlagged: true 
    });
    
    const lowRiskUsers = await usersCollection.countDocuments({ 
      riskScore: { $lt: 40 },
      isFlagged: true 
    });
    
    // ========== RECENT ACTIVITIES ==========
    const recentActivities = await Promise.all([
      // Recent registrations
      usersCollection.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .project({ 
          firstName: 1, 
          lastName: 1, 
          email: 1, 
          role: 1, 
          createdAt: 1 
        })
        .toArray(),
      
      // Recent properties
      housesCollection.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .project({ 
          title: 1, 
          propertyType: 1, 
          status: 1, 
          'price.amount': 1, 
          createdAt: 1 
        })
        .toArray(),
      
      // Recent bookings
      bookingsCollection.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .project({ 
          totalAmount: 1, 
          status: 1, 
          checkInDate: 1, 
          checkOutDate: 1, 
          createdAt: 1 
        })
        .toArray()
    ]);
    
    // ========== PERFORMANCE METRICS ==========
    // System uptime (you'd get this from CloudWatch)
    const systemUptime = 99.9; // Placeholder
    
    // Response time metrics
    const avgResponseTime = 250; // Placeholder in ms
    
    // ========== PREPARE RESPONSE ==========
    const stats = {
      userStats: {
        total: totalUsers,
        active: activeUsers,
        owners: totalOwners,
        renters: totalRenters,
        suspended: suspendedUsers,
        newLast30Days: newUsersLast30Days,
        growthData: userGrowth.map(item => ({
          date: `${item._id.year}-${item._id.month}-${item._id.day}`,
          count: item.count
        }))
      },
      propertyStats: {
        total: totalProperties,
        approved: approvedProperties,
        pending: pendingProperties,
        active: activeProperties,
        featured: featuredProperties,
        byType: propertiesByType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      },
      bookingStats: {
        total: totalBookings,
        confirmed: confirmedBookings,
        active: activeBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        revenue: revenueStats[0]?.totalRevenue || 0,
        avgBookingValue: revenueStats[0]?.averageBookingValue || 0,
        monthlyRevenue: monthlyRevenue.map(item => ({
          month: `${item._id.year}-${item._id.month}`,
          revenue: item.revenue,
          bookings: item.bookings
        }))
      },
      reviewStats: {
        total: totalReviews,
        avgRating: averageRating[0]?.average || 0
      },
      fraudMonitoring: {
        highRisk: highRiskUsers,
        mediumRisk: mediumRiskUsers,
        lowRisk: lowRiskUsers,
        totalFlagged: highRiskUsers + mediumRiskUsers + lowRiskUsers
      },
      recentActivities: {
        users: recentActivities[0],
        properties: recentActivities[1],
        bookings: recentActivities[2]
      },
      systemMetrics: {
        uptime: systemUptime,
        avgResponseTime: avgResponseTime,
        activeSessions: Math.floor(Math.random() * 100) + 50, // Placeholder
        serverLoad: 'Normal' // Placeholder
      },
      overviewCards: [
        {
          title: 'Total Revenue',
          value: `$${(revenueStats[0]?.totalRevenue || 0).toLocaleString()}`,
          change: '+12.5%',
          trend: 'up',
          icon: '💰'
        },
        {
          title: 'Active Users',
          value: activeUsers.toLocaleString(),
          change: '+8.2%',
          trend: 'up',
          icon: '👥'
        },
        {
          title: 'Properties Listed',
          value: totalProperties.toLocaleString(),
          change: '+5.3%',
          trend: 'up',
          icon: '🏠'
        },
        {
          title: 'Bookings',
          value: totalBookings.toLocaleString(),
          change: '+15.7%',
          trend: 'up',
          icon: '📅'
        }
      ]
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Admin dashboard stats retrieved successfully',
        stats,
        meta: {
          timestamp: new Date().toISOString(),
          period: 'last 30 days',
          generatedBy: decoded.email
        }
      })
    };
    
  } catch (error) {
    console.error('Admin dashboard error:', error);
    
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