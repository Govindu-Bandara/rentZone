// Lambda: rentzone-notifications
// Routes: GET /notification  |  PUT /notification/:id  |  PUT /notification/all
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
    WithDecryption: true,
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
  return jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
};

function respond(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const decoded    = verifyToken(authHeader);
    const userId     = new ObjectId(decoded.userId);

    const db                      = await connectToDatabase();
    const notificationsCollection = db.collection('notifications');

    // ── GET /notification ──
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};

      const query = { userId };
      if (params.unreadOnly === 'true')                        query.isRead   = false;
      if (params.category && params.category !== 'all')        query.category = params.category;
      if (params.priority && params.priority !== 'all')        query.priority = params.priority;

      const page  = Math.max(1, parseInt(params.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
      const skip  = (page - 1) * limit;

      const [notifications, unreadCount, categoryCounts, total] = await Promise.all([
        notificationsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        notificationsCollection.countDocuments({ userId, isRead: false }),
        notificationsCollection.aggregate([
          { $match: { userId, isRead: false } },
          { $group: { _id: '$category', count: { $sum: 1 } } },
        ]).toArray(),
        notificationsCollection.countDocuments(query),
      ]);

      return respond(200, {
        success: true,
        notifications,
        counts: {
          total,
          unread: unreadCount,
          byCategory: categoryCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {}),
        },
        pagination: { page, limit, total },
      });
    }

    // ── PUT /notification/:id  or  PUT /notification/all ──
    if (event.httpMethod === 'PUT') {
      const notificationId = event.pathParameters?.id;
      const body           = JSON.parse(event.body || '{}');
      const { action }     = body;

      // Mark single as read
      if (action === 'markAsRead' && notificationId && notificationId !== 'all') {
        if (!ObjectId.isValid(notificationId)) {
          return respond(400, { error: 'Invalid notification ID' });
        }

        const result = await notificationsCollection.updateOne(
          { _id: new ObjectId(notificationId), userId },
          { $set: { isRead: true, readAt: new Date() } }
        );

        // 200 even if already read — optimistic UI friendliness
        return respond(200, {
          success: true,
          message: result.modifiedCount > 0 ? 'Notification marked as read' : 'Already read',
        });
      }

      // Mark all as read
      if (action === 'markAllAsRead') {
        const result = await notificationsCollection.updateMany(
          { userId, isRead: false },
          { $set: { isRead: true, readAt: new Date() } }
        );

        return respond(200, {
          success: true,
          message: 'All notifications marked as read',
          modifiedCount: result.modifiedCount,
        });
      }

      // Delete single
      if (action === 'delete' && notificationId) {
        if (!ObjectId.isValid(notificationId)) {
          return respond(400, { error: 'Invalid notification ID' });
        }

        const result = await notificationsCollection.deleteOne({
          _id: new ObjectId(notificationId),
          userId,
        });

        return respond(200, {
          success: result.deletedCount > 0,
          message: result.deletedCount > 0 ? 'Notification deleted' : 'Notification not found',
        });
      }

      // Delete all
      if (action === 'deleteAll') {
        const result = await notificationsCollection.deleteMany({ userId });
        return respond(200, {
          success: true,
          message: `${result.deletedCount} notifications deleted`,
          deletedCount: result.deletedCount,
        });
      }

      return respond(400, {
        error: 'Invalid action. Use markAsRead, markAllAsRead, delete, or deleteAll.',
      });
    }

    return respond(405, { error: 'Method not allowed' });

  } catch (error) {
    console.error('Notifications handler error:', error);
    if (error.name === 'JsonWebTokenError')    return respond(401, { error: 'Invalid token' });
    if (error.name === 'TokenExpiredError')    return respond(401, { error: 'Session expired. Please log in again.' });
    if (error.message === 'No token provided') return respond(401, { error: 'Unauthorized' });
    return respond(500, { error: 'Internal server error', details: error.message });
  }
};