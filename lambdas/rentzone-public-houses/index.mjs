// rentzone-public-houses.js
import { MongoClient, ObjectId } from 'mongodb';
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

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    
    const params = event.queryStringParameters || {};
    
    // Public query - only show approved, active properties
    const query = {
      status: 'approved',
      isActive: true,
      'availability.isAvailable': true
    };
    
    // For featured properties on landing page
    if (params.featured === 'true') {
      query.isFeatured = true;
    }
    
    // Limit for landing page (max 6 properties)
    const limit = Math.min(parseInt(params.limit) || 6, 12);
    
    const houses = await housesCollection.find(query)
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
    
    // Format response for public view (remove sensitive data)
    const publicHouses = houses.map(house => ({
      _id: house._id,
      title: house.title,
      description: house.description,
      propertyType: house.propertyType,
      rentalType: house.rentalType,
      images: house.images || [],
      price: house.price,
      location: {
        city: house.location?.city,
        district: house.location?.district,
        address: house.location?.address
      },
      propertyDetails: {
        bedrooms: house.propertyDetails?.bedrooms,
        bathrooms: house.propertyDetails?.bathrooms,
        furnishingStatus: house.propertyDetails?.furnishingStatus
      },
      rating: house.rating || 0,
      isFeatured: house.isFeatured || false,
      isVerified: house.isVerified || false,
      createdAt: house.createdAt
    }));
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        houses: publicHouses,
        count: publicHouses.length,
        featured: params.featured === 'true'
      })
    };
    
  } catch (error) {
    console.error('Public houses error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: 'Could not fetch properties'
      })
    };
  }
};