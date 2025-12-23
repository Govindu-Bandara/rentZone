rentzone-recently-viewed
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

// Helper function to ensure all houses have viewedBy as array
async function ensureViewedByArrays(db) {
  try {
    const housesCollection = db.collection('houses');
    
    // Update all houses where viewedBy doesn't exist or is null
    await housesCollection.updateMany(
      {
        $or: [
          { viewedBy: { $exists: false } },
          { viewedBy: null },
          { viewedBy: { $type: 'null' } }
        ]
      },
      {
        $set: { viewedBy: [] }
      }
    );
    
    console.log('✅ Ensured all houses have viewedBy as array');
  } catch (error) {
    console.error('❌ Error ensuring viewedBy arrays:', error);
    // Don't fail the request
  }
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
        body: JSON.stringify({ error: 'Only renters can access recently viewed' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const favoritesCollection = db.collection('favorites');
    
    // Ensure all houses have viewedBy as array
    await ensureViewedByArrays(db);
    
    const userId = new ObjectId(decoded.userId);
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit) || 10;
    const daysLimit = parseInt(params.days) || 14;
    
    // Calculate date threshold
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysLimit);
    
    // ========== MAIN AGGREGATION - FIXED VERSION ==========
    
    const recentlyViewed = await housesCollection.aggregate([
      {
        $match: {
          'viewedBy.userId': userId,
          'viewedBy.viewedAt': { $gte: thresholdDate },
          status: 'approved',
          isActive: true,
          'availability.isAvailable': true
        }
      },
      {
        $addFields: {
          // Ensure viewedBy is always an array
          viewedBy: { $ifNull: ["$viewedBy", []] }
        }
      },
      {
        $addFields: {
          userViews: {
            $filter: {
              input: "$viewedBy",
              as: "view",
              cond: {
                $and: [
                  { $eq: ["$$view.userId", userId] },
                  { $gte: ["$$view.viewedAt", thresholdDate] }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          lastViewed: { 
            $max: "$userViews.viewedAt" 
          },
          viewCount: { 
            $size: "$userViews" 
          }
        }
      },
      {
        $project: {
          _id: 1,
          title: 1,
          description: 1,
          propertyType: 1,
          rentalType: 1,
          images: 1,
          price: 1,
          location: 1,
          propertyDetails: 1,
          amenities: 1,
          rating: 1,
          reviewCount: 1,
          isFeatured: 1,
          lastViewed: 1,
          viewCount: 1,
          views: 1
        }
      },
      {
        $sort: { lastViewed: -1 }
      },
      {
        $limit: limit
      }
    ]).toArray();
    
    // ========== ENRICH WITH FAVORITE STATUS ==========
    
    const favoriteHouseIds = await favoritesCollection.find({
      userId: userId
    }, { projection: { houseId: 1 } }).toArray();
    
    const favoriteIds = favoriteHouseIds.map(f => f.houseId.toString());
    
    const enrichedProperties = recentlyViewed.map(property => {
      const daysAgo = property.lastViewed ? 
        Math.floor((new Date() - new Date(property.lastViewed)) / (1000 * 60 * 60 * 24)) : 
        null;
      
      return {
        _id: property._id,
        title: property.title,
        description: property.description?.substring(0, 150) + (property.description?.length > 150 ? '...' : ''),
        propertyType: property.propertyType,
        rentalType: property.rentalType,
        images: property.images || [],
        price: {
          amount: property.price?.amount,
          currency: property.price?.currency || 'LKR',
          period: property.price?.period,
          securityDeposit: property.price?.securityDeposit,
          cleaningFee: property.price?.cleaningFee
        },
        location: {
          address: property.location?.address,
          city: property.location?.city,
          district: property.location?.district,
          landmark: property.location?.landmark
        },
        propertyDetails: {
          bedrooms: property.propertyDetails?.bedrooms || 0,
          bathrooms: property.propertyDetails?.bathrooms || 0,
          beds: property.propertyDetails?.beds || 0,
          squareFeet: property.propertyDetails?.squareFeet,
          furnishingStatus: property.propertyDetails?.furnishingStatus,
          floor: property.propertyDetails?.floor,
          totalFloors: property.propertyDetails?.totalFloors
        },
        amenities: property.amenities?.slice(0, 5) || [],
        rating: property.rating || 0,
        reviewCount: property.reviewCount || 0,
        isFeatured: property.isFeatured || false,
        isFavorite: favoriteIds.includes(property._id.toString()),
        lastViewed: property.lastViewed,
        viewStats: {
          personalViewCount: property.viewCount || 0,
          totalViews: property.views || 0,
          daysAgo: daysAgo,
          lastViewedText: daysAgo === 0 ? 'Today' : 
                         daysAgo === 1 ? 'Yesterday' : 
                         `${daysAgo} days ago`
        }
      };
    });
    
    // ========== GET STATISTICS - FIXED AGGREGATIONS ==========
    
    // Get total recently viewed count
    const recentlyViewedCount = await housesCollection.countDocuments({
      'viewedBy.userId': userId,
      'viewedBy.viewedAt': { $gte: thresholdDate }
    });
    
    // Get viewing trends (last 7 days) - FIXED
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const viewingTrend = await housesCollection.aggregate([
      {
        $addFields: {
          viewedBy: { $ifNull: ["$viewedBy", []] }
        }
      },
      { 
        $unwind: "$viewedBy" 
      },
      {
        $match: {
          "viewedBy.userId": userId,
          "viewedBy.viewedAt": { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$viewedBy.viewedAt" },
            month: { $month: "$viewedBy.viewedAt" },
            day: { $dayOfMonth: "$viewedBy.viewedAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }
      },
      {
        $limit: 7
      }
    ]).toArray();
    
    // Get most viewed property types - FIXED
    const propertyTypeStats = await housesCollection.aggregate([
      {
        $match: {
          'viewedBy.userId': userId,
          'viewedBy.viewedAt': { $gte: thresholdDate }
        }
      },
      {
        $group: {
          _id: "$propertyType",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]).toArray();
    
    // ========== PREPARE RESPONSE ==========
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Recently viewed properties retrieved successfully',
        properties: enrichedProperties,
        stats: {
          totalRecentlyViewed: recentlyViewedCount,
          timePeriod: `${daysLimit} days`,
          viewingTrend: viewingTrend.map(day => ({
            date: new Date(day._id.year, day._id.month - 1, day._id.day).toISOString().split('T')[0],
            count: day.count
          })),
          propertyTypeDistribution: propertyTypeStats.map(stat => ({
            type: stat._id,
            count: stat.count
          })),
          summary: {
            averageViewsPerDay: recentlyViewedCount > 0 ? 
              (recentlyViewedCount / daysLimit).toFixed(1) : 0,
            mostFrequentViewingDay: await getMostFrequentViewingDay(db, userId, thresholdDate),
            lastViewedDate: enrichedProperties.length > 0 ? enrichedProperties[0].lastViewed : null
          }
        },
        pagination: {
          limit,
          total: enrichedProperties.length,
          hasMore: recentlyViewedCount > limit
        },
        meta: {
          userId: decoded.userId,
          timestamp: new Date().toISOString(),
          thresholdDate: thresholdDate.toISOString()
        }
      })
    };
    
  } catch (error) {
    console.error('❌ Recently viewed error:', error);
    
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

// Helper function to get most frequent viewing day - FIXED
async function getMostFrequentViewingDay(db, userId, thresholdDate) {
  const housesCollection = db.collection('houses');
  
  try {
    const dayStats = await housesCollection.aggregate([
      {
        $addFields: {
          viewedBy: { $ifNull: ["$viewedBy", []] }
        }
      },
      { 
        $unwind: "$viewedBy" 
      },
      {
        $match: {
          "viewedBy.userId": userId,
          "viewedBy.viewedAt": { $gte: thresholdDate }
        }
      },
      {
        $group: {
          _id: { $dayOfWeek: "$viewedBy.viewedAt" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 1
      }
    ]).toArray();
    
    if (dayStats.length === 0) return 'No data';
    
    const dayMap = {
      1: 'Sunday',
      2: 'Monday',
      3: 'Tuesday',
      4: 'Wednesday',
      5: 'Thursday',
      6: 'Friday',
      7: 'Saturday'
    };
    
    return dayMap[dayStats[0]._id] || 'Unknown';
  } catch (error) {
    console.error('Error in getMostFrequentViewingDay:', error);
    return 'No data';
  }
}