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

const CATEGORY_COLORS = {
  'Authentication': '#4CAF50',
  'Listing': '#2196F3',
  'Payment': '#FF9800',
  'User': '#9C27B0',
  'Security': '#F44336',
  'Admin': '#607D8B',
  'Database': '#795548'
};

const LEVEL_ICONS = {
  'INFO': 'ℹ️',
  'WARNING': '⚠️',
  'ERROR': '❌'
};

const DEFAULT_LOGS = [
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T14:32:15Z'),
    level: 'INFO',
    category: 'Authentication',
    message: 'User login successful: john@example.com',
    ipAddress: '192.168.1.1',
    userEmail: 'john@example.com',
    details: { userId: 'user123', userAgent: 'Chrome/120.0' }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T14:28:42Z'),
    level: 'WARNING',
    category: 'Listing',
    message: 'Listing verification failed: Missing required images',
    ipAddress: '192.168.1.45',
    userEmail: 'owner@example.com',
    details: { listingId: 'listing123', missingFields: ['images'] }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T14:15:33Z'),
    level: 'ERROR',
    category: 'Payment',
    message: 'Payment processing failed: Invalid card number',
    ipAddress: '192.168.1.78',
    userEmail: 'renter@example.com',
    details: { transactionId: 'txn123', errorCode: 'CARD_INVALID' }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T14:05:12Z'),
    level: 'INFO',
    category: 'User',
    message: 'New user registered: sarai@example.com',
    ipAddress: '192.168.1.92',
    userEmail: 'sarai@example.com',
    details: { userId: 'user456', role: 'renter' }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T13:58:03Z'),
    level: 'INFO',
    category: 'Listing',
    message: 'New listing created: Modern Downtown Loft',
    ipAddress: '192.168.1.45',
    userEmail: 'owner@example.com',
    details: { listingId: 'listing456', title: 'Modern Downtown Loft' }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T13:46:27Z'),
    level: 'WARNING',
    category: 'Security',
    message: 'Multiple failed login attempts detected',
    ipAddress: '192.168.1.156',
    userEmail: null,
    details: { attempts: 5, username: 'unknown@example.com' }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T13:22:18Z'),
    level: 'INFO',
    category: 'Admin',
    message: 'Listing approved by admin',
    ipAddress: '192.168.1.2',
    userEmail: 'admin@example.com',
    details: { adminId: 'admin123', listingId: 'listing789' }
  },
  {
    _id: new ObjectId(),
    timestamp: new Date('2024-12-01T13:21:09Z'),
    level: 'ERROR',
    category: 'Database',
    message: 'Query timeout: Connection pool exhausted',
    ipAddress: 'INTERNAL',
    userEmail: null,
    details: { query: 'SELECT * FROM houses', duration: 30000 }
  }
];

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    if (decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can access system logs' })
      };
    }
    
    const db = await connectToDatabase();
    const systemLogsCollection = db.collection('system_logs');
    
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      const query = {};
      
      const last14Days = new Date();
      last14Days.setDate(last14Days.getDate() - 14);
      
      query.timestamp = { $gte: last14Days };
      
      if (params.level && params.level !== 'All Levels') {
        query.level = params.level.toUpperCase();
      }
      
      if (params.category && params.category !== 'All Categories') {
        query.category = params.category;
      }
      
      if (params.timeRange) {
        let startDate = new Date();
        
        switch (params.timeRange) {
          case 'Last 1 hour':
            startDate.setHours(startDate.getHours() - 1);
            break;
          case 'Last 6 hours':
            startDate.setHours(startDate.getHours() - 6);
            break;
          case 'Last 12 hours':
            startDate.setHours(startDate.getHours() - 12);
            break;
          case 'Last 24 hours':
            startDate.setHours(startDate.getHours() - 24);
            break;
          case 'Last 7 days':
            startDate.setDate(startDate.getDate() - 7);
            break;
          case 'Last 14 days':
            startDate.setDate(startDate.getDate() - 14);
            break;
          case 'Last 30 days':
            startDate.setDate(startDate.getDate() - 30);
            break;
          case 'Custom':
            if (params.startDate && params.endDate) {
              query.timestamp = {
                $gte: new Date(params.startDate),
                $lte: new Date(params.endDate)
              };
            }
            break;
        }
        
        if (params.timeRange !== 'Custom') {
          query.timestamp = { $gte: startDate };
        }
      }
      
      if (params.search) {
        const searchRegex = new RegExp(params.search, 'i');
        query.$or = [
          { message: searchRegex },
          { ipAddress: searchRegex },
          { userEmail: searchRegex }
        ];
      }
      
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 10;
      const skip = (page - 1) * limit;
      
      const sort = { timestamp: -1 };
      
      let logs;
      let total;
      
      try {
        logs = await systemLogsCollection.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .toArray();
        
        total = await systemLogsCollection.countDocuments(query);
        
        if (logs.length === 0 && page === 1 && Object.keys(params).length === 0) {
          logs = DEFAULT_LOGS.slice(skip, skip + limit);
          total = DEFAULT_LOGS.length;
        }
      } catch (dbError) {
        console.log('Database error, using default logs:', dbError.message);
        logs = DEFAULT_LOGS.slice(skip, skip + limit);
        total = DEFAULT_LOGS.length;
      }
      
      const stats = {
        info: logs.filter(log => log.level === 'INFO').length,
        warnings: logs.filter(log => log.level === 'WARNING').length,
        errors: logs.filter(log => log.level === 'ERROR').length,
        total: logs.length
      };
      
      const categoryStats = {};
      logs.forEach(log => {
        categoryStats[log.category] = (categoryStats[log.category] || 0) + 1;
      });
      
      const formattedLogs = logs.map(log => ({
        id: log._id,
        timestamp: log.timestamp.toISOString(),
        formattedTimestamp: formatTimestamp(log.timestamp),
        level: log.level,
        levelIcon: LEVEL_ICONS[log.level] || 'ℹ️',
        category: log.category,
        categoryColor: CATEGORY_COLORS[log.category] || '#607D8B',
        message: log.message,
        ipAddress: log.ipAddress || 'INTERNAL',
        userEmail: log.userEmail || null,
        details: log.details || null
      }));
      
      const uniqueCategories = ['Authentication', 'Listing', 'Payment', 'User', 'Security', 'Admin', 'Database'];
      
      const criticalIssues = logs
        .filter(log => log.level === 'ERROR' && 
          new Date(log.timestamp) >= new Date(Date.now() - 1 * 60 * 60 * 1000))
        .slice(0, 5);
      
      const response = {
        message: 'System logs retrieved successfully',
        logs: formattedLogs,
        statistics: stats,
        categoryDistribution: Object.entries(categoryStats).map(([category, count]) => ({
          _id: category,
          count
        })),
        filters: {
          availableLevels: ['All Levels', 'INFO', 'WARNING', 'ERROR'],
          availableCategories: ['All Categories', ...uniqueCategories],
          availableTimeRanges: [
            'Last 1 hour',
            'Last 6 hours', 
            'Last 12 hours',
            'Last 24 hours',
            'Last 7 days',
            'Last 14 days',
            'Last 30 days',
            'Custom'
          ],
          currentFilters: {
            level: params.level || 'All Levels',
            category: params.category || 'All Categories',
            timeRange: params.timeRange || 'Last 14 days',
            search: params.search || ''
          }
        },
        criticalIssues: criticalIssues.map(issue => ({
          id: issue._id,
          message: issue.message,
          category: issue.category,
          timestamp: issue.timestamp,
          ipAddress: issue.ipAddress
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        },
        exportOptions: {
          formats: ['JSON', 'CSV', 'PDF'],
          maxRecords: 10000
        },
        requestInfo: {
          requestedBy: decoded.email,
          requestedAt: new Date().toISOString(),
          userId: decoded.userId
        }
      };
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response)
      };
    }
    
    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body);
      } catch (parseError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
      }
      
      const { 
        level = 'INFO',
        category,
        message,
        ipAddress,
        userEmail,
        details
      } = body;
      
      if (!category || !message) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Category and message are required fields' 
          })
        };
      }
      
      const validCategories = [
        'Authentication',
        'Listing', 
        'Payment',
        'User',
        'Security',
        'Admin',
        'Database'
      ];
      
      if (!validCategories.includes(category)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid category. Must be one of: ${validCategories.join(', ')}` 
          })
        };
      }
      
      const validLevels = ['INFO', 'WARNING', 'ERROR'];
      if (!validLevels.includes(level)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid level. Must be one of: ${validLevels.join(', ')}` 
          })
        };
      }
      
      const logEntry = {
        level: level.toUpperCase(),
        category,
        message: message.trim(),
        ipAddress: ipAddress || 'INTERNAL',
        userEmail: userEmail || null,
        details: details || null,
        timestamp: new Date(),
        source: decoded?.email || 'system',
        severity: level === 'ERROR' ? 'high' : (level === 'WARNING' ? 'medium' : 'low'),
        createdBy: decoded?.userId || null
      };
      
      let result;
      try {
        result = await systemLogsCollection.insertOne(logEntry);
      } catch (dbError) {
        console.log('Failed to save log to database:', dbError.message);
        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({
            message: 'Log entry created (not saved to database)',
            log: {
              id: new ObjectId(),
              ...logEntry,
              formattedTimestamp: formatTimestamp(logEntry.timestamp)
            }
          })
        };
      }
      
      if (level === 'ERROR') {
        try {
          const similarErrors = await systemLogsCollection.countDocuments({
            category,
            message: { $regex: new RegExp(message.substring(0, 50), 'i') },
            timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
          });
          
          if (similarErrors >= 3) {
            await systemLogsCollection.insertOne({
              level: 'WARNING',
              category: 'Security',
              message: `Recurring error detected in ${category}: ${message.substring(0, 100)}...`,
              ipAddress: 'INTERNAL',
              details: {
                errorCount: similarErrors + 1,
                errorCategory: category,
                firstOccurrence: new Date(Date.now() - 5 * 60 * 1000)
              },
              timestamp: new Date(),
              source: 'error_monitoring',
              severity: 'high'
            });
          }
        } catch (alertError) {
          console.log('Failed to create alert:', alertError.message);
        }
      }
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          message: 'Log entry created successfully',
          logId: result.insertedId,
          log: {
            id: result.insertedId,
            ...logEntry,
            formattedTimestamp: formatTimestamp(logEntry.timestamp)
          }
        })
      };
    }
    
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
    
  } catch (error) {
    console.error('System logs error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Unauthorized',
          details: 'Invalid or missing token'
        })
      };
    }
    
    if (error.name === 'TokenExpiredError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Token expired',
          details: 'The provided token has expired'
        })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}