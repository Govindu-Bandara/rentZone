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

// ============ CORS HEADERS - ALWAYS INCLUDED ============
const getCorsHeaders = () => ({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400'
});

const success = (statusCode, data, message = '') => ({
  statusCode,
  headers: getCorsHeaders(),
  body: JSON.stringify({
    success: true,
    message: message || 'OK',
    data
  })
});

const error = (statusCode, errorMsg, details = {}) => ({
  statusCode,
  headers: getCorsHeaders(),
  body: JSON.stringify({
    success: false,
    error: errorMsg,
    details: process.env.DEBUG_MODE ? details : {}
  })
});

export const handler = async (event) => {
  console.log('Favorites Lambda invoked:', {
    method: event.httpMethod,
    path: event.path,
    headers: Object.keys(event.headers)
  });

  // ============ HANDLE PREFLIGHT ============
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: ''
    };
  }

  try {
    // ============ TOKEN VERIFICATION ============
    const authHeader = event.headers.Authorization || event.headers.authorization;
    let decoded;
    try {
      decoded = verifyToken(authHeader);
    } catch (tokenErr) {
      console.error('Token verification failed:', tokenErr.message);
      return error(401, 'Unauthorized - Invalid or missing token', { error: tokenErr.message });
    }

    // ============ ROLE CHECK ============
    if (decoded.role !== 'renter') {
      return error(403, 'Only renters can manage favorites', { role: decoded.role });
    }

    const db = await connectToDatabase();
    const favoritesCollection = db.collection('favorites');
    const housesCollection = db.collection('houses');
    const userId = new ObjectId(decoded.userId);

    // ============ GET - Retrieve saved properties ============
    if (event.httpMethod === 'GET') {
      try {
        const params = event.queryStringParameters || {};
        const page = parseInt(params.page) || 1;
        const limit = parseInt(params.limit) || 20;
        const skip = (page - 1) * limit;

        // Get favorite IDs
        const favorites = await favoritesCollection
          .find({ userId })
          .skip(skip)
          .limit(limit)
          .toArray();

        const favoriteHouseIds = favorites.map(f => f.houseId);

        // Get house details
        const houses = await housesCollection
          .find({
            _id: { $in: favoriteHouseIds },
            status: 'approved',
            isActive: true
          })
          .toArray();

        // Merge with saved date
        const housesWithSavedDate = houses.map(house => {
          const fav = favorites.find(f => f.houseId.equals(house._id));
          return {
            ...house,
            savedAt: fav?.createdAt || new Date()
          };
        });

        const total = await favoritesCollection.countDocuments({ userId });

        return success(200, {
          houses: housesWithSavedDate,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        }, 'Favorites retrieved successfully');
      } catch (err) {
        console.error('GET /favorites error:', err);
        return error(500, 'Failed to retrieve favorites', { error: err.message });
      }
    }

    // ============ POST - Add to favorites ============
    if (event.httpMethod === 'POST') {
      try {
        let body;
        try {
          body = JSON.parse(event.body || '{}');
        } catch (parseErr) {
          return error(400, 'Invalid JSON body', { error: 'Could not parse request body' });
        }

        const { houseId } = body;

        // Validate houseId
        if (!houseId || !ObjectId.isValid(houseId)) {
          return error(400, 'Valid house ID is required', { houseId: houseId || 'missing' });
        }

        // Check if property exists and is approved
        const house = await housesCollection.findOne({
          _id: new ObjectId(houseId),
          status: 'approved',
          isActive: true
        });

        if (!house) {
          return error(404, 'Property not found or not available', { houseId });
        }

        // Check for duplicate
        const existingFavorite = await favoritesCollection.findOne({
          userId,
          houseId: new ObjectId(houseId)
        });

        if (existingFavorite) {
          return error(409, 'Property already in favorites', { houseId });
        }

        // Add to favorites
        const favorite = {
          userId,
          houseId: new ObjectId(houseId),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const insertResult = await favoritesCollection.insertOne(favorite);

        // Increment house favorites count
        await housesCollection.updateOne(
          { _id: new ObjectId(houseId) },
          { $inc: { favorites: 1 } }
        );

        return success(201, {
          favorite,
          houseId,
          favoriteId: insertResult.insertedId
        }, 'Property added to favorites');
      } catch (err) {
        console.error('POST /favorites error:', err);
        return error(500, 'Failed to add favorite', { error: err.message });
      }
    }

    // ============ DELETE - Remove from favorites ============
    if (event.httpMethod === 'DELETE') {
      try {
        const houseId = event.pathParameters?.id;

        if (!houseId || !ObjectId.isValid(houseId)) {
          return error(400, 'Valid house ID is required', { houseId: houseId || 'missing' });
        }

        // Delete from favorites
        const deleteResult = await favoritesCollection.deleteOne({
          userId,
          houseId: new ObjectId(houseId)
        });

        if (deleteResult.deletedCount === 0) {
          return error(404, 'Property not found in favorites', { houseId });
        }

        // Decrement house favorites count
        await housesCollection.updateOne(
          { _id: new ObjectId(houseId) },
          { $inc: { favorites: -1 } }
        );

        return success(200, { houseId }, 'Property removed from favorites');
      } catch (err) {
        console.error('DELETE /favorites error:', err);
        return error(500, 'Failed to remove favorite', { error: err.message });
      }
    }

    // ============ METHOD NOT ALLOWED ============
    return error(405, `Method ${event.httpMethod} not allowed`, { method: event.httpMethod });

  } catch (err) {
    console.error('Unexpected error:', err);
    return error(500, 'Internal server error', { error: err.message, stack: err.stack });
  }
};