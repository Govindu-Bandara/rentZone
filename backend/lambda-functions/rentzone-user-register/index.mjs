import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

const ACCESS_TOKEN_DURATION = '60m';
const REFRESH_TOKEN_DURATION = '7d';

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
      source: 'user_registration',
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
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const body = JSON.parse(event.body);
    const { email, password, role, firstName, lastName, phone } = body;
    
    if (!email || !password || !role || !firstName || !lastName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields: email, password, role, firstName, lastName' 
        })
      };
    }
    
    if (!['renter', 'owner', 'admin'].includes(role)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid role. Must be renter, owner, or admin' })
      };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }
    
    if (password.length < 8) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Password must be at least 8 characters long' })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const refreshTokensCollection = db.collection('refreshTokens');
    
    const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'User with this email already exists' })
      };
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = {
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      firstName,
      lastName,
      phone: phone || null,
      profileImage: null,
      isVerified: false,
      isActive: true,
      isSuspended: false,
      loginAttempts: 0,
      permissions: role === 'admin' ? [
        'manage_users',
        'manage_properties',
        'manage_bookings',
        'view_analytics'
      ] : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await usersCollection.insertOne(newUser);
    
    const accessToken = jwt.sign(
      { 
        userId: result.insertedId.toString(), 
        email: email.toLowerCase(), 
        role,
        tokenType: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_DURATION }
    );
    
    const refreshToken = jwt.sign(
      { 
        userId: result.insertedId.toString(), 
        tokenType: 'refresh'
      },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_REFRESH',
      { expiresIn: REFRESH_TOKEN_DURATION }
    );
    
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    
    await refreshTokensCollection.insertOne({
      userId: result.insertedId,
      tokenHash: refreshTokenHash,
      userAgent: event.headers['User-Agent'] || 'unknown',
      ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
      deviceInfo: event.headers['Device-Info'] || 'unknown',
      userType: role,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isRevoked: false
    });
    
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    await logSystemActivity(db, 'INFO', 'User', 
      `New user registered: ${email}`, 
      email, 
      ipAddress,
      {
        userId: result.insertedId.toString(),
        role: role,
        firstName: firstName,
        lastName: lastName
      }
    );
    
    const userResponse = {
      _id: result.insertedId,
      email: newUser.email,
      role: newUser.role,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      phone: newUser.phone,
      isVerified: newUser.isVerified,
      permissions: newUser.permissions,
      createdAt: newUser.createdAt
    };
    
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: 'User registered successfully',
        user: userResponse,
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_DURATION,
        refreshExpiresIn: REFRESH_TOKEN_DURATION
      })
    };
    
  } catch (error) {
    console.error('Registration error:', error);
    
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    const email = JSON.parse(event.body)?.email || 'unknown';
    
    await logSystemActivity(db, 'ERROR', 'User',
      `User registration failed for ${email}: ${error.message}`,
      email || null,
      ipAddress,
      {
        error: error.message,
        email: email
      }
    );
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};