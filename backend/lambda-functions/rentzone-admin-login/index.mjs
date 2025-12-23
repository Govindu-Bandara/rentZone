import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

// Max failed login attempts before lockout
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

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
      source: logData.source || 'admin_auth_service'
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
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    
    if (!email || !password) {
      // Log failed login attempt
      const db = await connectToDatabase();
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: 'Admin login attempt with missing credentials',
        ipAddress: ipAddress,
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
    
    // Find admin user
    const admin = await usersCollection.findOne({ 
      email: email.toLowerCase(),
      role: 'admin'
    });
    
    if (!admin) {
      // Log failed admin login attempt
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Failed admin login attempt for non-existent email: ${email}`,
        ipAddress: ipAddress,
        details: { attemptedRole: 'admin' }
      });
      
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid credentials',
          message: 'Admin account not found or invalid credentials'
        })
      };
    }
    
    // Check if account is locked due to too many failed attempts
    if (admin.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      const lockoutTime = new Date(admin.lastFailedLogin);
      lockoutTime.setMinutes(lockoutTime.getMinutes() + LOCKOUT_DURATION_MINUTES);
      
      if (new Date() < lockoutTime) {
        const minutesLeft = Math.ceil((lockoutTime - new Date()) / 60000);
        
        // Log lockout attempt
        await createSystemLog(db, {
          level: 'WARNING',
          category: 'Security',
          message: `Admin account locked - failed login attempts: ${email}`,
          ipAddress: ipAddress,
          userEmail: admin.email,
          userId: admin._id,
          userRole: admin.role,
          details: {
            loginAttempts: admin.loginAttempts,
            minutesRemaining: minutesLeft
          }
        });
        
        return {
          statusCode: 423,
          headers,
          body: JSON.stringify({ 
            error: 'Account locked',
            message: `Too many failed login attempts. Please try again in ${minutesLeft} minutes.`
          })
        };
      } else {
        // Reset login attempts after lockout period
        await usersCollection.updateOne(
          { _id: admin._id },
          { $set: { loginAttempts: 0 } }
        );
      }
    }
    
    // Check if account is suspended
    if (admin.isSuspended) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Security',
        message: `Login attempt for suspended admin account: ${email}`,
        ipAddress: ipAddress,
        userEmail: admin.email,
        userId: admin._id,
        userRole: admin.role,
        details: { reason: 'Account suspended' }
      });
      
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Account suspended', 
          message: 'Your admin account has been suspended. Contact system administrator.' 
        })
      };
    }
    
    // Check if account is active
    if (!admin.isActive) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Login attempt for inactive admin account: ${email}`,
        ipAddress: ipAddress,
        userEmail: admin.email,
        userId: admin._id,
        userRole: admin.role
      });
      
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Account inactive', 
          message: 'Your admin account is not active.' 
        })
      };
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    
    if (!isValidPassword) {
      // Increment failed login attempts
      await usersCollection.updateOne(
        { _id: admin._id },
        { 
          $inc: { loginAttempts: 1 },
          $set: { lastFailedLogin: new Date() }
        }
      );
      
      const remainingAttempts = MAX_LOGIN_ATTEMPTS - (admin.loginAttempts + 1);
      
      // Log failed login attempt
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Authentication',
        message: `Failed admin login attempt (wrong password): ${email}`,
        ipAddress: ipAddress,
        userEmail: admin.email,
        userId: admin._id,
        userRole: admin.role,
        details: { 
          loginAttempts: admin.loginAttempts + 1,
          remainingAttempts: remainingAttempts 
        }
      });
      
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid credentials',
          message: remainingAttempts > 0 
            ? `Invalid password. ${remainingAttempts} attempts remaining.`
            : 'Invalid password. Account will be locked.'
        })
      };
    }
    
    // Successful login - reset login attempts and update last login
    await usersCollection.updateOne(
      { _id: admin._id },
      { 
        $set: { 
          loginAttempts: 0,
          lastLogin: new Date(),
          lastLoginIP: ipAddress
        }
      }
    );
    
    // Log successful admin login
    await createSystemLog(db, {
      level: 'INFO',
      category: 'Authentication',
      message: `Successful admin login: ${email}`,
      ipAddress: ipAddress,
      userEmail: admin.email,
      userId: admin._id,
      userRole: admin.role,
      details: {
        userAgent: event.headers['User-Agent'] || 'unknown',
        loginTime: new Date().toISOString(),
        permissions: admin.permissions || []
      }
    });
    
    // Generate ACCESS token
    const accessToken = jwt.sign(
      { 
        userId: admin._id.toString(), 
        email: admin.email, 
        role: 'admin',
        permissions: admin.permissions || [],
        tokenType: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_DURATION }
    );
    
    // Generate REFRESH token
    const refreshToken = jwt.sign(
      { 
        userId: admin._id.toString(), 
        tokenType: 'refresh'
      },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_REFRESH',
      { expiresIn: REFRESH_TOKEN_DURATION }
    );
    
    // Hash refresh token before storing
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    
    // Store refresh token in database
    await refreshTokensCollection.insertOne({
      userId: admin._id,
      tokenHash: refreshTokenHash,
      userAgent: event.headers['User-Agent'] || 'unknown',
      ipAddress: ipAddress,
      deviceInfo: event.headers['Device-Info'] || 'unknown',
      userType: 'admin',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isRevoked: false
    });
    
    // Prepare admin response
    const adminResponse = {
      _id: admin._id,
      email: admin.email,
      role: admin.role,
      firstName: admin.firstName,
      lastName: admin.lastName,
      phone: admin.phone,
      profileImage: admin.profileImage,
      isVerified: admin.isVerified,
      permissions: admin.permissions || [],
      lastLogin: new Date()
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Admin login successful',
        admin: adminResponse,
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_DURATION,
        refreshExpiresIn: REFRESH_TOKEN_DURATION
      })
    };
    
  } catch (error) {
    console.error('Admin login error:', error);
    
    // Log admin login error
    try {
      const db = await connectToDatabase();
      await db.collection('system_logs').insertOne({
        level: 'ERROR',
        category: 'Authentication',
        message: 'Admin login handler error: ' + error.message,
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        timestamp: new Date(),
        source: 'admin_login_handler',
        details: {
          error: error.message,
          stack: error.stack
        }
      });
    } catch (logError) {
      console.error('Failed to log admin login error:', logError);
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