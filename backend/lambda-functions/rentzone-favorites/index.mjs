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
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
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
        body: JSON.stringify({ error: 'Only renters can manage favorites' })
      };
    }
    
    const db = await connectToDatabase();
    const favoritesCollection = db.collection('favorites');
    const housesCollection = db.collection('houses');
    
    const userId = new ObjectId(decoded.userId);
    
    // GET - Get saved properties
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;
      
      // Get favorite house IDs
      const favorites = await favoritesCollection.find({ userId })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      const favoriteHouseIds = favorites.map(f => f.houseId);
      
      // Get house details
      const houses = await housesCollection.find({
        _id: { $in: favoriteHouseIds },
        status: 'approved',
        isActive: true
      }).toArray();
      
      // Map houses with saved date
      const housesWithSavedDate = houses.map(house => {
        const favorite = favorites.find(f => f.houseId.equals(house._id));
        return {
          ...house,
          savedAt: favorite.createdAt
        };
      });
      
      const total = await favoritesCollection.countDocuments({ userId });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Favorites retrieved successfully',
          houses: housesWithSavedDate,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        })
      };
    }
    
    // POST - Add to favorites
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { houseId } = body;
      
      if (!houseId || !ObjectId.isValid(houseId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid house ID is required' })
        };
      }
      
      // Check if house exists
      const house = await housesCollection.findOne({
        _id: new ObjectId(houseId),
        status: 'approved',
        isActive: true
      });
      
      if (!house) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Property not found' })
        };
      }
      
      // Check if already in favorites
      const existingFavorite = await favoritesCollection.findOne({
        userId,
        houseId: new ObjectId(houseId)
      });
      
      if (existingFavorite) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Property already in favorites' })
        };
      }
      
      // Add to favorites
      const favorite = {
        userId,
        houseId: new ObjectId(houseId),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await favoritesCollection.insertOne(favorite);
      
      // Update house favorites count
      await housesCollection.updateOne(
        { _id: new ObjectId(houseId) },
        { $inc: { favorites: 1 } }
      );
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          message: 'Property added to favorites successfully',
          favorite
        })
      };
    }
    
    // DELETE - Remove from favorites
    if (event.httpMethod === 'DELETE') {
      const houseId = event.pathParameters?.id;
      
      if (!houseId || !ObjectId.isValid(houseId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid house ID is required' })
        };
      }
      
      const result = await favoritesCollection.deleteOne({
        userId,
        houseId: new ObjectId(houseId)
      });
      
      if (result.deletedCount === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Property not found in favorites' })
        };
      }
      
      // Update house favorites count
      await housesCollection.updateOne(
        { _id: new ObjectId(houseId) },
        { $inc: { favorites: -1 } }
      );
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Property removed from favorites successfully',
          houseId
        })
      };
    }
    
  } catch (error) {
    console.error('Favorites error:', error);
    
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