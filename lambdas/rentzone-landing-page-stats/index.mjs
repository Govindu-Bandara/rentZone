import { MongoClient } from 'mongodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
let cachedDb = null;
let cachedConnectionString = null;

async function getConnectionString() {
  if (cachedConnectionString) return cachedConnectionString;

  const command = new GetParameterCommand({
    Name: process.env.MONGODB_URI_PARAM,
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);
  cachedConnectionString = response.Parameter.Value;
  return cachedConnectionString;
}

async function connectToDatabase() {
  if (cachedDb) return cachedDb;

  const connectionString = await getConnectionString();
  const client = await MongoClient.connect(connectionString, {
    serverSelectionTimeoutMS: 10000,
  });
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const bookingsCollection = db.collection('bookings');

    const [
      totalProperties,
      totalRenters,
      totalOwners,
      totalUsers,
      verifiedProperties,
      apartments,
      houses,
      boardingPlaces,
      shortStayRentals,
      activeBookings,
      revenueData,
    ] = await Promise.all([
      housesCollection.countDocuments({
        status: 'approved',
        isActive: true,
        'availability.isAvailable': true,
      }),
      usersCollection.countDocuments({ role: 'renter' }),
      usersCollection.countDocuments({ role: 'owner' }),
      usersCollection.countDocuments({ role: { $ne: 'admin' } }),
      housesCollection.countDocuments({
        status: 'approved',
        isActive: true,
        isVerified: true,
      }),
      housesCollection.countDocuments({
        propertyType: 'Apartment',
        status: 'approved',
        isActive: true,
        'availability.isAvailable': true,
      }),
      housesCollection.countDocuments({
        propertyType: 'House',
        status: 'approved',
        isActive: true,
        'availability.isAvailable': true,
      }),
      housesCollection.countDocuments({
        propertyType: 'Boarding Place',
        status: 'approved',
        isActive: true,
        'availability.isAvailable': true,
      }),
      housesCollection.countDocuments({
        propertyType: 'Short-Stay Rental',
        status: 'approved',
        isActive: true,
        'availability.isAvailable': true,
      }),
      bookingsCollection.countDocuments({
        status: { $in: ['confirmed', 'active'] },
      }),
      bookingsCollection.aggregate([
        { $match: { status: { $in: ['confirmed', 'active', 'completed'] } } },
        { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } },
      ]).toArray(),
    ]);

    const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;
    const verifiedPercentage =
      totalProperties > 0
        ? Math.round((verifiedProperties / totalProperties) * 100)
        : 0;

    const stats = {
      totalProperties,
      totalRenters,
      verifiedPercentage,
      support: '24/7',
      propertyTypes: {
        apartments,
        houses,
        boardingPlaces,
        shortStayRentals,
      },
      platformStats: {
        totalUsers,
        totalOwners,
        activeBookings,
        totalRevenue,
        verifiedProperties,
      },
      lastUpdated: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Landing page statistics retrieved successfully',
        data: stats,
      }),
    };
  } catch (error) {
    console.error('[Landing Stats] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch landing page statistics',
        details: error.message,
      }),
    };
  }
};