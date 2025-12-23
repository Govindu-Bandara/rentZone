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
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    const userId = new ObjectId(decoded.userId);
    
    const db = await connectToDatabase();
    const notificationsCollection = db.collection('notifications');
    
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      const query = { userId };
      
      // Filter by read status
      if (params.unreadOnly === 'true') {
        query.isRead = false;
      }
      
      // Filter by category
      if (params.category && params.category !== 'all') {
        query.category = params.category;
      }
      
      // Filter by priority
      if (params.priority && params.priority !== 'all') {
        query.priority = params.priority;
      }
      
      // Pagination
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;
      
      // Get notifications
      const notifications = await notificationsCollection.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      // Get unread count
      const unreadCount = await notificationsCollection.countDocuments({
        userId,
        isRead: false
      });
      
      // Get counts by category
      const categoryCounts = await notificationsCollection.aggregate([
        { $match: { userId, isRead: false } },
        { $group: { _id: "$category", count: { $sum: 1 } } }
      ]).toArray();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          notifications,
          counts: {
            total: await notificationsCollection.countDocuments(query),
            unread: unreadCount,
            byCategory: categoryCounts.reduce((acc, item) => {
              acc[item._id] = item.count;
              return acc;
            }, {})
          },
          pagination: {
            page,
            limit,
            total: await notificationsCollection.countDocuments(query)
          }
        })
      };
    }
    
    if (event.httpMethod === 'PUT') {
      const notificationId = event.pathParameters?.id;
      const body = JSON.parse(event.body);
      const { action } = body;
      
      if (action === 'markAsRead' && notificationId) {
        if (!ObjectId.isValid(notificationId)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid notification ID' })
          };
        }
        
        const result = await notificationsCollection.updateOne(
          { _id: new ObjectId(notificationId), userId },
          {
            $set: {
              isRead: true,
              readAt: new Date()
            }
          }
        );
        
        if (result.modifiedCount === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Notification not found' })
          };
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Notification marked as read' 
          })
        };
      }
      
      if (action === 'markAllAsRead') {
        const result = await notificationsCollection.updateMany(
          { userId, isRead: false },
          {
            $set: {
              isRead: true,
              readAt: new Date()
            }
          }
        );
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'All notifications marked as read',
            modifiedCount: result.modifiedCount
          })
        };
      }
      
      if (action === 'delete') {
        if (!notificationId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Notification ID required' })
          };
        }
        
        const result = await notificationsCollection.deleteOne({
          _id: new ObjectId(notificationId),
          userId
        });
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: result.deletedCount > 0,
            message: 'Notification deleted'
          })
        };
      }
    }
    
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action' })
    };
    
  } catch (error) {
    console.error('❌ Notifications error:', error);
    
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
        details: error.message 
      })
    };
  }
};