import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
let cachedDb = null;
let cachedParams = {};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const ACCESS_TOKEN_DURATION = '60m';
const REFRESH_TOKEN_DURATION = '7d';

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
  const client = await MongoClient.connect(connectionString, { serverSelectionTimeoutMS: 10000 });
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

async function createSystemLog(db, logData) {
  try {
    await db.collection('system_logs').insertOne({
      timestamp: new Date(),
      level: logData.level || 'INFO',
      category: logData.category || 'Authentication',
      message: logData.message,
      ipAddress: logData.ipAddress || 'INTERNAL',
      userEmail: logData.userEmail || null,
      userId: logData.userId || null,
      userRole: logData.userRole || null,
      details: logData.details || null,
      source: logData.source || 'auth_service'
    });
  } catch (error) {
    console.error('Failed to create system log:', error);
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!event.body) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Request body is required' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (parseError) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON format', details: parseError.message }) };
  }

  try {
    const { email, password } = body;
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';

    if (!email || !password) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password are required' }) };
    }

    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const refreshTokensCollection = db.collection('refreshTokens');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });

    if (!user) {
      await createSystemLog(db, { level: 'WARNING', category: 'Authentication', message: `Failed login for non-existent email: ${email}`, ipAddress, details: { email } });
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };
    }

    // ── Account lockout check ─────────────────────────────────────────────
    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      const lockoutTime = new Date(user.lastFailedLogin);
      lockoutTime.setMinutes(lockoutTime.getMinutes() + LOCKOUT_DURATION_MINUTES);
      if (new Date() < lockoutTime) {
        const minutesLeft = Math.ceil((lockoutTime - new Date()) / 60000);
        return { statusCode: 423, headers, body: JSON.stringify({ error: 'Account locked', message: `Too many failed attempts. Try again in ${minutesLeft} minutes.` }) };
      } else {
        await usersCollection.updateOne({ _id: user._id }, { $set: { loginAttempts: 0 } });
      }
    }

    if (user.isSuspended) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account suspended', message: 'Your account has been suspended. Please contact support.' }) };
    }

    if (!user.isActive) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account inactive', message: 'Your account is not active. Please contact administrator.' }) };
    }

    // ── Password check ────────────────────────────────────────────────────
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      await usersCollection.updateOne({ _id: user._id }, { $inc: { loginAttempts: 1 }, $set: { lastFailedLogin: new Date() } });
      const remaining = MAX_LOGIN_ATTEMPTS - (user.loginAttempts + 1);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'Invalid email or password',
          message: remaining > 0 ? `Invalid password. ${remaining} attempts remaining.` : 'Invalid password. Account will be locked.'
        })
      };
    }

    // ── EMAIL VERIFICATION CHECK ──────────────────────────────────────────
    if (!user.emailVerification?.verified && !user.isVerified) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'Email not verified',
          message: 'Please verify your email address before logging in.',
          requiresVerification: true,
          userId: user._id.toString()
        })
      };
    }

    // ── Successful login ──────────────────────────────────────────────────
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { loginAttempts: 0, lastLogin: new Date(), lastLoginIP: ipAddress } }
    );

    const jwtSecret = process.env.JWT_SECRET;

    const tokenPayload = { userId: user._id.toString(), email: user.email, role: user.role, tokenType: 'access' };
    if (user.role === 'admin') tokenPayload.permissions = user.permissions || [];

    const accessToken = jwt.sign(tokenPayload, jwtSecret, { expiresIn: ACCESS_TOKEN_DURATION });
    const refreshToken = jwt.sign(
      { userId: user._id.toString(), tokenType: 'refresh' },
      jwtSecret + '_REFRESH',
      { expiresIn: REFRESH_TOKEN_DURATION }
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await refreshTokensCollection.insertOne({
      userId: user._id,
      tokenHash: refreshTokenHash,
      userAgent: event.headers['User-Agent'] || 'unknown',
      ipAddress,
      deviceInfo: event.headers['Device-Info'] || 'unknown',
      userType: user.role,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isRevoked: false
    });

    await refreshTokensCollection.deleteMany({ userId: user._id, expiresAt: { $lt: new Date() } });

    await createSystemLog(db, {
      level: 'INFO', category: 'Authentication',
      message: `Successful login (${user.role}): ${email}`,
      ipAddress, userEmail: user.email, userId: user._id, userRole: user.role,
      details: { loginTime: new Date().toISOString(), role: user.role }
    });

    const userResponse = {
      _id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      profileImage: user.profileImage,
      isVerified: user.isVerified,
      permissions: user.permissions || [],
      lastLogin: user.lastLogin,
      bankDetails: user.role === 'owner' && user.bankDetails ? {
        bankAccountNumber: user.bankDetails.bankAccountNumber,
        accountHolderName: user.bankDetails.accountHolderName,
        bankName: user.bankDetails.bankName,
        branchName: user.bankDetails.branchName,
        isVerified: user.bankDetails.isVerified
      } : undefined
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: `Login successful (${user.role})`,
        user: userResponse,
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_DURATION,
        refreshExpiresIn: REFRESH_TOKEN_DURATION,
        userRole: user.role,
        redirectTo: user.role === 'admin' ? 'admin-dashboard' : 'user-dashboard'
      })
    };

  } catch (error) {
    console.error('Login error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: error.message }) };
  }
};