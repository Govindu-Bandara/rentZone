import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

// Get MongoDB connection string from Parameter Store
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

// Connect to MongoDB
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  
  const connectionString = await getConnectionString();
  const client = await MongoClient.connect(connectionString, {
    serverSelectionTimeoutMS: 10000
  });
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

// Verify JWT token
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }
  
  const token = authHeader.substring(7);
  return jwt.verify(token, process.env.JWT_SECRET);
}

export const handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'
  };
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    console.log('Processing', event.httpMethod, 'request');
    
    // Check if Authorization header exists
    const authHeader = event.headers.Authorization || event.headers.authorization;
    console.log('Authorization header present:', !!authHeader);
    
    if (!authHeader) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Unauthorized',
          message: 'No authentication token provided. Please add Authorization header.'
        })
      };
    }
    
    // Verify token
    console.log('Verifying token...');
    const decoded = verifyToken(authHeader);
    console.log('Token decoded:', decoded);
    
    const userId = new ObjectId(decoded.userId);
    console.log('User ID:', userId.toString());
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    
    // GET - Get user profile
    if (event.httpMethod === 'GET') {
      console.log('Fetching user profile...');
      
      // Fetch user without projection first to check status
      const user = await usersCollection.findOne({ _id: userId });
      
      if (!user) {
        console.log('User not found for ID:', userId.toString());
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            error: 'User not found',
            message: 'The requested user profile does not exist'
          })
        };
      }
      
      console.log('User found, checking status...');
      console.log('isActive:', user.isActive);
      console.log('isSuspended:', user.isSuspended);
      
      // Check account status
      if (user.isSuspended) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ 
            error: 'Account suspended',
            message: 'Your account has been suspended. Please contact support.'
          })
        };
      }
      
      if (!user.isActive) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ 
            error: 'Account inactive',
            message: 'Your account is not active. Please contact administrator.'
          })
        };
      }
      
      // Create response object excluding sensitive data
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLogin: user.lastLogin,
        lastLoginIP: user.lastLoginIP
      };
      
      console.log('Returning user profile');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Profile retrieved successfully',
          user: userResponse
        })
      };
    }
    
    // PUT - Update user profile
    if (event.httpMethod === 'PUT') {
      console.log('Updating user profile...');
      
      if (!event.body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Bad request',
            message: 'Request body is required'
          })
        };
      }
      
      const body = JSON.parse(event.body);
      console.log('Update body:', body);
      
      const updateFields = {};
      const now = new Date();
      
      // Only allow certain fields to be updated
      const allowedFields = ['firstName', 'lastName', 'phone', 'profileImage'];
      allowedFields.forEach(field => {
        if (body[field] !== undefined) {
          updateFields[field] = body[field];
        }
      });
      
      // Handle password change with validation
      if (body.currentPassword && body.newPassword) {
        console.log('Password change requested');
        
        // Fetch user with password for verification
        const user = await usersCollection.findOne({ _id: userId });
        
        if (!user) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ 
              error: 'User not found',
              message: 'The requested user profile does not exist'
            })
          };
        }
        
        // Verify current password
        const isValidPassword = await bcrypt.compare(body.currentPassword, user.password);
        if (!isValidPassword) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ 
              error: 'Invalid password',
              message: 'Current password is incorrect'
            })
          };
        }
        
        // Validate new password strength
        if (body.newPassword.length < 8) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Password too short',
              message: 'New password must be at least 8 characters long'
            })
          };
        }
        
        // Check if new password is different from current
        const isSamePassword = await bcrypt.compare(body.newPassword, user.password);
        if (isSamePassword) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Password unchanged',
              message: 'New password must be different from current password'
            })
          };
        }
        
        // Hash new password
        updateFields.password = await bcrypt.hash(body.newPassword, 10);
        console.log('Password updated successfully');
      } else if (body.newPassword && !body.currentPassword) {
        // If new password is provided without current password
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Missing current password',
            message: 'Current password is required to set a new password'
          })
        };
      }
      
      // Check if there are fields to update
      if (Object.keys(updateFields).length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'No updates provided',
            message: 'Please provide fields to update'
          })
        };
      }
      
      updateFields.updatedAt = now;
      console.log('Fields to update:', updateFields);
      
      // Update user profile
      const result = await usersCollection.findOneAndUpdate(
        { _id: userId },
        { $set: updateFields },
        { 
          returnDocument: 'after'
        }
      );
      
      if (!result) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            error: 'User not found',
            message: 'The requested user profile does not exist'
          })
        };
      }
      
      // Create response object without sensitive data
      const userResponse = {
        _id: result._id,
        email: result.email,
        role: result.role,
        firstName: result.firstName,
        lastName: result.lastName,
        phone: result.phone,
        profileImage: result.profileImage,
        isVerified: result.isVerified,
        permissions: result.permissions || [],
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        lastLogin: result.lastLogin,
        lastLoginIP: result.lastLoginIP
      };
      
      console.log('Profile updated successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Profile updated successfully',
          user: userResponse
        })
      };
    }
    
    // Method not allowed
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        error: 'Method not allowed',
        message: 'Only GET and PUT methods are supported'
      })
    };
    
  } catch (error) {
    console.error('Profile error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Handle specific JWT errors
    if (error.name === 'JsonWebTokenError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid token',
          message: 'The provided authentication token is invalid'
        })
      };
    }
    
    if (error.name === 'TokenExpiredError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Token expired',
          message: 'Your session has expired. Please log in again.'
        })
      };
    }
    
    if (error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Unauthorized',
          message: 'No authentication token provided'
        })
      };
    }
    
    // Handle MongoDB ObjectId error
    if (error.message.includes('ObjectId')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid user ID',
          message: 'The provided user ID is not valid'
        })
      };
    }
    
    // Handle JSON parsing error
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid request body',
          message: 'The request body contains invalid JSON'
        })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        message: 'An unexpected error occurred. Please try again later.',
        details: error.message
      })
    };
  }
};