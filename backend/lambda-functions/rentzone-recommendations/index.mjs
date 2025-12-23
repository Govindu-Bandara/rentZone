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

// ========== RECOMMENDATION ENGINE WITH FIXES ==========

class RecommendationEngine {
  constructor(userId, userData, userHistory) {
    this.userId = userId;
    this.userData = userData;
    this.userHistory = userHistory;
  }
  
  // ========== METHOD 1: CONTENT-BASED FILTERING ==========
  
  async contentBasedRecommendation(db, limit = 24) {
    const housesCollection = db.collection('houses');
    const preferences = this.userData.preferences || {};
    
    let query = {
      status: 'approved',
      isActive: true,
      'availability.isAvailable': true
    };
    
    // Exclude properties user has already viewed
    const viewedProperties = this.userHistory.viewedProperties || [];
    if (viewedProperties.length > 0) {
      query._id = { $nin: viewedProperties };
    }
    
    // Apply user preferences
    if (preferences.preferredCity) {
      query['location.city'] = new RegExp(preferences.preferredCity, 'i');
    }
    
    if (preferences.preferredType) {
      query.propertyType = preferences.preferredType;
    }
    
    if (preferences.minPrice || preferences.maxPrice) {
      query['price.amount'] = {};
      if (preferences.minPrice) query['price.amount'].$gte = preferences.minPrice;
      if (preferences.maxPrice) query['price.amount'].$lte = preferences.maxPrice;
    }
    
    if (preferences.minBedrooms) {
      query['propertyDetails.bedrooms'] = { $gte: preferences.minBedrooms };
    }
    
    if (preferences.amenities && preferences.amenities.length > 0) {
      query.amenities = { $in: preferences.amenities };
    }
    
    return await housesCollection.find(query)
      .sort({ rating: -1, views: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
  }
  
  // ========== METHOD 2: COLLABORATIVE FILTERING ==========
  
  async collaborativeFiltering(db, limit = 24) {
    const housesCollection = db.collection('houses');
    
    const similarProperties = await housesCollection.aggregate([
      {
        $match: {
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
          similarViewers: {
            $filter: {
              input: "$viewedBy",
              as: "viewer",
              cond: {
                $and: [
                  { $ne: ["$$viewer.userId", this.userId] },
                  { $eq: ["$$viewer.userType", "renter"] }
                ]
              }
            }
          }
        }
      },
      {
        $match: {
          $expr: { $gt: [{ $size: "$similarViewers" }, 0] }
        }
      },
      {
        $addFields: {
          similarUserCount: { $size: "$similarViewers" },
          similarUserIds: "$similarViewers.userId"
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
          similarUserCount: 1
        }
      },
      {
        $sort: { similarUserCount: -1, rating: -1 }
      },
      {
        $limit: limit
      }
    ]).toArray();
    
    return similarProperties;
  }
  
  // ========== METHOD 3: TRENDING PROPERTIES - FIXED ==========
  
  async trendingRecommendation(db, limit = 24) {
    const housesCollection = db.collection('houses');
    
    // Get properties with high engagement in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    return await housesCollection.aggregate([
      {
        $match: {
          status: 'approved',
          isActive: true,
          'availability.isAvailable': true,
          createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
        }
      },
      {
        $addFields: {
          // Ensure viewedBy is always an array
          viewedBy: { $ifNull: ["$viewedBy", []] },
          // Ensure favorites exists
          favorites: { $ifNull: ["$favorites", 0] },
          // Ensure views exists
          views: { $ifNull: ["$views", 0] },
          // Ensure rating exists
          rating: { $ifNull: ["$rating", 0] }
        }
      },
      {
        $addFields: {
          recentViews: {
            $size: {
              $filter: {
                input: "$viewedBy",
                as: "view",
                cond: { 
                  $and: [
                    { $ne: ["$$view", null] },
                    { $gte: ["$$view.viewedAt", sevenDaysAgo] }
                  ]
                }
              }
            }
          },
          engagementScore: {
            $add: [
              { $multiply: ["$views", 0.3] },
              { $multiply: ["$favorites", 0.4] },
              { $multiply: ["$rating", 20] },
              { $multiply: ["$recentViews", 0.5] }
            ]
          }
        }
      },
      {
        $sort: { engagementScore: -1 }
      },
      {
        $limit: limit
      }
    ]).toArray();
  }
  
  // ========== METHOD 4: SEARCH HISTORY BASED ==========
  
  async searchHistoryRecommendation(db, limit = 24) {
    const searchHistoryCollection = db.collection('search_history');
    const housesCollection = db.collection('houses');
    
    // Get user's recent searches (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentSearches = await searchHistoryCollection.find({
      userId: this.userId,
      timestamp: { $gte: thirtyDaysAgo },
      searchQuery: { $ne: null, $ne: '' }
    })
    .sort({ timestamp: -1 })
    .limit(20)
    .toArray();
    
    if (recentSearches.length === 0) {
      return [];
    }
    
    // Analyze search patterns
    const searchPatterns = this.analyzeSearchPatterns(recentSearches);
    
    // Build query based on search patterns
    const query = this.buildQueryFromSearchPatterns(searchPatterns);
    
    // Add basic filters
    query.status = 'approved';
    query.isActive = true;
    query['availability.isAvailable'] = true;
    
    // Exclude already viewed properties
    const viewedProperties = this.userHistory.viewedProperties || [];
    if (viewedProperties.length > 0) {
      query._id = { $nin: viewedProperties };
    }
    
    // Get recommendations
    return await housesCollection.find(query)
      .sort({ createdAt: -1, rating: -1 })
      .limit(limit)
      .toArray();
  }
  
  analyzeSearchPatterns(searches) {
    const patterns = {
      frequentLocations: {},
      frequentPropertyTypes: {},
      priceRanges: [],
      commonAmenities: new Set(),
      searchKeywords: []
    };
    
    searches.forEach(search => {
      // Extract location patterns
      if (search.filters?.location) {
        const location = search.filters.location.toLowerCase().trim();
        patterns.frequentLocations[location] = 
          (patterns.frequentLocations[location] || 0) + 1;
      }
      
      // Extract property type patterns
      if (search.filters?.propertyType) {
        const type = search.filters.propertyType;
        patterns.frequentPropertyTypes[type] = 
          (patterns.frequentPropertyTypes[type] || 0) + 1;
      }
      
      // Extract price patterns
      if (search.filters?.minPrice || search.filters?.maxPrice) {
        patterns.priceRanges.push({
          min: search.filters.minPrice,
          max: search.filters.maxPrice
        });
      }
      
      // Extract amenities
      if (search.filters?.amenities) {
        const amenitiesArray = Array.isArray(search.filters.amenities) 
          ? search.filters.amenities 
          : search.filters.amenities.split(',');
        
        amenitiesArray.forEach(amenity => {
          if (amenity && amenity.trim()) {
            patterns.commonAmenities.add(amenity.trim());
          }
        });
      }
      
      // Extract keywords from search query
      if (search.searchQuery) {
        const keywords = search.searchQuery.toLowerCase()
          .split(/\s+/)
          .filter(word => word.length > 2); // Filter out short words
        patterns.searchKeywords.push(...keywords);
      }
    });
    
    return patterns;
  }
  
  buildQueryFromSearchPatterns(patterns) {
    const query = {};
    const conditions = [];
    
    // Location (use most frequent)
    const sortedLocations = Object.entries(patterns.frequentLocations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3); // Top 3 locations
    
    if (sortedLocations.length > 0) {
      const locationConditions = sortedLocations.map(([location]) => ({
        $or: [
          { 'location.city': new RegExp(location, 'i') },
          { 'location.address': new RegExp(location, 'i') },
          { 'location.district': new RegExp(location, 'i') },
          { 'location.landmark': new RegExp(location, 'i') }
        ]
      }));
      
      conditions.push({ $or: locationConditions });
    }
    
    // Property type (use most frequent)
    const sortedTypes = Object.entries(patterns.frequentPropertyTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    
    if (sortedTypes.length > 0) {
      query.propertyType = { $in: sortedTypes.map(([type]) => type) };
    }
    
    // Price range (calculate average)
    if (patterns.priceRanges.length > 0) {
      const minPrices = patterns.priceRanges.map(r => r.min).filter(price => price && price > 0);
      const maxPrices = patterns.priceRanges.map(r => r.max).filter(price => price && price > 0);
      
      if (minPrices.length > 0 || maxPrices.length > 0) {
        query['price.amount'] = {};
        
        if (minPrices.length > 0) {
          const avgMinPrice = minPrices.reduce((a, b) => a + b, 0) / minPrices.length;
          query['price.amount'].$gte = avgMinPrice * 0.8; // 20% below average
        }
        
        if (maxPrices.length > 0) {
          const avgMaxPrice = maxPrices.reduce((a, b) => a + b, 0) / maxPrices.length;
          query['price.amount'].$lte = avgMaxPrice * 1.2; // 20% above average
        }
      }
    }
    
    // Amenities (most common)
    if (patterns.commonAmenities.size > 0) {
      query.amenities = { 
        $in: Array.from(patterns.commonAmenities).slice(0, 5) 
      };
    }
    
    // Text search on frequent keywords
    const keywordFrequency = {};
    patterns.searchKeywords.forEach(keyword => {
      keywordFrequency[keyword] = (keywordFrequency[keyword] || 0) + 1;
    });
    
    const frequentKeywords = Object.entries(keywordFrequency)
      .filter(([_, count]) => count > 1) // Appeared at least twice
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([keyword]) => keyword);
    
    if (frequentKeywords.length > 0) {
      conditions.push({
        $or: [
          { title: { $regex: frequentKeywords.join('|'), $options: 'i' } },
          { description: { $regex: frequentKeywords.join('|'), $options: 'i' } },
          { tags: { $in: frequentKeywords } }
        ]
      });
    }
    
    // Combine conditions
    if (conditions.length > 0) {
      query.$and = conditions;
    }
    
    return query;
  }
  
  // ========== METHOD 5: HYBRID RECOMMENDATION ==========
  
  async getHybridRecommendations(db, limit = 24) {
    const weights = {
      content: 0.25,
      collaborative: 0.20,
      trending: 0.15,
      searchHistory: 0.30,
      diversity: 0.10
    };
    
    const [
      contentBased,
      collaborative,
      trending,
      searchBased
    ] = await Promise.all([
      this.contentBasedRecommendation(db, Math.ceil(limit * weights.content)),
      this.collaborativeFiltering(db, Math.ceil(limit * weights.collaborative)),
      this.trendingRecommendation(db, Math.ceil(limit * weights.trending)),
      this.searchHistoryRecommendation(db, Math.ceil(limit * weights.searchHistory))
    ]);
    
    // Combine all recommendations
    const allRecs = [
      ...contentBased.map(p => ({ property: p, source: 'preferences', weight: weights.content })),
      ...collaborative.map(p => ({ property: p, source: 'similar_users', weight: weights.collaborative })),
      ...trending.map(p => ({ property: p, source: 'trending', weight: weights.trending })),
      ...searchBased.map(p => ({ property: p, source: 'search_history', weight: weights.searchHistory }))
    ];
    
    // Weighted aggregation
    const propertyScores = new Map();
    
    allRecs.forEach(rec => {
      const propertyId = rec.property._id.toString();
      const current = propertyScores.get(propertyId) || {
        property: rec.property,
        score: 0,
        sources: []
      };
      
      current.score += rec.weight;
      current.sources.push(rec.source);
      propertyScores.set(propertyId, current);
    });
    
    // Sort by score
    const sortedRecs = Array.from(propertyScores.values())
      .sort((a, b) => b.score - a.score);
    
    // Add diversity: ensure different property types are represented
    const finalRecs = [];
    const propertyTypeCount = {};
    
    for (const rec of sortedRecs) {
      const propertyType = rec.property.propertyType;
      
      if (!propertyTypeCount[propertyType]) {
        propertyTypeCount[propertyType] = 0;
      }
      
      // Limit same property type to max 2
      if (propertyTypeCount[propertyType] < 2) {
        finalRecs.push(rec);
        propertyTypeCount[propertyType]++;
      }
      
      if (finalRecs.length >= limit) break;
    }
    
    // If we don't have enough recommendations, add more
    if (finalRecs.length < limit) {
      const remaining = sortedRecs
        .filter(rec => !finalRecs.some(f => f.property._id.toString() === rec.property._id.toString()))
        .slice(0, limit - finalRecs.length);
      
      finalRecs.push(...remaining);
    }
    
    return finalRecs.map(rec => rec.property);
  }
  
  // ========== METHOD 6: PERSONALIZED SCORING ==========
  
  calculatePersonalizedScore(property, userPreferences, userHistory) {
    let score = 50; // Base score
    
    // Price match (20 points max)
    if (userPreferences.maxPrice && property.price?.amount && property.price.amount <= userPreferences.maxPrice) {
      const priceRatio = property.price.amount / userPreferences.maxPrice;
      score += (1 - priceRatio) * 20; // Lower price gets higher score
    }
    
    // Location match (15 points)
    if (userPreferences.preferredCity && 
        property.location?.city?.toLowerCase().includes(userPreferences.preferredCity.toLowerCase())) {
      score += 15;
    }
    
    // Property type match (10 points)
    if (userPreferences.preferredType === property.propertyType) {
      score += 10;
    }
    
    // Bedrooms match (10 points)
    if (userPreferences.minBedrooms && 
        property.propertyDetails?.bedrooms && 
        property.propertyDetails.bedrooms >= userPreferences.minBedrooms) {
      score += 10;
    }
    
    // Amenities match (15 points)
    if (userPreferences.amenities && property.amenities) {
      const matchingAmenities = property.amenities.filter(amenity => 
        userPreferences.amenities.includes(amenity)
      ).length;
      score += Math.min(matchingAmenities * 3, 15); // Max 15 points
    }
    
    // Rating boost (10 points max)
    if (property.rating >= 4.5) score += 10;
    else if (property.rating >= 4.0) score += 7;
    else if (property.rating >= 3.5) score += 4;
    
    // Popularity boost (5 points)
    if (property.views > 100) score += 3;
    if (property.favorites > 10) score += 2;
    
    // Recency boost (5 points for new listings)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (property.createdAt > thirtyDaysAgo) {
      score += 5;
    }
    
    // Cap at 100
    return Math.min(score, 100);
  }
}

// ========== MAIN HANDLER ==========

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
        body: JSON.stringify({ error: 'Only renters can get recommendations' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const bookingsCollection = db.collection('bookings');
    const favoritesCollection = db.collection('favorites');
    const searchHistoryCollection = db.collection('search_history');
    
    const userId = new ObjectId(decoded.userId);
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit) || 24;
    const algorithm = params.algorithm || 'hybrid';
    
    // ========== GET USER DATA ==========
    
    const user = await usersCollection.findOne(
      { _id: userId },
      { projection: { 
        preferences: 1, 
        firstName: 1, 
        lastName: 1,
        profileImage: 1 
      } }
    );
    
    // ========== GET USER HISTORY ==========
    
    const [viewedHouses, favoriteHouses, bookingHistory, searchHistory] = await Promise.all([
      housesCollection.find({
        'viewedBy.userId': userId
      }, { projection: { _id: 1 } }).toArray(),
      
      favoritesCollection.find({
        userId: userId
      }, { projection: { houseId: 1 } }).toArray(),
      
      bookingsCollection.find({
        renterId: userId,
        status: { $in: ['confirmed', 'completed'] }
      }, { projection: { houseId: 1 } }).toArray(),
      
      searchHistoryCollection.find({
        userId: userId
      }, { 
        projection: { searchQuery: 1, filters: 1, timestamp: 1 },
        sort: { timestamp: -1 },
        limit: 50
      }).toArray()
    ]);
    
    const userHistory = {
      viewedProperties: viewedHouses.map(h => h._id),
      favoriteProperties: favoriteHouses.map(f => f.houseId),
      bookedProperties: bookingHistory.map(b => b.houseId),
      searchHistory: searchHistory
    };
    
    // ========== INITIALIZE RECOMMENDATION ENGINE ==========
    
    const engine = new RecommendationEngine(userId, user, userHistory);
    let recommendations;
    
    // ========== GET RECOMMENDATIONS ==========
    
    try {
      switch (algorithm) {
        case 'content':
          recommendations = await engine.contentBasedRecommendation(db, limit);
          break;
        case 'collaborative':
          recommendations = await engine.collaborativeFiltering(db, limit);
          break;
        case 'trending':
          recommendations = await engine.trendingRecommendation(db, limit);
          break;
        case 'search':
          recommendations = await engine.searchHistoryRecommendation(db, limit);
          break;
        case 'hybrid':
        default:
          recommendations = await engine.getHybridRecommendations(db, limit);
          break;
      }
    } catch (recError) {
      console.error('❌ Recommendation error:', recError);
      // Fallback to simple content-based recommendations
      recommendations = await engine.contentBasedRecommendation(db, limit);
    }
    
    // ========== FORMAT RECOMMENDATIONS ==========
    
    const formattedRecommendations = recommendations.map(property => {
      // Calculate personalized score
      const personalizedScore = engine.calculatePersonalizedScore(
        property, 
        user?.preferences || {}, 
        userHistory
      );
      
      // Check if property is in favorites
      const isFavorite = userHistory.favoriteProperties.some(id => 
        id.equals(property._id)
      );
      
      // Generate match reasons
      const matchReasons = generateMatchReasons(property, user?.preferences || {});
      
      return {
        _id: property._id,
        title: property.title,
        description: property.description?.substring(0, 120) + (property.description?.length > 120 ? '...' : ''),
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
        tags: property.tags?.slice(0, 3) || [],
        rating: property.rating || 0,
        reviewCount: property.reviewCount || 0,
        isFeatured: property.isFeatured || false,
        isFavorite: isFavorite,
        matchScore: personalizedScore.toFixed(1),
        matchReasons: matchReasons,
        meta: {
          views: property.views || 0,
          favorites: property.favorites || 0,
          createdAt: property.createdAt,
          updatedAt: property.updatedAt
        }
      };
    });
    
    // Sort by match score
    formattedRecommendations.sort((a, b) => parseFloat(b.matchScore) - parseFloat(a.matchScore));
    
    // ========== PREPARE RESPONSE ==========
    
    const response = {
      message: 'Recommendations retrieved successfully',
      recommendations: formattedRecommendations,
      algorithm: algorithm,
      userPreferences: user?.preferences || {},
      searchHistorySummary: {
        totalSearches: userHistory.searchHistory.length,
        recentSearches: userHistory.searchHistory.slice(0, 3).map(s => s.searchQuery),
        hasSearchHistory: userHistory.searchHistory.length > 0
      },
      meta: {
        total: formattedRecommendations.length,
        timestamp: new Date().toISOString(),
        userId: decoded.userId,
        algorithmWeights: algorithm === 'hybrid' ? {
          content: '25%',
          collaborative: '20%',
          trending: '15%',
          searchHistory: '30%',
          diversity: '10%'
        } : null
      }
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('❌ Recommendations error:', error);
    
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

// Helper function to generate match reasons
function generateMatchReasons(property, preferences) {
  const reasons = [];
  
  // Price match
  if (preferences.maxPrice && property.price?.amount && property.price.amount <= preferences.maxPrice) {
    const priceRatio = (property.price.amount / preferences.maxPrice) * 100;
    if (priceRatio <= 80) reasons.push('Great price within your budget');
    else if (priceRatio <= 100) reasons.push('Fits your budget');
  }
  
  // Location match
  if (preferences.preferredCity && 
      property.location?.city?.toLowerCase().includes(preferences.preferredCity.toLowerCase())) {
    reasons.push(`Located in ${preferences.preferredCity}`);
  }
  
  // Property type match
  if (preferences.preferredType === property.propertyType) {
    reasons.push(`Matches your preferred ${property.propertyType} type`);
  }
  
  // Bedrooms match
  if (preferences.minBedrooms && property.propertyDetails?.bedrooms && 
      property.propertyDetails.bedrooms >= preferences.minBedrooms) {
    reasons.push(`Has ${property.propertyDetails.bedrooms} bedrooms (meets your requirement)`);
  }
  
  // Rating based reasons
  if (property.rating >= 4.5) reasons.push('Highly rated by other renters');
  else if (property.rating >= 4.0) reasons.push('Well-reviewed property');
  
  // Popularity based reasons
  if (property.views > 100) reasons.push('Popular among renters');
  if (property.favorites > 10) reasons.push('Frequently saved by renters');
  
  // New listing
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (property.createdAt > thirtyDaysAgo) {
    reasons.push('New listing');
  }
  
  // If no specific reasons, add generic ones
  if (reasons.length === 0) {
    if (property.amenities?.length > 0) {
      reasons.push(`Includes ${property.amenities.slice(0, 2).join(', ')}`);
    }
    if (property.isFeatured) {
      reasons.push('Featured property');
    }
  }
  
  return reasons.slice(0, 3); // Return max 3 reasons
}