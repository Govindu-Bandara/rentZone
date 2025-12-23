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
      source: 'admin_user_management',
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
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS'
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
        body: JSON.stringify({ error: 'Only admins can manage users' })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const housesCollection = db.collection('houses');
    const bookingsCollection = db.collection('bookings');
    
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      const query = { role: { $ne: 'admin' } };
      
      if (params.role && params.role !== 'All Roles') {
        const roleFilter = params.role.toLowerCase();
        if (roleFilter === 'renter' || roleFilter === 'owner') {
          query.role = roleFilter;
        }
      }
      
      if (params.status) {
        if (params.status === 'Active') {
          query.isActive = true;
          query.isSuspended = { $ne: true };
        } else if (params.status === 'Suspended') {
          query.isSuspended = true;
        } else if (params.status === 'Inactive') {
          query.isActive = false;
        }
      }
      
      if (params.search) {
        const searchRegex = new RegExp(params.search, 'i');
        query.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex }
        ];
      }
      
      if (params.verified === 'true') {
        query.isVerified = true;
      } else if (params.verified === 'false') {
        query.isVerified = false;
      }
      
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;
      
      let sort = { createdAt: -1 };
      if (params.sortBy === 'name') sort = { firstName: 1, lastName: 1 };
      if (params.sortBy === 'email') sort = { email: 1 };
      if (params.sortBy === 'joined') sort = { createdAt: -1 };
      if (params.sortBy === 'lastLogin') sort = { lastLogin: -1 };
      
      const users = await usersCollection.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .project({ password: 0 })
        .toArray();
      
      const enrichedUsers = await Promise.all(users.map(async (user) => {
        let properties = 0;
        let bookings = 0;
        let totalRevenue = 0;
        
        if (user.role === 'owner') {
          properties = await housesCollection.countDocuments({ ownerId: user._id });
          
          const ownerBookings = await bookingsCollection.aggregate([
            { $match: { ownerId: user._id, paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: "$totalDueToday" }, count: { $sum: 1 } } }
          ]).toArray();
          
          bookings = ownerBookings[0]?.count || 0;
          totalRevenue = ownerBookings[0]?.total || 0;
        }
        
        if (user.role === 'renter') {
          const renterBookings = await bookingsCollection.aggregate([
            { $match: { renterId: user._id, paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: "$totalDueToday" }, count: { $sum: 1 } } }
          ]).toArray();
          
          bookings = renterBookings[0]?.count || 0;
          totalRevenue = renterBookings[0]?.total || 0;
        }
        
        return {
          ...user,
          properties,
          bookings,
          totalRevenue,
          status: user.isSuspended ? 'Suspended' : (user.isActive ? 'Active' : 'Inactive')
        };
      }));
      
      const total = await usersCollection.countDocuments(query);
      
      const userQuery = { role: { $ne: 'admin' } };
      const totalUsers = await usersCollection.countDocuments(userQuery);
      const activeUsers = await usersCollection.countDocuments({ 
        ...userQuery,
        isActive: true, 
        isSuspended: { $ne: true } 
      });
      const totalOwners = await usersCollection.countDocuments({ role: 'owner' });
      const totalRenters = await usersCollection.countDocuments({ role: 'renter' });
      const suspendedUsers = await usersCollection.countDocuments({ 
        ...userQuery,
        isSuspended: true 
      });
      const verifiedUsers = await usersCollection.countDocuments({ 
        ...userQuery,
        isVerified: true 
      });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Users retrieved successfully',
          users: enrichedUsers,
          summary: {
            total: totalUsers,
            active: activeUsers,
            owners: totalOwners,
            renters: totalRenters,
            suspended: suspendedUsers,
            verified: verifiedUsers,
            note: 'Admin accounts are excluded from user statistics'
          },
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        })
      };
    }
    
    if (event.httpMethod === 'PUT') {
      const userId = event.pathParameters?.id;
      
      if (!userId || !ObjectId.isValid(userId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid user ID is required' })
        };
      }
      
      const body = JSON.parse(event.body);
      const { action, reason, role } = body;
      
      const validActions = ['suspend', 'activate', 'change_role', 'verify'];
      if (!validActions.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid action. Must be one of: ${validActions.join(', ')}` 
          })
        };
      }
      
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      
      if (!user) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'User not found' })
        };
      }
      
      if (user.role === 'admin') {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ 
            error: 'Cannot modify admin accounts through user management',
            message: 'Admin accounts must be managed separately'
          })
        };
      }
      
      const updateFields = {
        updatedAt: new Date(),
        updatedBy: new ObjectId(decoded.userId)
      };
      
      let message = '';
      const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
      
      switch (action) {
        case 'suspend':
          updateFields.isSuspended = true;
          updateFields.isActive = false;
          updateFields.suspendedAt = new Date();
          updateFields.suspensionReason = reason || 'No reason provided';
          updateFields.suspendedBy = new ObjectId(decoded.userId);
          message = `User ${user.email} has been suspended`;
          
          await logSystemActivity(db, 'WARNING', 'Admin',
            `User suspended: ${user.email}`,
            decoded.email,
            ipAddress,
            {
              userId: userId,
              userEmail: user.email,
              suspendedBy: decoded.email,
              reason: reason || 'No reason provided',
              previousStatus: user.isSuspended ? 'suspended' : 'active'
            }
          );
          break;
          
        case 'activate':
          updateFields.isSuspended = false;
          updateFields.isActive = true;
          updateFields.activatedAt = new Date();
          updateFields.activatedBy = new ObjectId(decoded.userId);
          message = `User ${user.email} has been activated`;
          
          await logSystemActivity(db, 'INFO', 'Admin',
            `User activated: ${user.email}`,
            decoded.email,
            ipAddress,
            {
              userId: userId,
              userEmail: user.email,
              activatedBy: decoded.email,
              previousStatus: user.isSuspended ? 'suspended' : 'inactive'
            }
          );
          break;
          
        case 'change_role':
          if (!role || !['renter', 'owner'].includes(role)) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ 
                error: 'Valid role (renter or owner) is required',
                message: 'Cannot change user role to admin'
              })
            };
          }
          
          updateFields.role = role;
          updateFields.roleChangedAt = new Date();
          updateFields.previousRole = user.role;
          updateFields.roleChangedBy = new ObjectId(decoded.userId);
          updateFields.roleChangeReason = reason || 'No reason provided';
          message = `User ${user.email} role changed from ${user.role} to ${role}`;
          
          await logSystemActivity(db, 'INFO', 'Admin',
            `User role changed: ${user.email} from ${user.role} to ${role}`,
            decoded.email,
            ipAddress,
            {
              userId: userId,
              userEmail: user.email,
              changedBy: decoded.email,
              previousRole: user.role,
              newRole: role,
              reason: reason || 'No reason provided'
            }
          );
          break;
          
        case 'verify':
          updateFields.isVerified = true;
          updateFields.verifiedAt = new Date();
          updateFields.verifiedBy = new ObjectId(decoded.userId);
          message = `User ${user.email} has been verified`;
          
          await logSystemActivity(db, 'INFO', 'Admin',
            `User verified: ${user.email}`,
            decoded.email,
            ipAddress,
            {
              userId: userId,
              userEmail: user.email,
              verifiedBy: decoded.email
            }
          );
          break;
      }
      
      const auditEntry = {
        action,
        performedBy: decoded.userId,
        performedByEmail: decoded.email,
        reason: reason || 'No reason provided',
        timestamp: new Date(),
        previousValues: {
          isActive: user.isActive,
          isSuspended: user.isSuspended,
          role: user.role,
          isVerified: user.isVerified
        }
      };
      
      const result = await usersCollection.findOneAndUpdate(
        { _id: new ObjectId(userId) },
        { 
          $set: updateFields,
          $push: { auditTrail: auditEntry }
        },
        { returnDocument: 'after', projection: { password: 0 } }
      );
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message,
          user: result,
          action: action
        })
      };
    }
    
    if (event.httpMethod === 'DELETE') {
      const userId = event.pathParameters?.id;
      
      if (!userId || !ObjectId.isValid(userId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid user ID is required' })
        };
      }
      
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      
      if (!user) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'User not found' })
        };
      }
      
      if (user.role === 'admin') {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ 
            error: 'Cannot delete admin accounts',
            message: 'Admin accounts must be managed separately'
          })
        };
      }
      
      if (user.role === 'owner') {
        const activeListings = await housesCollection.countDocuments({ 
          ownerId: user._id,
          status: 'approved',
          isActive: true
        });
        
        if (activeListings > 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Cannot delete owner with active listings',
              message: 'Please deactivate or transfer all listings first, or suspend the account instead',
              activeListings: activeListings
            })
          };
        }
      }
      
      const activeBookings = await bookingsCollection.countDocuments({
        $or: [
          { renterId: user._id },
          { ownerId: user._id }
        ],
        status: { $in: ['pending', 'approved', 'confirmed', 'active'] }
      });
      
      if (activeBookings > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Cannot delete user with active bookings',
            message: 'Please complete or cancel all bookings first, or suspend the account instead',
            activeBookings: activeBookings
          })
        };
      }
      
      const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
      await logSystemActivity(db, 'WARNING', 'Admin',
        `User deleted: ${user.email}`,
        decoded.email,
        ipAddress,
        {
          userId: userId,
          userEmail: user.email,
          deletedBy: decoded.email,
          reason: 'Account deleted by admin'
        }
      );
      
      const result = await usersCollection.findOneAndUpdate(
        { _id: new ObjectId(userId) },
        { 
          $set: {
            isActive: false,
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: new ObjectId(decoded.userId),
            deletedByEmail: decoded.email,
            email: `deleted_${Date.now()}_${user.email}`,
            updatedAt: new Date()
          },
          $push: {
            auditTrail: {
              action: 'delete',
              performedBy: decoded.userId,
              performedByEmail: decoded.email,
              reason: 'Account deleted by admin',
              timestamp: new Date()
            }
          }
        },
        { returnDocument: 'after', projection: { password: 0 } }
      );
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `User ${user.firstName} ${user.lastName} has been deleted`,
          userId: userId,
          deletedAt: new Date()
        })
      };
    }
    
  } catch (error) {
    console.error('Admin users error:', error);
    
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    await logSystemActivity(db, 'ERROR', 'Admin',
      `Admin user management error: ${error.message}`,
      decoded?.email || null,
      ipAddress,
      {
        error: error.message,
        action: event.httpMethod,
        path: event.path
      }
    );
    
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