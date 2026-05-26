import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
let cachedDb = null;
let cachedParams = {};

async function getParam(name) {
  if (cachedParams[name]) return cachedParams[name];
  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const res = await ssmClient.send(command);
  cachedParams[name] = res.Parameter.Value;
  return cachedParams[name];
}

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const connectionString = await getParam(process.env.MONGODB_URI_PARAM);
  const client = await MongoClient.connect(connectionString);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('No token provided');
  const token = authHeader.substring(7);
  const jwtSecret = process.env.JWT_SECRET;
  return jwt.verify(token, jwtSecret);
}

async function logSystemActivity(db, level, category, message, userEmail, ipAddress, details) {
  try {
    await db.collection('system_logs').insertOne({
      level, category, message,
      ipAddress: ipAddress || 'INTERNAL',
      userEmail: userEmail || null,
      details: details || null,
      timestamp: new Date(),
      source: 'admin_user_management',
      severity: level === 'ERROR' ? 'high' : (level === 'WARNING' ? 'medium' : 'low')
    });
  } catch (error) {
    console.error('Failed to log:', error);
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let db;
  let decoded;
  try {
    decoded = await verifyToken(event.headers.Authorization || event.headers.authorization);
    if (decoded.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only admins can manage users' }) };
    }

    db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const housesCollection = db.collection('houses');
    const bookingsCollection = db.collection('bookings');

    // ── GET /admin/users ──────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const query = { role: { $ne: 'admin' } };

      if (params.role && params.role !== 'All Roles') {
        const roleFilter = params.role.toLowerCase();
        if (['renter', 'owner'].includes(roleFilter)) query.role = roleFilter;
      }
      if (params.status) {
        if (params.status === 'Active') { query.isActive = true; query.isSuspended = { $ne: true }; }
        else if (params.status === 'Suspended') query.isSuspended = true;
        else if (params.status === 'Inactive') query.isActive = false;
      }
      if (params.search) {
        const searchRegex = new RegExp(params.search, 'i');
        query.$or = [{ firstName: searchRegex }, { lastName: searchRegex }, { email: searchRegex }];
      }
      if (params.verified === 'true') query.isVerified = true;
      else if (params.verified === 'false') query.isVerified = false;

      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;

      let sort = { createdAt: -1 };
      if (params.sortBy === 'name') sort = { firstName: 1, lastName: 1 };
      if (params.sortBy === 'email') sort = { email: 1 };
      if (params.sortBy === 'joined') sort = { createdAt: -1 };

      // Project out sensitive fields but keep nicDetails for admin
      const users = await usersCollection.find(query)
        .sort(sort).skip(skip).limit(limit)
        .project({ password: 0, 'emailVerification.otp': 0 })
        .toArray();

      const enrichedUsers = await Promise.all(users.map(async (user) => {
        let properties = 0, bookings = 0, totalRevenue = 0;

        if (user.role === 'owner') {
          properties = await housesCollection.countDocuments({ ownerId: user._id });
          const ownerBookings = await bookingsCollection.aggregate([
            { $match: { ownerId: user._id } },
            { $group: { _id: null, totalRevenue: { $sum: '$totalDueToday' }, count: { $sum: 1 } } }
          ]).toArray();
          bookings = ownerBookings[0]?.count || 0;
          totalRevenue = ownerBookings[0]?.totalRevenue || 0;
        }

        if (user.role === 'renter') {
          const renterAgg = await bookingsCollection.aggregate([
            { $match: { renterId: user._id } },
            { $group: { _id: null, count: { $sum: 1 } } }
          ]).toArray();
          const revenueAgg = await bookingsCollection.aggregate([
            { $match: { renterId: user._id, paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalDueToday' } } }
          ]).toArray();
          bookings = renterAgg[0]?.count || 0;
          totalRevenue = revenueAgg[0]?.total || 0;
        }

        return {
          ...user,
          properties,
          bookings,
          totalRevenue,
          status: user.isSuspended ? 'Suspended' : (user.isActive ? 'Active' : 'Inactive'),
          // Include NIC details for admin view (owners only)
          nicDetails: user.role === 'owner' ? user.nicDetails || null : undefined,
          emailVerificationStatus: user.emailVerification?.verified ? 'verified' : 'pending'
        };
      }));

      const total = await usersCollection.countDocuments(query);
      const userQuery = { role: { $ne: 'admin' } };
      const totalUsers = await usersCollection.countDocuments(userQuery);
      const activeUsers = await usersCollection.countDocuments({ ...userQuery, isActive: true, isSuspended: { $ne: true } });
      const totalOwners = await usersCollection.countDocuments({ role: 'owner' });
      const totalRenters = await usersCollection.countDocuments({ role: 'renter' });
      const suspendedUsers = await usersCollection.countDocuments({ ...userQuery, isSuspended: true });
      const verifiedUsers = await usersCollection.countDocuments({ ...userQuery, isVerified: true });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Users retrieved successfully',
          users: enrichedUsers,
          summary: { total: totalUsers, active: activeUsers, owners: totalOwners, renters: totalRenters, suspended: suspendedUsers, verified: verifiedUsers },
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        })
      };
    }

    // ── PUT /admin/users/:id ──────────────────────────────────────────────
    if (event.httpMethod === 'PUT') {
      const userId = event.pathParameters?.id;
      if (!userId || !ObjectId.isValid(userId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid user ID is required' }) };
      }

      const body = JSON.parse(event.body);
      const { action, reason, role } = body;
      const validActions = ['suspend', 'activate', 'change_role', 'verify', 'verify_identity'];
      if (!validActions.includes(action)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }) };
      }

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
      if (user.role === 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Cannot modify admin accounts' }) };

      const updateFields = { updatedAt: new Date(), updatedBy: new ObjectId(decoded.userId) };
      const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
      let message = '';

      switch (action) {
        case 'suspend':
          updateFields.isSuspended = true;
          updateFields.isActive = false;
          updateFields.suspendedAt = new Date();
          updateFields.suspensionReason = reason || 'No reason provided';
          updateFields.suspendedBy = new ObjectId(decoded.userId);
          message = `User ${user.email} has been suspended`;
          await logSystemActivity(db, 'WARNING', 'Admin', `User suspended: ${user.email}`, decoded.email, ipAddress, { userId, reason });
          break;

        case 'activate':
          updateFields.isSuspended = false;
          updateFields.isActive = true;
          updateFields.activatedAt = new Date();
          message = `User ${user.email} has been activated`;
          await logSystemActivity(db, 'INFO', 'Admin', `User activated: ${user.email}`, decoded.email, ipAddress, { userId });
          break;

        case 'change_role':
          if (!role || !['renter', 'owner'].includes(role)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid role (renter or owner) is required' }) };
          }
          updateFields.role = role;
          updateFields.roleChangedAt = new Date();
          updateFields.previousRole = user.role;
          message = `User ${user.email} role changed to ${role}`;
          await logSystemActivity(db, 'INFO', 'Admin', `User role changed: ${user.email}`, decoded.email, ipAddress, { userId, previousRole: user.role, newRole: role });
          break;

        case 'verify':
          updateFields.isVerified = true;
          updateFields.verifiedAt = new Date();
          updateFields.verifiedBy = new ObjectId(decoded.userId);
          message = `User ${user.email} email has been verified`;
          await logSystemActivity(db, 'INFO', 'Admin', `User email verified: ${user.email}`, decoded.email, ipAddress, { userId });
          break;

        case 'verify_identity':
          // Admin verified NIC/identity of an owner
          updateFields.isAdminVerified = true;
          updateFields.adminVerifiedAt = new Date();
          updateFields.adminVerifiedBy = new ObjectId(decoded.userId);
          updateFields['nicDetails.verifiedAt'] = new Date();
          updateFields['nicDetails.verifiedBy'] = decoded.email;
          message = `Owner ${user.email} identity has been verified`;
          await logSystemActivity(db, 'INFO', 'Admin', `Owner identity verified: ${user.email}`, decoded.email, ipAddress, { userId });
          break;
      }

      const auditEntry = {
        action, performedBy: decoded.userId, performedByEmail: decoded.email,
        reason: reason || 'No reason provided', timestamp: new Date(),
        previousValues: { isActive: user.isActive, isSuspended: user.isSuspended, role: user.role, isVerified: user.isVerified }
      };

      const result = await usersCollection.findOneAndUpdate(
        { _id: new ObjectId(userId) },
        { $set: updateFields, $push: { auditTrail: auditEntry } },
        { returnDocument: 'after', projection: { password: 0, 'emailVerification.otp': 0 } }
      );

      return { statusCode: 200, headers, body: JSON.stringify({ message, user: result, action }) };
    }

    // ── DELETE /admin/users/:id ───────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const userId = event.pathParameters?.id;
      if (!userId || !ObjectId.isValid(userId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid user ID is required' }) };
      }

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
      if (user.role === 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Cannot delete admin accounts' }) };

      if (user.role === 'owner') {
        const activeListings = await housesCollection.countDocuments({ ownerId: user._id, status: 'approved', isActive: true });
        if (activeListings > 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot delete owner with active listings', activeListings }) };
        }
      }

      const activeBookings = await bookingsCollection.countDocuments({
        $or: [{ renterId: user._id }, { ownerId: user._id }],
        status: { $in: ['pending', 'approved', 'confirmed', 'active'] }
      });
      if (activeBookings > 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot delete user with active bookings', activeBookings }) };
      }

      const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
      await logSystemActivity(db, 'WARNING', 'Admin', `User deleted: ${user.email}`, decoded.email, ipAddress, { userId });

      await usersCollection.findOneAndUpdate(
        { _id: new ObjectId(userId) },
        {
          $set: {
            isActive: false, isDeleted: true, deletedAt: new Date(),
            deletedBy: new ObjectId(decoded.userId), deletedByEmail: decoded.email,
            email: `deleted_${Date.now()}_${user.email}`, updatedAt: new Date()
          },
          $push: {
            auditTrail: { action: 'delete', performedBy: decoded.userId, performedByEmail: decoded.email, timestamp: new Date() }
          }
        }
      );

      return { statusCode: 200, headers, body: JSON.stringify({ message: `User ${user.firstName} ${user.lastName} has been deleted`, userId, deletedAt: new Date() }) };
    }

  } catch (error) {
    console.error('Admin users error:', error);
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: error.message }) };
  }
};