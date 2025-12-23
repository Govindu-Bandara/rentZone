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

function verifyTokenIfPresent(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  try {
    const token = authHeader.substring(7);
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.log('Token verification failed:', error.message);
    return null;
  }
}

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Track search history
async function trackSearchHistory(db, userId, params, event) {
  if (!userId || !params.search) return;
  
  try {
    const searchHistoryCollection = db.collection('search_history');
    
    const searchRecord = {
      userId: new ObjectId(userId),
      searchQuery: params.search,
      filters: {
        location: params.location,
        minPrice: params.minPrice ? parseFloat(params.minPrice) : null,
        maxPrice: params.maxPrice ? parseFloat(params.maxPrice) : null,
        bedrooms: params.bedrooms,
        propertyType: params.propertyType,
        amenities: params.amenities ? (Array.isArray(params.amenities) ? params.amenities : params.amenities.split(',')) : [],
        rentalType: params.rentalType,
        city: params.city,
        district: params.district
      },
      timestamp: new Date(),
      sessionId: event.requestContext?.requestId || Math.random().toString(36).substr(2, 9),
      userAgent: event.headers['User-Agent'] || '',
      ipAddress: event.requestContext?.identity?.sourceIp || ''
    };
    
    await searchHistoryCollection.insertOne(searchRecord);
    console.log('Search tracked for user:', userId, 'query:', params.search);
  } catch (error) {
    console.error('Error tracking search history:', error);
    // Don't fail the request if tracking fails
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
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const favoritesCollection = db.collection('favorites');
    
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const decoded = verifyTokenIfPresent(authHeader);
    const params = event.queryStringParameters || {};
    
    // TRACK SEARCH HISTORY (if user is logged in and searching)
    if (decoded && decoded.role === 'renter' && (params.search || Object.keys(params).length > 0)) {
      await trackSearchHistory(db, decoded.userId, params, event);
    }
    
    const query = {};
    const projection = {
      ownerId: 0,
      __v: 0,
      viewedBy: 0
    };
    
    // ========== ACCESS CONTROL ==========
    const isAdmin = decoded && decoded.role === 'admin';
    const isOwner = decoded && decoded.role === 'owner';
    const isRenter = decoded && decoded.role === 'renter';
    
    // Default filters for public users (renters, owners, guests)
    // IMPORTANT: Renters can see ALL approved properties (verified and unverified)
    if (!isAdmin && !isOwner) {
      query.status = 'approved';
      query.isActive = true;
      query['availability.isAvailable'] = true;
      // NO isVerified filter here - renters see all properties
    }
    
    // For owners viewing their own listings
    if (params.myListings === 'true' && isOwner) {
      query.ownerId = new ObjectId(decoded.userId);
      // Remove public filters for owner's own listings
      delete query.status;
      delete query.isActive;
      delete query['availability.isAvailable'];
      // Show ownerId in response
      delete projection.ownerId;
    }
    
    // For admin viewing all listings
    if (isAdmin && params.view === 'all') {
      // Admin can see everything
    } else if (isAdmin) {
      // Default admin view: approved listings
      query.status = 'approved';
    }
    
    // ========== VERIFICATION FILTER (Only for admin/owner views) ==========
    if ((isAdmin || isOwner) && params.isVerified !== undefined) {
      if (params.isVerified === 'true') {
        query.isVerified = true;
      } else if (params.isVerified === 'false') {
        query.isVerified = false;
      }
    }
    
    // ========== TEXT SEARCH ==========
    if (params.search) {
      const searchRegex = new RegExp(params.search, 'i');
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { 'location.address': searchRegex },
        { 'location.city': searchRegex },
        { 'location.district': searchRegex },
        { 'location.landmark': searchRegex },
        { tags: searchRegex }
      ];
    }
    
    // ========== FILTERS ==========
    
    // Rental Type
    if (params.rentalType) {
      query.rentalType = params.rentalType;
    }
    
    // Property Type - FROM FIGMA DESIGN
    if (params.propertyType) {
      if (Array.isArray(params.propertyType)) {
        query.propertyType = { $in: params.propertyType };
      } else {
        query.propertyType = params.propertyType;
      }
    }
    
    // Property Category Filter (from Figma)
    if (params.propertyCategory) {
      const categories = Array.isArray(params.propertyCategory) 
        ? params.propertyCategory 
        : params.propertyCategory.split(',');
      
      query.propertyType = { $in: categories };
    }
    
    // Location filters
    if (params.location) {
      const locationRegex = new RegExp(params.location, 'i');
      query.$or = [
        { 'location.city': locationRegex },
        { 'location.district': locationRegex },
        { 'location.address': locationRegex }
      ];
    }
    
    if (params.city) {
      query['location.city'] = new RegExp(params.city, 'i');
    }
    
    if (params.district) {
      query['location.district'] = new RegExp(params.district, 'i');
    }
    
    if (params.province) {
      query['location.province'] = new RegExp(params.province, 'i');
    }
    
    if (params.country) {
      query['location.country'] = new RegExp(params.country, 'i');
    }
    
    // Price range - FROM FIGMA DESIGN
    if (params.minPrice || params.maxPrice) {
      query['price.amount'] = {};
      if (params.minPrice) {
        query['price.amount'].$gte = parseFloat(params.minPrice);
      }
      if (params.maxPrice) {
        query['price.amount'].$lte = parseFloat(params.maxPrice);
      }
    }
    
    // Price Range Filter (from Figma - single slider or two inputs)
    if (params.priceRange) {
      const [minPrice, maxPrice] = params.priceRange.split('-').map(Number);
      query['price.amount'] = { $gte: minPrice, $lte: maxPrice };
    }
    
    // Bedrooms - FROM FIGMA DESIGN
    if (params.bedrooms) {
      const bedrooms = params.bedrooms;
      if (bedrooms === 'Any') {
        // No filter
      } else if (bedrooms === '1+') {
        query['propertyDetails.bedrooms'] = { $gte: 1 };
      } else if (bedrooms === '2+') {
        query['propertyDetails.bedrooms'] = { $gte: 2 };
      } else if (bedrooms === '3+') {
        query['propertyDetails.bedrooms'] = { $gte: 3 };
      } else if (bedrooms === '4+') {
        query['propertyDetails.bedrooms'] = { $gte: 4 };
      } else {
        const numBedrooms = parseInt(bedrooms);
        if (!isNaN(numBedrooms)) {
          query['propertyDetails.bedrooms'] = numBedrooms;
        }
      }
    }
    
    // Bathrooms
    if (params.bathrooms) {
      const bathrooms = params.bathrooms;
      if (bathrooms === 'Any') {
        // No filter
      } else if (bathrooms === '1+') {
        query['propertyDetails.bathrooms'] = { $gte: 1 };
      } else if (bathrooms === '2+') {
        query['propertyDetails.bathrooms'] = { $gte: 2 };
      } else if (bathrooms === '3+') {
        query['propertyDetails.bathrooms'] = { $gte: 3 };
      } else {
        const numBathrooms = parseInt(bathrooms);
        if (!isNaN(numBathrooms)) {
          query['propertyDetails.bathrooms'] = numBathrooms;
        }
      }
    }
    
    // Beds
    if (params.beds) {
      query['propertyDetails.beds'] = { $gte: parseInt(params.beds) };
    }
    
    // Square footage
    if (params.minSqft) {
      query['propertyDetails.squareFeet'] = { $gte: parseFloat(params.minSqft) };
    }
    
    if (params.maxSqft) {
      if (!query['propertyDetails.squareFeet']) {
        query['propertyDetails.squareFeet'] = {};
      }
      query['propertyDetails.squareFeet'].$lte = parseFloat(params.maxSqft);
    }
    
    // Furnishing status
    if (params.furnishing) {
      query['propertyDetails.furnishingStatus'] = params.furnishing;
    }
    
    // Amenities (comma-separated or array) - FROM FIGMA DESIGN
    if (params.amenities) {
      const amenities = Array.isArray(params.amenities) 
        ? params.amenities 
        : params.amenities.split(',');
      query.amenities = { $all: amenities };
    }
    
    // Figma amenities filter
    if (params.parking === 'true') {
      if (!query.amenities) query.amenities = {};
      query.amenities = { $in: ['Parking'] };
    }
    
    if (params.petFriendly === 'true') {
      if (!query.rules) query.rules = {};
      query.rules = { $in: ['Pets allowed', 'pets allowed', 'Pet friendly'] };
    }
    
    if (params.gym === 'true') {
      if (!query.amenities) query.amenities = {};
      query.amenities = { $in: ['Gym'] };
    }
    
    if (params.pool === 'true') {
      if (!query.amenities) query.amenities = {};
      query.amenities = { $in: ['Swimming Pool', 'Pool'] };
    }
    
    if (params.laundry === 'true') {
      if (!query.amenities) query.amenities = {};
      query.amenities = { $in: ['Washer/Dryer', 'Laundry'] };
    }
    
    if (params.ac === 'true') {
      if (!query.amenities) query.amenities = {};
      query.amenities = { $in: ['Air Conditioning', 'AC'] };
    }
    
    // Tags
    if (params.tags) {
      const tags = Array.isArray(params.tags)
        ? params.tags
        : params.tags.split(',');
      query.tags = { $in: tags };
    }
    
    // Availability dates
    if (params.checkIn && params.checkOut) {
      const checkIn = new Date(params.checkIn);
      const checkOut = new Date(params.checkOut);
      
      query.$and = [
        {
          $or: [
            { 'availability.availableFrom': { $lte: checkIn } },
            { 'availability.availableFrom': null }
          ]
        },
        {
          $or: [
            { 'availability.availableUntil': { $gte: checkOut } },
            { 'availability.availableUntil': null }
          ]
        }
      ];
      
      // Check for booking conflicts
      if (params.checkAvailability === 'true') {
        // This would require checking the bookings collection
        // For now, we'll just ensure the property is marked as available
        query['availability.isAvailable'] = true;
      }
    }
    
    // Move-in date filter (from Figma)
    if (params.moveInDate) {
      const moveInDate = new Date(params.moveInDate);
      query.$and = [
        {
          $or: [
            { 'availability.availableFrom': { $lte: moveInDate } },
            { 'availability.availableFrom': null }
          ]
        }
      ];
    }
    
    // Lease duration filter (from Figma)
    if (params.leaseDuration) {
      if (params.leaseDuration === 'short') {
        query['availability.maxStay'] = { $lte: 6 }; // 6 months or less
      } else if (params.leaseDuration === 'long') {
        query['availability.maxStay'] = { $gt: 6 }; // More than 6 months
      }
    }
    
    // Featured properties only
    if (params.featured === 'true') {
      query.isFeatured = true;
    }
    
    // Pet friendly
    if (params.petFriendly === 'true') {
      query.rules = { $in: ['Pets allowed', 'pets allowed', 'Pet friendly'] };
    }
    
    // Smoking allowed
    if (params.smoking === 'true') {
      query.rules = { $in: ['Smoking allowed', 'smoking allowed'] };
    } else if (params.smoking === 'false') {
      query.rules = { $nin: ['Smoking allowed', 'smoking allowed'] };
    }
    
    // ========== LOCATION RADIUS SEARCH ==========
    let distanceFilter = null;
    if (params.latitude && params.longitude) {
      const lat = parseFloat(params.latitude);
      const lon = parseFloat(params.longitude);
      
      if (params.radius) {
        const radiusKm = parseFloat(params.radius);
        
        // For MongoDB geospatial queries, we need a 2dsphere index
        // For now, we'll filter in memory
        distanceFilter = { lat, lon, radius: radiusKm };
      }
    }
    
    // ========== SORTING ==========
    let sort = {};
    
    switch (params.sortBy) {
      case 'price-asc':
        sort = { 'price.amount': 1 };
        break;
      case 'price-desc':
        sort = { 'price.amount': -1 };
        break;
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'oldest':
        sort = { createdAt: 1 };
        break;
      case 'rating':
        sort = { rating: -1 };
        break;
      case 'views':
        sort = { views: -1 };
        break;
      case 'featured':
        sort = { isFeatured: -1, createdAt: -1 };
        break;
      case 'distance':
        // Will sort after distance calculation
        sort = { createdAt: -1 };
        break;
      case 'bedrooms':
        sort = { 'propertyDetails.bedrooms': -1 };
        break;
      case 'relevance':
        // For search relevance
        sort = { rating: -1, views: -1, createdAt: -1 };
        break;
      case 'verified':
        // Show verified properties first
        sort = { isVerified: -1, rating: -1 };
        break;
      default:
        sort = { isFeatured: -1, createdAt: -1 };
    }
    
    // ========== PAGINATION ==========
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 20;
    const skip = (page - 1) * limit;
    
    // ========== FETCH DATA ==========
    const houses = await housesCollection
      .find(query, { projection })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const total = await housesCollection.countDocuments(query);
    
    // ========== ENRICH DATA ==========
    let enrichedHouses = houses;
    
    // Calculate distances if location provided
    if (params.latitude && params.longitude) {
      const lat = parseFloat(params.latitude);
      const lon = parseFloat(params.longitude);
      
      enrichedHouses = houses.map(house => {
        if (house.location?.coordinates) {
          const distance = calculateDistance(
            lat,
            lon,
            house.location.coordinates.latitude,
            house.location.coordinates.longitude
          );
          
          return {
            ...house,
            distance: Math.round(distance * 10) / 10 // Round to 1 decimal
          };
        }
        return house;
      });
      
      // Apply radius filter if specified
      if (distanceFilter && distanceFilter.radius) {
        enrichedHouses = enrichedHouses.filter(house => 
          house.distance <= distanceFilter.radius
        );
      }
      
      // Sort by distance if requested
      if (params.sortBy === 'distance') {
        enrichedHouses.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
      }
    }
    
    // Add favorite status for renters
    if (isRenter) {
      const favoriteHouseIds = await favoritesCollection.find({
        userId: new ObjectId(decoded.userId),
        houseId: { $in: enrichedHouses.map(h => h._id) }
      }).toArray();
      
      const favoriteIds = favoriteHouseIds.map(f => f.houseId.toString());
      
      enrichedHouses = enrichedHouses.map(house => ({
        ...house,
        isFavorite: favoriteIds.includes(house._id.toString())
      }));
    }
    
    // Add owner info for admin/owner views
    if ((isAdmin || (isOwner && params.myListings === 'true')) && enrichedHouses.length > 0) {
      const ownerIds = [...new Set(enrichedHouses.map(h => h.ownerId?.toString()).filter(Boolean))];
      
      if (ownerIds.length > 0) {
        const owners = await usersCollection.find(
          { _id: { $in: ownerIds.map(id => new ObjectId(id)) } },
          { projection: { password: 0, __v: 0 } }
        ).toArray();
        
        const ownerMap = owners.reduce((map, owner) => {
          map[owner._id.toString()] = {
            _id: owner._id,
            firstName: owner.firstName,
            lastName: owner.lastName,
            email: owner.email,
            phone: owner.phone,
            profileImage: owner.profileImage
          };
          return map;
        }, {});
        
        enrichedHouses = enrichedHouses.map(house => ({
          ...house,
          owner: ownerMap[house.ownerId?.toString()]
        }));
      }
    }
    
    // ========== ADD VERIFICATION BADGES ==========
    enrichedHouses = enrichedHouses.map(house => {
      // Only show "Verified" badge if property is verified
      // No "pending" badge shown to anyone
      const verificationBadge = house.isVerified ? {
        type: 'verified',
        label: 'Verified',
        color: 'green',
        icon: 'shield-check',
        tooltip: 'Verified by Rent Zone admin'
      } : null;
      
      // Admin badges (only if property is verified)
      const adminBadges = house.isVerified ? (house.badges?.map(badge => {
        const badgeConfigs = {
          'premium': { label: 'Premium', color: 'purple', icon: 'star' },
          'new': { label: 'New', color: 'blue', icon: 'sparkles' },
          'trending': { label: 'Trending', color: 'orange', icon: 'trending-up' },
          'best_value': { label: 'Best Value', color: 'teal', icon: 'award' }
        };
        return badgeConfigs[badge] || { label: badge, color: 'gray', icon: 'badge' };
      }) || []) : [];
      
      return {
        ...house,
        verificationBadge, // null if not verified
        adminBadges // empty array if not verified
      };
    });
    
    // ========== APPLY RENTER PREFERENCES ==========
    if (isRenter && !params.search && Object.keys(params).length === 0) {
      // Get renter preferences if no filters applied
      const user = await usersCollection.findOne(
        { _id: new ObjectId(decoded.userId) },
        { projection: { preferences: 1 } }
      );
      
      if (user?.preferences) {
        // Sort properties based on preferences match score
        enrichedHouses = enrichedHouses.map(house => {
          let matchScore = 0;
          
          if (user.preferences.preferredCity && 
              house.location?.city?.toLowerCase().includes(user.preferences.preferredCity.toLowerCase())) {
            matchScore += 10;
          }
          
          if (user.preferences.preferredType && 
              house.propertyType === user.preferences.preferredType) {
            matchScore += 5;
          }
          
          if (user.preferences.minPrice && house.price.amount >= user.preferences.minPrice) {
            matchScore += 3;
          }
          
          if (user.preferences.maxPrice && house.price.amount <= user.preferences.maxPrice) {
            matchScore += 3;
          }
          
          if (user.preferences.minBedrooms && 
              house.propertyDetails?.bedrooms >= user.preferences.minBedrooms) {
            matchScore += 2;
          }
          
          if (user.preferences.amenities && Array.isArray(user.preferences.amenities)) {
            const matchingAmenities = house.amenities?.filter(amenity => 
              user.preferences.amenities.includes(amenity)
            ).length || 0;
            matchScore += matchingAmenities;
          }
          
          // Boost score for verified properties
          if (house.isVerified) {
            matchScore += 5;
          }
          
          return {
            ...house,
            matchScore
          };
        }).sort((a, b) => b.matchScore - a.matchScore);
      }
    }
    
    // ========== PREPARE RESPONSE ==========
    const response = {
      houses: enrichedHouses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      filters: {
        applied: Object.keys(params).length > 0,
        params: params
      },
      meta: {
        timestamp: new Date().toISOString(),
        count: enrichedHouses.length,
        locationBased: !!(params.latitude && params.longitude),
        searchTracked: !!(decoded && params.search),
        verifiedCount: enrichedHouses.filter(h => h.isVerified).length,
        verificationInfo: {
          rentersSeeAll: true,
          showVerifiedBadgeOnly: true,
          adminVerificationRequired: true
        }
      }
    };
    
    // Add map data if requested
    if (params.includeMap === 'true') {
      response.mapData = enrichedHouses
        .filter(house => house.location?.coordinates)
        .map(house => ({
          id: house._id,
          title: house.title,
          coordinates: house.location.coordinates,
          price: house.price.amount,
          type: house.propertyType,
          image: house.images?.[0],
          rentalType: house.rentalType,
          bedrooms: house.propertyDetails?.bedrooms || 0,
          isVerified: house.isVerified
        }));
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('List houses error:', error);
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