import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';

const MONGODB_URI = process.env.MONGODB_URI;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

export const handler = async (event) => {
  console.log('WebSocket Connect Event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const queryParams = event.queryStringParameters || {};
  const token = queryParams.token;

  if (!token) {
    return { statusCode: 401, body: 'Missing token' };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId.toString();

    const db = await connectToDatabase();
    const sessionsCollection = db.collection('websocket_sessions');

    // Deactivate any existing active sessions for this user before creating a new one.
    // This prevents stale sessions from causing missed or double-delivered messages
    // when a user reconnects after a crash or network drop.
    await sessionsCollection.updateMany(
      { userId, isActive: true },
      { $set: { isActive: false, disconnectedAt: new Date() } }
    );

    await sessionsCollection.updateOne(
      { connectionId },
      {
        $set: {
          userId,
          connectionId,
          userAgent: event.headers?.['User-Agent'] || 'unknown',
          ipAddress: event.requestContext.identity?.sourceIp || 'unknown',
          isActive: true,
          lastActive: new Date(),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true }
    );

    console.log(`✅ User ${userId} connected: ${connectionId}`);
    return { statusCode: 200, body: 'Connected' };

  } catch (error) {
    console.error('❌ Connection error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return { statusCode: 401, body: 'Invalid token' };
    }
    return { statusCode: 500, body: 'Connection failed' };
  }
};