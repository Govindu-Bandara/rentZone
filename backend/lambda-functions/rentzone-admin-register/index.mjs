import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

// Token durations
const ACCESS_TOKEN_DURATION = '60m';
const REFRESH_TOKEN_DURATION = '7d';

// Master admin key - Change this to a secure value in production
const ADMIN_REGISTRATION_KEY = 'RENTZONE_MASTER_ADMIN_KEY_2025';

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
    const { 
      email, 
      password, 
      firstName, 
      lastName, 
      phone,
      adminKey, // Security key to prevent unauthorized admin creation
      permissions
    } = body;
    
    // Validate admin registration key
    if (adminKey !== ADMIN_REGISTRATION_KEY) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Unauthorized', 
          message: 'Invalid admin registration key' 
        })
      };
    }
    
    // Validation
    if (!email || !password || !firstName || !lastName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields: email, password, firstName, lastName' 
        })
      };
    }
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }
    
    // Strong password validation for admins
    if (password.length < 8) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Password must be at least 8 characters long' 
        })
      };
    }
    
    // Check password strength
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Password must contain uppercase, lowercase, numbers, and special characters' 
        })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const refreshTokensCollection = db.collection('refreshTokens');
    
    // Check if admin already exists
    const existingAdmin = await usersCollection.findOne({ 
      email: email.toLowerCase() 
    });
    
    if (existingAdmin) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ 
          error: 'Admin with this email already exists' 
        })
      };
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12); // Higher rounds for admins
    
    // Create admin user
    const newAdmin = {
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'admin',
      firstName,
      lastName,
      phone: phone || null,
      profileImage: null,
      isVerified: true, // Admins are verified by default
      isActive: true,
      isSuspended: false,
      loginAttempts: 0,
      permissions: permissions || [
        'manage_users',
        'manage_properties',
        'manage_bookings',
        'view_analytics',
        'manage_admins'
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system' // Track who created this admin
    };
    
    const result = await usersCollection.insertOne(newAdmin);
    
    // Generate ACCESS token
    const accessToken = jwt.sign(
      { 
        userId: result.insertedId.toString(), 
        email: email.toLowerCase(), 
        role: 'admin',
        permissions: newAdmin.permissions,
        tokenType: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_DURATION }
    );
    
    // Generate REFRESH token
    const refreshToken = jwt.sign(
      { 
        userId: result.insertedId.toString(), 
        tokenType: 'refresh'
      },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_REFRESH',
      { expiresIn: REFRESH_TOKEN_DURATION }
    );
    
    // Hash and store refresh token
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    
    await refreshTokensCollection.insertOne({
      userId: result.insertedId,
      tokenHash: refreshTokenHash,
      userAgent: event.headers['User-Agent'] || 'unknown',
      ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
      deviceInfo: event.headers['Device-Info'] || 'unknown',
      userType: 'admin',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isRevoked: false
    });
    
    // Return admin data (without password)
    const adminResponse = {
      _id: result.insertedId,
      email: newAdmin.email,
      role: newAdmin.role,
      firstName: newAdmin.firstName,
      lastName: newAdmin.lastName,
      phone: newAdmin.phone,
      isVerified: newAdmin.isVerified,
      permissions: newAdmin.permissions,
      createdAt: newAdmin.createdAt
    };
    
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: 'Admin registered successfully',
        admin: adminResponse,
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_DURATION,
        refreshExpiresIn: REFRESH_TOKEN_DURATION
      })
    };
    
  } catch (error) {
    console.error('Admin registration error:', error);
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