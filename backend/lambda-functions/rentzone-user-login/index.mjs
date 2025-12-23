import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

// Token durations
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
  const client = await MongoClient.connect(connectionString, {
    serverSelectionTimeoutMS: 10000
  });
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

// Helper function to create system logs
async function createSystemLog(db, logData) {
  try {
    const systemLogsCollection = db.collection('system_logs');
    
    const logEntry = {
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
    };
    
    await systemLogsCollection.insertOne(logEntry);
    return true;
  } catch (error) {
    console.error('Failed to create system log:', error);
    return false;
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
    const { email, password } = body;
    
    if (!email || !password) {
      // Log failed login attempt
      const db = await connectToDatabase();
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: 'Login attempt with missing credentials',
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        details: { missingField: !email ? 'email' : 'password' }
      });
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const refreshTokensCollection = db.collection('refreshTokens');
    
    // Find user by email
    const user = await usersCollection.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Log failed login attempt
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Failed login attempt for non-existent email: ${email}`,
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        details: { email: email }
      });
      
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }
    
    // Check if account is suspended
    if (user.isSuspended) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Login attempt for suspended account: ${email}`,
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        userEmail: user.email,
        userId: user._id,
        userRole: user.role,
        details: { reason: 'Account suspended' }
      });
      
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Account suspended', 
          message: 'Your account has been suspended. Please contact support.' 
        })
      };
    }
    
    // Check if account is active
    if (!user.isActive) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Login attempt for inactive account: ${email}`,
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        userEmail: user.email,
        userId: user._id,
        userRole: user.role
      });
      
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Account inactive', 
          message: 'Your account is not active. Please contact administrator.' 
        })
      };
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      // Track failed login attempts
      await usersCollection.updateOne(
        { _id: user._id },
        { 
          $inc: { loginAttempts: 1 },
          $set: { lastFailedLogin: new Date() }
        }
      );
      
      // Log failed login attempt
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Failed login attempt (wrong password) for: ${email}`,
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        userEmail: user.email,
        userId: user._id,
        userRole: user.role,
        details: { loginAttempts: user.loginAttempts + 1 }
      });
      
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }
    
    // Successful login - reset login attempts and update last login
    await usersCollection.updateOne(
      { _id: user._id },
      { 
        $set: { 
          loginAttempts: 0,
          lastLogin: new Date(),
          lastLoginIP: event.requestContext?.identity?.sourceIp || 'unknown'
        }
      }
    );
    
    // Log successful login
    await createSystemLog(db, {
      level: 'INFO',
      category: 'Authentication',
      message: `Successful login: ${email}`,
      ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
      userEmail: user.email,
      userId: user._id,
      userRole: user.role,
      details: {
        userAgent: event.headers['User-Agent'] || 'unknown',
        loginTime: new Date().toISOString()
      }
    });
    
    // Generate ACCESS token
    const accessToken = jwt.sign(
      { 
        userId: user._id.toString(), 
        email: user.email, 
        role: user.role,
        tokenType: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_DURATION }
    );
    
    // Generate REFRESH token
    const refreshToken = jwt.sign(
      { 
        userId: user._id.toString(), 
        tokenType: 'refresh'
      },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_REFRESH',
      { expiresIn: REFRESH_TOKEN_DURATION }
    );
    
    // Hash refresh token before storing
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    
    // Store refresh token in database
    await refreshTokensCollection.insertOne({
      userId: user._id,
      tokenHash: refreshTokenHash,
      userAgent: event.headers['User-Agent'] || 'unknown',
      ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
      deviceInfo: event.headers['Device-Info'] || 'unknown',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      isRevoked: false
    });
    
    // Clean up old refresh tokens
    await refreshTokensCollection.deleteMany({
      userId: user._id,
      expiresAt: { $lt: new Date() }
    });
    
    // Prepare user response
    const userResponse = {
      _id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      profileImage: user.profileImage,
      isVerified: user.isVerified,
      permissions: user.permissions || []
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Login successful',
        user: userResponse,
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_DURATION,
        refreshExpiresIn: REFRESH_TOKEN_DURATION
      })
    };
    
  } catch (error) {
    console.error('Login error:', error);
    
    // Log login error
    try {
      const db = await connectToDatabase();
      await db.collection('system_logs').insertOne({
        level: 'ERROR',
        category: 'Authentication',
        message: 'Login handler error: ' + error.message,
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        timestamp: new Date(),
        source: 'login_handler',
        details: {
          error: error.message,
          stack: error.stack
        }
      });
    } catch (logError) {
      console.error('Failed to log login error:', logError);
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