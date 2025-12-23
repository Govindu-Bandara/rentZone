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
      source: 'listing_creation',
      severity: level === 'ERROR' ? 'high' : (level === 'WARNING' ? 'medium' : 'low')
    });
  } catch (error) {
    console.error('Failed to log system activity:', error);
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
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
        body: JSON.stringify({ error: 'Only owners and admins can create house listings' })
      };
    }
    
    const body = JSON.parse(event.body);
    
    const {
      title,
      description,
      rentalType,
      price,
      location,
      propertyDetails,
      propertyType,
      rules,
      amenities,
      images,
      tags,
      availability
    } = body;
    
    if (!title || !description || !rentalType || !location || !propertyDetails || !price || !propertyType) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields: title, description, rentalType, location, propertyDetails, price, propertyType' 
        })
      };
    }
    
    const validRentalTypes = ['daily', 'monthly'];
    
    if (propertyType === 'Short-Stay Rental') {
      if (rentalType !== 'daily') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Short-Stay Rental must be daily basis. Change rentalType to "daily".' 
          })
        };
      }
    } else {
      if (rentalType !== 'monthly') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Apartment, House, and Boarding Place must be monthly basis. Change rentalType to "monthly".' 
          })
        };
      }
    }
    
    if (!validRentalTypes.includes(rentalType)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Invalid rental type. Must be one of: ${validRentalTypes.join(', ')}` })
      };
    }
    
    const validPropertyTypes = ['Apartment', 'House', 'Boarding Place', 'Short-Stay Rental'];
    if (!validPropertyTypes.includes(propertyType)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Invalid property type. Must be one of: ${validPropertyTypes.join(', ')}` })
      };
    }
    
    if (location.coordinates) {
      if (typeof location.coordinates.latitude !== 'number' ||
          typeof location.coordinates.longitude !== 'number') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid latitude and longitude are required for coordinates' })
        };
      }
    }
    
    if (!location.address || !location.city) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Address and city are required in location' })
      };
    }
    
    if (!price.amount || typeof price.amount !== 'number' || price.amount <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid price amount is required' })
      };
    }
    
    if (!price.period) {
      price.period = rentalType === 'daily' ? 'per day' : 'per month';
    }
    
    if (!propertyDetails.bedrooms || propertyDetails.bedrooms < 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Bedrooms count is required in propertyDetails' })
      };
    }
    
    if (!propertyDetails.bathrooms || propertyDetails.bathrooms < 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Bathrooms count is required in propertyDetails' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    
    const parsedAmenities = Array.isArray(amenities) ? amenities : 
                           (amenities ? amenities.split(',').map(a => a.trim()) : []);
    
    const parsedRules = Array.isArray(rules) ? rules : 
                       (rules ? rules.split(',').map(r => r.trim()) : []);
    
    const parsedTags = Array.isArray(tags) ? tags : 
                      (tags ? tags.split(',').map(t => t.trim()) : []);
    
    const newHouse = {
      ownerId: new ObjectId(decoded.userId),
      ownerEmail: decoded.email,
      title: title.trim(),
      description: description.trim(),
      rentalType,
      propertyType,
      location: {
        address: location.address.trim(),
        city: location.city.trim(),
        state: location.state?.trim() || null,
        country: location.country?.trim() || 'Sri Lanka',
        zipCode: location.zipCode?.trim() || null,
        coordinates: location.coordinates ? {
          latitude: location.coordinates.latitude,
          longitude: location.coordinates.longitude
        } : null,
        district: location.district?.trim() || null,
        province: location.province?.trim() || null,
        landmark: location.landmark?.trim() || null
      },
      propertyDetails: {
        bedrooms: parseInt(propertyDetails.bedrooms) || 0,
        bathrooms: parseInt(propertyDetails.bathrooms) || 0,
        squareFeet: parseFloat(propertyDetails.squareFeet) || null,
        furnishingStatus: propertyDetails.furnishingStatus || 'unfurnished',
        beds: parseInt(propertyDetails.beds) || parseInt(propertyDetails.bedrooms) || 1,
        totalRooms: parseInt(propertyDetails.totalRooms) || null,
        floor: parseInt(propertyDetails.floor) || null,
        totalFloors: parseInt(propertyDetails.totalFloors) || null,
        yearBuilt: parseInt(propertyDetails.yearBuilt) || null,
        parkingSpaces: parseInt(propertyDetails.parkingSpaces) || 0
      },
      price: {
        amount: parseFloat(price.amount),
        currency: price.currency?.toUpperCase() || 'LKR',
        period: price.period,
        securityDeposit: price.securityDeposit ? parseFloat(price.securityDeposit) : null,
        cleaningFee: price.cleaningFee ? parseFloat(price.cleaningFee) : null,
        weeklyDiscount: price.weeklyDiscount ? parseFloat(price.weeklyDiscount) : 0,
        monthlyDiscount: price.monthlyDiscount ? parseFloat(price.monthlyDiscount) : 0,
        minMonthsForDiscount: price.minMonthsForDiscount || null
      },
      amenities: parsedAmenities,
      rules: parsedRules,
      tags: parsedTags,
      images: Array.isArray(images) ? images : [],
      availability: {
        isAvailable: availability?.isAvailable !== false,
        availableFrom: availability?.availableFrom ? new Date(availability.availableFrom) : new Date(),
        availableUntil: availability?.availableUntil ? new Date(availability.availableUntil) : null,
        minStay: availability?.minStay || (rentalType === 'daily' ? 1 : 1),
        maxStay: availability?.maxStay || null,
        bookingAdvance: availability?.bookingAdvance || 0
      },
      status: 'approved',
      isActive: true,
      isFeatured: false,
      isVerified: false,
      verificationStatus: 'pending',
      badges: [],
      views: 0,
      favorites: 0,
      rating: 0,
      reviewCount: 0,
      contactInfo: {
        email: decoded.email,
        phone: body.contactPhone || null,
        showPhone: body.showPhone !== false
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      approvedAt: new Date(),
      publishedAt: new Date(),
      verificationHistory: []
    };
    
    const result = await housesCollection.insertOne(newHouse);
    
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    await logSystemActivity(db, 'INFO', 'Listing', 
      `New listing created: ${title}`, 
      decoded.email, 
      ipAddress,
      {
        listingId: result.insertedId.toString(),
        title: title,
        propertyType: propertyType,
        rentalType: rentalType,
        ownerId: decoded.userId,
        ownerEmail: decoded.email,
        price: price.amount,
        city: location.city
      }
    );
    
    const responseHouse = { ...newHouse, _id: result.insertedId };
    delete responseHouse.ownerId;
    
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: 'House listing created successfully',
        houseId: result.insertedId,
        house: responseHouse
      })
    };
    
  } catch (error) {
    console.error('Create house error:', error);
    
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    const title = JSON.parse(event.body)?.title || 'Unknown';
    
    await logSystemActivity(db, 'ERROR', 'Listing',
      `Listing creation failed: ${error.message}`,
      decoded?.email || null,
      ipAddress,
      {
        error: error.message,
        title: title,
        ownerEmail: decoded?.email
      }
    );
    
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' })
      };
    }
    
    if (error.name === 'ValidationError') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Validation error', details: error.message })
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