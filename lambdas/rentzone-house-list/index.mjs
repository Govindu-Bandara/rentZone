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

function verifyTokenIfPresent(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.substring(7);
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.log('Token verification failed:', error.message);
    return null;
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================
// FUZZY MATCHING: Levenshtein distance for typo tolerance
// ============================================================
function levenshteinDistance(a, b) {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 0;
  
  const matrix = [];
  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower.charAt(i - 1) === aLower.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[bLower.length][aLower.length];
}

// Check if two strings are similar enough (fuzzy match)
function isFuzzyMatch(search, target, maxDistance = 2) {
  const distance = levenshteinDistance(search, target);
  return distance <= maxDistance;
}

// Check partial city match (e.g., "Colombo" matches "Colombo 05" or "Colombo 07")
function isPartialCityMatch(searchCity, propertyCity) {
  if (!searchCity || !propertyCity) return false;
  
  const searchLower = searchCity.toLowerCase().trim();
  const propertyLower = propertyCity.toLowerCase().trim();
  
  // Exact match
  if (searchLower === propertyLower) return true;
  
  // One contains the other (e.g., "Colombo" in "Colombo 05")
  if (propertyLower.includes(searchLower) || searchLower.includes(propertyLower)) {
    return true;
  }
  
  // Fuzzy match on base city name
  const searchParts = searchLower.split(/\s+/);
  const propertyParts = propertyLower.split(/\s+/);
  
  // Check if first part matches (fuzzy)
  if (searchParts.length > 0 && propertyParts.length > 0) {
    return isFuzzyMatch(searchParts[0], propertyParts[0], 2);
  }
  
  return false;
}

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
        amenities: params.amenities
          ? (Array.isArray(params.amenities) ? params.amenities : params.amenities.split(','))
          : [],
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
  }
}

// ============================================================
// NL Search Helpers
// ============================================================

const PROPERTY_SYNONYMS = {
  'annex':           'Boarding Place',
  'annexe':          'Boarding Place',
  'boarding':        'Boarding Place',
  'room':            'Boarding Place',
  'hostel':          'Boarding Place',
  'lodging':         'Boarding Place',
  'flat':            'Apartment',
  'studio':          'Apartment',
  'condo':           'Apartment',
  'condominium':     'Apartment',
  'villa':           'House',
  'bungalow':        'House',
  'home':            'House',
  'residence':       'House',
  'duplex':          'House',
  'holiday rental':  'Short-Stay Rental',
  'vacation rental': 'Short-Stay Rental',
  'guest house':     'Short-Stay Rental',
  'guesthouse':      'Short-Stay Rental',
  'airbnb':          'Short-Stay Rental',
};

const SPELL_CORRECTIONS = {
  'jayawardena':  'jayawardenapura',
  'jayawardhana': 'jayawardenapura',
  'jayawardane':  'jayawardenapura',
  'colpmbo':      'colombo',
  'columbo':      'colombo',
  'canddy':       'kandy',
  'candy':        'kandy',
  'gale':         'galle',
  'trinco':       'trincomalee',
  'jaffana':      'jaffna',
};

function applySpellCorrections(text) {
  if (!text) return text;
  let result = text.toLowerCase();
  for (const [wrong, right] of Object.entries(SPELL_CORRECTIONS)) {
    result = result.replace(new RegExp(`\\b${wrong}\\b`, 'g'), right);
  }
  return result;
}

function expandSearchTerms(searchStr) {
  const normalized = applySpellCorrections(searchStr);
  const expansions = new Set([normalized, searchStr]);
  for (const [syn, canonical] of Object.entries(PROPERTY_SYNONYMS)) {
    if (normalized.includes(syn)) {
      expansions.add(canonical.toLowerCase());
      expansions.add(canonical);
    }
  }
  return [...expansions];
}

function buildSearchQuery(searchStr) {
  const terms = expandSearchTerms(searchStr);
  const orClauses = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    orClauses.push(
      { title:               regex },
      { description:         regex },
      { 'location.address':  regex },
      { 'location.city':     regex },
      { 'location.district': regex },
      { 'location.landmark': regex },
      { 'location.province': regex },
      { tags:                regex },
      { propertyType:        regex },
      { amenities:           regex },
    );
  }
  return { $or: orClauses };
}

// ============================================================
// SMART FALLBACK: Intelligent nearest/relevant results
// ============================================================
async function applySmartFallback(db, houses, params, originalQuery, isRenter) {
  if (houses.length > 0) {
    // Already have results
    return { houses, fallback: { applied: false } };
  }

  console.log('🔍 Applying smart fallback - zero exact matches found');
  
  const housesCollection = db.collection('houses');
  const fallbackReasons = [];
  let fallbackHouses = [];

  // FALLBACK LEVEL 1: Partial city name matching (enhanced)
  if (params.city || (params.search && params.search.toLowerCase().includes('colombo'))) {
    const cityToSearch = params.city || params.search;
    console.log('📍 Attempting partial city name match for:', cityToSearch);
    
    const baseQuery = { status: 'approved', isActive: true, 'availability.isAvailable': true };
    // Add other filters from original query if applicable
    if (originalQuery['price.amount']) baseQuery['price.amount'] = originalQuery['price.amount'];
    if (originalQuery['propertyDetails.bedrooms']) baseQuery['propertyDetails.bedrooms'] = originalQuery['propertyDetails.bedrooms'];
    if (originalQuery['propertyDetails.bathrooms']) baseQuery['propertyDetails.bathrooms'] = originalQuery['propertyDetails.bathrooms'];
    if (originalQuery.propertyType) baseQuery.propertyType = originalQuery.propertyType;

    // Get all cities from database
    const allCities = await housesCollection
      .distinct('location.city', baseQuery)
      .then(cities => cities.filter(Boolean));

    const matchingCities = allCities.filter(city => isPartialCityMatch(cityToSearch, city));

    if (matchingCities.length > 0) {
      const partialQuery = { ...baseQuery, 'location.city': { $in: matchingCities } };
      fallbackHouses = await housesCollection
        .find(partialQuery)
        .sort({ rating: -1, views: -1 })
        .limit(20)
        .toArray();

      if (fallbackHouses.length > 0) {
        fallbackReasons.push(`Showing properties in: ${matchingCities.join(', ')}`);
        return {
          houses: fallbackHouses,
          fallback: {
            applied: true,
            type: 'partial_city_match',
            reason: `No exact match for "${cityToSearch}" - showing similar city names`,
            message: fallbackReasons[0],
            searchedFor: cityToSearch,
            fallbackCities: matchingCities
          }
        };
      }
    }
  }

  // FALLBACK LEVEL 2: Keyword fuzzy matching (for title/description)
  if (params.search) {
    console.log('🔤 Attempting fuzzy keyword matching for:', params.search);
    const searchTerms = params.search.toLowerCase().split(/\s+/);

    // Build a more lenient query with partial matches
    const fuzzyOrClauses = [];
    for (const term of searchTerms) {
      if (term.length > 2) {
        const regex = new RegExp(term, 'i');
        fuzzyOrClauses.push(
          { title: regex },
          { description: regex },
          { 'location.city': regex }
        );
      }
    }

    if (fuzzyOrClauses.length > 0) {
      const baseQuery = { status: 'approved', isActive: true, 'availability.isAvailable': true };
      const fuzzyQuery = { ...baseQuery, $or: fuzzyOrClauses };

      fallbackHouses = await housesCollection
        .find(fuzzyQuery)
        .sort({ rating: -1, views: -1 })
        .limit(20)
        .toArray();

      if (fallbackHouses.length > 0) {
        fallbackReasons.push(`Partial matches for keywords: "${params.search}"`);
        return {
          houses: fallbackHouses,
          fallback: {
            applied: true,
            type: 'fuzzy_keyword_match',
            reason: `No exact match for "${params.search}" - showing similar properties`,
            message: fallbackReasons[0],
            searchedFor: params.search,
            matchType: 'fuzzy_keyword'
          }
        };
      }
    }
  }

  // FALLBACK LEVEL 3: Nearby locations based on coordinates
  if (params.latitude && params.longitude) {
    console.log('🗺️ Attempting nearby location search with expanding radius');
    const lat = parseFloat(params.latitude);
    const lon = parseFloat(params.longitude);
    const baseQuery = { status: 'approved', isActive: true, 'availability.isAvailable': true };

    // Try expanding radius: 5km → 10km → 25km → 50km
    for (const radiusKm of [5, 10, 25, 50]) {
      const nearbyHouses = await housesCollection
        .find({ ...baseQuery, 'location.coordinates': { $exists: true } })
        .toArray();

      const housesByDistance = nearbyHouses
        .map(house => ({
          ...house,
          distance: calculateDistance(
            lat, lon,
            house.location.coordinates.latitude,
            house.location.coordinates.longitude
          )
        }))
        .filter(h => h.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 20);

      if (housesByDistance.length > 0) {
        fallbackReasons.push(`Properties within ${radiusKm}km of your location`);
        return {
          houses: housesByDistance,
          fallback: {
            applied: true,
            type: 'nearby_location',
            reason: `No exact match - showing properties near your location`,
            message: fallbackReasons[0],
            radiusKm: radiusKm,
            matchType: 'coordinate_based'
          }
        };
      }
    }
  }

  // FALLBACK LEVEL 4: Properties in same district
  if (params.district) {
    console.log('🏘️ Attempting same-district search');
    const baseQuery = { status: 'approved', isActive: true, 'availability.isAvailable': true };
    const districtHouses = await housesCollection
      .find({ ...baseQuery, 'location.district': new RegExp(params.district, 'i') })
      .sort({ rating: -1, views: -1 })
      .limit(20)
      .toArray();

    if (districtHouses.length > 0) {
      fallbackReasons.push(`Properties in ${params.district} district`);
      return {
        houses: districtHouses,
        fallback: {
          applied: true,
          type: 'same_district',
          reason: `Showing properties in ${params.district} district`,
          message: fallbackReasons[0],
          district: params.district,
          matchType: 'geographic'
        }
      };
    }
  }

  // FALLBACK LEVEL 5: Top rated/verified properties (last resort)
  console.log('⭐ Attempting fallback to featured/verified properties');
  const baseQuery = { status: 'approved', isActive: true, 'availability.isAvailable': true };
  
  // First try verified properties
  let lastResortHouses = await housesCollection
    .find({ ...baseQuery, isVerified: true })
    .sort({ rating: -1, views: -1 })
    .limit(20)
    .toArray();

  if (lastResortHouses.length === 0) {
    // If no verified, get any approved properties
    lastResortHouses = await housesCollection
      .find(baseQuery)
      .sort({ isFeatured: -1, rating: -1, views: -1 })
      .limit(20)
      .toArray();
  }

  if (lastResortHouses.length > 0) {
    const fallbackType = lastResortHouses.some(h => h.isVerified) ? 'verified' : 'featured';
    fallbackReasons.push(`${fallbackType.charAt(0).toUpperCase() + fallbackType.slice(1)} properties in our marketplace`);
    return {
      houses: lastResortHouses,
      fallback: {
        applied: true,
        type: 'featured_properties',
        reason: `No matches found - showing ${fallbackType} properties`,
        message: fallbackReasons[0],
        matchType: fallbackType,
        suggestion: 'Try modifying your search filters or browse our featured listings'
      }
    };
  }

  // No fallback available
  return {
    houses: [],
    fallback: {
      applied: false,
      type: 'no_results',
      reason: 'No properties available matching your criteria',
      message: 'No properties found. Please try adjusting your search.'
    }
  };
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
    const housesCollection    = db.collection('houses');
    const usersCollection     = db.collection('users');
    const favoritesCollection = db.collection('favorites');

    const authHeader = event.headers.Authorization || event.headers.authorization;
    const decoded    = verifyTokenIfPresent(authHeader);
    const params     = event.queryStringParameters || {};

    if (decoded && decoded.role === 'renter' && (params.search || Object.keys(params).length > 0)) {
      await trackSearchHistory(db, decoded.userId, params, event);
    }

    const query      = {};
    const projection = { ownerId: 0, __v: 0, viewedBy: 0 };
    let originalQuery = {}; // For fallback reference - will be set AFTER building query

    // ========== ACCESS CONTROL ==========
    const isAdmin  = decoded && decoded.role === 'admin';
    const isOwner  = decoded && decoded.role === 'owner';
    const isRenter = decoded && decoded.role === 'renter';

    if (!isAdmin && !isOwner) {
      query.status                      = 'approved';
      query.isActive                    = true;
      query['availability.isAvailable'] = true;
    }

    if (params.myListings === 'true' && isOwner) {
      query.ownerId = new ObjectId(decoded.userId);
      delete query.status;
      delete query.isActive;
      delete query['availability.isAvailable'];
      delete projection.ownerId;
    }

    if (isAdmin && params.view === 'all') {
      delete projection.ownerId;
    } else if (isAdmin) {
      query.status = 'approved';
    }

    if ((isAdmin || isOwner) && params.isVerified !== undefined) {
      if (params.isVerified === 'true')  query.isVerified = true;
      if (params.isVerified === 'false') query.isVerified = false;
    }

    // ========== TEXT SEARCH ==========
    if (params.search) {
      const corrected   = applySpellCorrections(params.search);
      const searchQuery = buildSearchQuery(corrected);
      if (query.$or) {
        query.$and = [{ $or: query.$or }, searchQuery];
        delete query.$or;
      } else {
        Object.assign(query, searchQuery);
      }
    }

    // ========== PROPERTY TYPE / CATEGORY ==========
    if (params.rentalType) {
      query.rentalType = params.rentalType;
    }

    if (params.propertyType) {
      query.propertyType = Array.isArray(params.propertyType)
        ? { $in: params.propertyType }
        : params.propertyType;
    }

    if (params.propertyCategory) {
      const categories = Array.isArray(params.propertyCategory)
        ? params.propertyCategory
        : params.propertyCategory.split(',').map(c => c.trim()).filter(Boolean);

      const expandedCategories = new Set(categories);
      for (const cat of categories) {
        const lower = cat.toLowerCase();
        for (const [syn, canonical] of Object.entries(PROPERTY_SYNONYMS)) {
          if (lower === syn) expandedCategories.add(canonical);
        }
      }
      query.propertyType = { $in: [...expandedCategories] };
    }

    // ========== LOCATION ==========
    if (params.city) {
      query['location.city'] = new RegExp(applySpellCorrections(params.city), 'i');
    }

    if (params.location) {
      const locationRegex = new RegExp(applySpellCorrections(params.location), 'i');
      const locationOr = [
        { 'location.city':     locationRegex },
        { 'location.district': locationRegex },
        { 'location.address':  locationRegex },
      ];
      if (query.$and) {
        query.$and.push({ $or: locationOr });
      } else if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: locationOr }];
        delete query.$or;
      } else {
        query.$or = locationOr;
      }
    }

    if (params.district) query['location.district'] = new RegExp(applySpellCorrections(params.district), 'i');
    if (params.province) query['location.province'] = new RegExp(params.province, 'i');
    if (params.country)  query['location.country']  = new RegExp(params.country, 'i');

    // ========== PRICE ==========
    if (params.minPrice || params.maxPrice) {
      query['price.amount'] = {};
      if (params.minPrice) query['price.amount'].$gte = parseFloat(params.minPrice);
      if (params.maxPrice) query['price.amount'].$lte = parseFloat(params.maxPrice);
    }

    if (params.priceRange) {
      const [minPrice, maxPrice] = params.priceRange.split('-').map(Number);
      query['price.amount'] = { $gte: minPrice, $lte: maxPrice };
    }

    // ========== BEDROOMS / BATHROOMS ==========
    const bedroomMap  = { '1+': 1, '2+': 2, '3+': 3, '4+': 4 };
    const bathroomMap = { '1+': 1, '2+': 2, '3+': 3 };

    if (params.bedrooms && params.bedrooms !== 'Any') {
      if (bedroomMap[params.bedrooms] !== undefined) {
        query['propertyDetails.bedrooms'] = { $gte: bedroomMap[params.bedrooms] };
      } else {
        const n = parseInt(params.bedrooms);
        if (!isNaN(n)) query['propertyDetails.bedrooms'] = n;
      }
    }

    if (params.bathrooms && params.bathrooms !== 'Any') {
      if (bathroomMap[params.bathrooms] !== undefined) {
        query['propertyDetails.bathrooms'] = { $gte: bathroomMap[params.bathrooms] };
      } else {
        const n = parseInt(params.bathrooms);
        if (!isNaN(n)) query['propertyDetails.bathrooms'] = n;
      }
    }

    if (params.beds)    query['propertyDetails.beds'] = { $gte: parseInt(params.beds) };
    if (params.minSqft) query['propertyDetails.squareFeet'] = { $gte: parseFloat(params.minSqft) };
    if (params.maxSqft) {
      if (!query['propertyDetails.squareFeet']) query['propertyDetails.squareFeet'] = {};
      query['propertyDetails.squareFeet'].$lte = parseFloat(params.maxSqft);
    }

    if (params.furnishing) query['propertyDetails.furnishingStatus'] = params.furnishing;

    // ========== AMENITIES ==========
    if (params.amenities) {
      const amenities = Array.isArray(params.amenities)
        ? params.amenities
        : params.amenities.split(',');
      query.amenities = { $all: amenities };
    }

    if (params.parking  === 'true') query.amenities = { $in: ['Parking'] };
    if (params.gym      === 'true') query.amenities = { $in: ['Gym'] };
    if (params.pool     === 'true') query.amenities = { $in: ['Swimming Pool', 'Pool'] };
    if (params.laundry  === 'true') query.amenities = { $in: ['Washer/Dryer', 'Laundry'] };
    if (params.ac       === 'true') query.amenities = { $in: ['Air Conditioning', 'AC'] };

    // ========== RULES ==========
    if (params.petFriendly === 'true') query.rules = { $in: ['Pets allowed', 'pets allowed', 'Pet friendly'] };
    if (params.smoking === 'true')     query.rules = { $in: ['Smoking allowed', 'smoking allowed'] };
    else if (params.smoking === 'false') query.rules = { $nin: ['Smoking allowed', 'smoking allowed'] };

    if (params.tags) {
      const tags = Array.isArray(params.tags) ? params.tags : params.tags.split(',');
      query.tags = { $in: tags };
    }

    if (params.featured === 'true') query.isFeatured = true;

    // ========== DATE AVAILABILITY ==========
    if (params.checkIn && params.checkOut) {
      const checkIn  = new Date(params.checkIn);
      const checkOut = new Date(params.checkOut);
      const dateConditions = [
        { $or: [{ 'availability.availableFrom':  { $lte: checkIn  } }, { 'availability.availableFrom':  null }] },
        { $or: [{ 'availability.availableUntil': { $gte: checkOut } }, { 'availability.availableUntil': null }] }
      ];
      if (query.$and) query.$and.push(...dateConditions);
      else            query.$and = dateConditions;
      if (params.checkAvailability === 'true') query['availability.isAvailable'] = true;
    }

    if (params.moveInDate) {
      const moveInDate = new Date(params.moveInDate);
      const moveInCondition = {
        $or: [
          { 'availability.availableFrom': { $lte: moveInDate } },
          { 'availability.availableFrom': null }
        ]
      };
      if (query.$and) query.$and.push(moveInCondition);
      else            query.$and = [moveInCondition];
    }

    if (params.leaseDuration === 'short') query['availability.maxStay'] = { $lte: 6 };
    if (params.leaseDuration === 'long')  query['availability.maxStay'] = { $gt: 6 };

    // ========== RADIUS SEARCH ==========
    let distanceFilter = null;
    if (params.latitude && params.longitude && params.radius) {
      distanceFilter = {
        lat:    parseFloat(params.latitude),
        lon:    parseFloat(params.longitude),
        radius: parseFloat(params.radius)
      };
    }

    // CAPTURE ORIGINAL QUERY FOR FALLBACK (AFTER BUILDING)
    originalQuery = JSON.parse(JSON.stringify(query));

    // ========== SORTING ==========
    let sort = {};
    switch (params.sortBy) {
      case 'price-asc':  sort = { 'price.amount': 1 };                    break;
      case 'price-desc': sort = { 'price.amount': -1 };                   break;
      case 'newest':     sort = { createdAt: -1 };                        break;
      case 'oldest':     sort = { createdAt: 1 };                         break;
      case 'rating':     sort = { rating: -1 };                           break;
      case 'views':      sort = { views: -1 };                            break;
      case 'featured':   sort = { isFeatured: -1, createdAt: -1 };       break;
      case 'distance':   sort = { createdAt: -1 };                        break;
      case 'bedrooms':   sort = { 'propertyDetails.bedrooms': -1 };      break;
      case 'relevance':  sort = { rating: -1, views: -1, createdAt: -1 };break;
      case 'verified':   sort = { isVerified: -1, rating: -1 };          break;
      default:           sort = { isFeatured: -1, createdAt: -1 };
    }

    // ========== PAGINATION ==========
    const page  = parseInt(params.page)  || 1;
    const limit = parseInt(params.limit) || 20;
    const skip  = (page - 1) * limit;

    // ========== FETCH ==========
    const houses = await housesCollection
      .find(query, { projection })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await housesCollection.countDocuments(query);

    // ========== SMART FALLBACK LOGIC (NEW) ==========
    const { houses: finalHouses, fallback } = await applySmartFallback(
      db,
      houses,
      params,
      originalQuery,
      isRenter
    );

    // ========== ENRICH: DISTANCE ==========
    let enrichedHouses = finalHouses;

    if (params.latitude && params.longitude) {
      const lat = parseFloat(params.latitude);
      const lon = parseFloat(params.longitude);

      enrichedHouses = finalHouses.map(house => {
        if (house.location?.coordinates) {
          const distance = calculateDistance(
            lat, lon,
            house.location.coordinates.latitude,
            house.location.coordinates.longitude
          );
          return { ...house, distance: Math.round(distance * 10) / 10 };
        }
        return house;
      });

      if (distanceFilter) {
        enrichedHouses = enrichedHouses.filter(h => h.distance <= distanceFilter.radius);
      }

      if (params.sortBy === 'distance') {
        enrichedHouses.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
      }
    }

    // ========== ENRICH: FAVORITES ==========
    if (isRenter && decoded?.userId) {
      const favoriteHouseIds = await favoritesCollection.find({
        userId:  new ObjectId(decoded.userId),
        houseId: { $in: enrichedHouses.map(h => h._id) }
      }).toArray();

      const favoriteIds = favoriteHouseIds.map(f => f.houseId.toString());
      enrichedHouses = enrichedHouses.map(house => ({
        ...house,
        isFavorite: favoriteIds.includes(house._id.toString())
      }));
    }

    // ========== ENRICH: OWNER INFO ==========
    const shouldEnrichOwner =
      (isAdmin && (params.view === 'all' || params.includeOwner === 'true')) ||
      (isOwner && params.myListings === 'true');

    if (shouldEnrichOwner && enrichedHouses.length > 0) {
      const ownerIds = [
        ...new Set(
          enrichedHouses.map(h => h.ownerId?.toString()).filter(Boolean)
        )
      ];

      if (ownerIds.length > 0) {
        const owners = await usersCollection.find(
          { _id: { $in: ownerIds.map(id => new ObjectId(id)) } },
          { projection: { password: 0, __v: 0 } }
        ).toArray();

        const ownerMap = owners.reduce((map, owner) => {
          map[owner._id.toString()] = {
            _id:          owner._id,
            name:         `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
            firstName:    owner.firstName,
            lastName:     owner.lastName,
            email:        owner.email,
            phone:        owner.phone,
            profileImage: owner.profileImage,
          };
          return map;
        }, {});

        enrichedHouses = enrichedHouses.map(house => ({
          ...house,
          owner: ownerMap[house.ownerId?.toString()] || house.owner || null,
        }));
      }
    }

    // ========== ENRICH: VERIFICATION BADGES ==========
    enrichedHouses = enrichedHouses.map(house => {
      const verificationBadge = house.isVerified ? {
        type:    'verified',
        label:   'Verified',
        color:   'green',
        icon:    'shield-check',
        tooltip: 'Verified by Rent Zone admin'
      } : null;

      const adminBadges = house.isVerified
        ? (house.badges?.map(badge => {
            const badgeConfigs = {
              premium:    { label: 'Premium',    color: 'purple', icon: 'star'        },
              new:        { label: 'New',        color: 'blue',   icon: 'sparkles'    },
              trending:   { label: 'Trending',   color: 'orange', icon: 'trending-up' },
              best_value: { label: 'Best Value', color: 'teal',   icon: 'award'       }
            };
            return badgeConfigs[badge] || { label: badge, color: 'gray', icon: 'badge' };
          }) || [])
        : [];

      return { ...house, verificationBadge, adminBadges };
    });

    // ========== ENRICH: RENTER PREFERENCES ==========
    if (isRenter && decoded?.userId && !params.search && Object.keys(params).length === 0) {
      const user = await usersCollection.findOne(
        { _id: new ObjectId(decoded.userId) },
        { projection: { preferences: 1 } }
      );

      if (user?.preferences) {
        enrichedHouses = enrichedHouses.map(house => {
          let matchScore = 0;
          if (user.preferences.preferredCity &&
              house.location?.city?.toLowerCase().includes(user.preferences.preferredCity.toLowerCase()))
            matchScore += 10;
          if (user.preferences.preferredType && house.propertyType === user.preferences.preferredType)
            matchScore += 5;
          if (user.preferences.minPrice && house.price.amount >= user.preferences.minPrice)
            matchScore += 3;
          if (user.preferences.maxPrice && house.price.amount <= user.preferences.maxPrice)
            matchScore += 3;
          if (user.preferences.minBedrooms &&
              house.propertyDetails?.bedrooms >= user.preferences.minBedrooms)
            matchScore += 2;
          if (user.preferences.amenities && Array.isArray(user.preferences.amenities)) {
            const matchingAmenities = house.amenities?.filter(a =>
              user.preferences.amenities.includes(a)
            ).length || 0;
            matchScore += matchingAmenities;
          }
          if (house.isVerified) matchScore += 5;
          return { ...house, matchScore };
        }).sort((a, b) => b.matchScore - a.matchScore);
      }
    }

    // ========== RESPONSE ==========
    const response = {
      houses: enrichedHouses.map(house => ({
        // Core fields - explicitly included to ensure images are present
        _id: house._id,
        title: house.title,
        description: house.description,
        propertyType: house.propertyType,
        rentalType: house.rentalType,
        
        // Location
        location: house.location,
        
        // Price
        price: house.price,
        
        // Property Details
        propertyDetails: house.propertyDetails,
        
        // IMAGES - EXPLICITLY INCLUDED
        images: house.images || [],
        mainImage: house.mainImage,
        
        // Other details
        amenities: house.amenities,
        rules: house.rules,
        tags: house.tags,
        
        // Status & verification
        status: house.status,
        isActive: house.isActive,
        isVerified: house.isVerified,
        verificationBadge: house.verificationBadge,
        adminBadges: house.adminBadges,
        
        // Stats
        views: house.views,
        favorites: house.favorites,
        rating: house.rating,
        reviewCount: house.reviewCount,
        
        // Availability
        availability: house.availability,
        
        // User-specific
        isFavorite: house.isFavorite,
        distance: house.distance,
        owner: house.owner,
        matchScore: house.matchScore
      })),
      pagination: {
        page,
        limit,
        total: fallback.applied ? enrichedHouses.length : total,
        totalPages: fallback.applied ? 1 : Math.ceil(total / limit),
        hasNext:    !fallback.applied && page * limit < total,
        hasPrev:    page > 1 && !fallback.applied
      },
      filters: {
        applied: Object.keys(params).length > 0,
        params
      },
      fallback: fallback,
      meta: {
        timestamp:        new Date().toISOString(),
        count:            enrichedHouses.length,
        locationBased:    !!(params.latitude && params.longitude),
        searchTracked:    !!(decoded && params.search),
        verifiedCount:    enrichedHouses.filter(h => h.isVerified).length,
        fallbackApplied:  fallback.applied,
        verificationInfo: {
          rentersSeeAll:             true,
          showVerifiedBadgeOnly:     true,
          adminVerificationRequired: true
        }
      }
    };

    if (params.includeMap === 'true') {
      response.mapData = enrichedHouses
        .filter(house => house.location?.coordinates)
        .map(house => ({
          id:          house._id,
          title:       house.title,
          coordinates: house.location.coordinates,
          price:       house.price.amount,
          type:        house.propertyType,
          image:       house.images?.[0],
          rentalType:  house.rentalType,
          bedrooms:    house.propertyDetails?.bedrooms || 0,
          isVerified:  house.isVerified
        }));
    }

    return { statusCode: 200, headers, body: JSON.stringify(response) };

  } catch (error) {
    console.error('List houses error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error:   'Internal server error',
        details: error.message,
        stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
