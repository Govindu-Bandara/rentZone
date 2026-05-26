import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
const s3Client  = new S3Client({ region: process.env.S3_REGION || 'ap-southeast-2' });

let cachedDb = null;
let cachedConnectionString = null;

async function getConnectionString() {
  if (cachedConnectionString) return cachedConnectionString;
  const command = new GetParameterCommand({
    Name: process.env.MONGODB_URI_PARAM,
    WithDecryption: true,
  });
  const response = await ssmClient.send(command);
  cachedConnectionString = response.Parameter.Value;
  return cachedConnectionString;
}

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const connectionString = await getConnectionString();
  const client = await MongoClient.connect(connectionString, {
    serverSelectionTimeoutMS: 10000,
  });
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

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
};

function respond(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const path   = event.path || event.rawPath || '';
  const method = event.httpMethod;

  // ── POST /get-upload-url — generate S3 presigned URL ──
  if (method === 'POST' && path.includes('get-upload-url')) {
    try {
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      verifyToken(authHeader);

      const { fileName, fileType } = JSON.parse(event.body || '{}');
      if (!fileName || !fileType) {
        return respond(400, { error: 'fileName and fileType are required' });
      }

      const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!ALLOWED.includes(fileType)) {
        return respond(400, { error: 'Only image files are allowed (jpeg, png, webp, gif)' });
      }

      const ext    = fileName.split('.').pop();
      const s3Key  = `profile-images/${randomUUID()}.${ext}`;
      const bucket = process.env.S3_BUCKET_NAME;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        ContentType: fileType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
      const fileUrl   = `https://${bucket}.s3.${process.env.S3_REGION || 'ap-southeast-2'}.amazonaws.com/${s3Key}`;

      return respond(200, { uploadUrl, fileUrl, key: s3Key });
    } catch (err) {
      console.error('Upload URL error:', err);
      if (err.message === 'No token provided' || err.name === 'JsonWebTokenError') {
        return respond(401, { error: 'Unauthorized' });
      }
      return respond(500, { error: 'Failed to generate upload URL', details: err.message });
    }
  }

  // ── GET /user/profile ──
  if (method === 'GET' && path.includes('user/profile')) {
    try {
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      const decoded    = verifyToken(authHeader);
      const userId     = new ObjectId(decoded.userId);

      const db   = await connectToDatabase();
      const user = await db.collection('users').findOne({ _id: userId });

      if (!user)            return respond(404, { error: 'User not found' });
      if (user.isSuspended) return respond(403, { error: 'Account suspended. Please contact support.' });
      if (!user.isActive)   return respond(403, { error: 'Account inactive. Please contact administrator.' });

      return respond(200, {
        message: 'Profile retrieved successfully',
        user: safeUser(user),
      });
    } catch (err) {
      return handleAuthError(err);
    }
  }

  // ── PUT /user/profile ──
  if (method === 'PUT' && path.includes('user/profile')) {
    try {
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      const decoded    = verifyToken(authHeader);
      const userId     = new ObjectId(decoded.userId);

      if (!event.body) return respond(400, { error: 'Request body is required' });
      const body = JSON.parse(event.body);

      const updateFields = {};

      const ALLOWED_FIELDS = ['firstName', 'lastName', 'phone', 'profileImage'];
      ALLOWED_FIELDS.forEach(f => {
        if (body[f] !== undefined) updateFields[f] = body[f];
      });

      if (updateFields.firstName) updateFields.firstName = updateFields.firstName.trim();
      if (updateFields.lastName)  updateFields.lastName  = updateFields.lastName.trim();
      if (updateFields.phone)     updateFields.phone     = updateFields.phone.trim();

      if (updateFields.profileImage && !updateFields.profileImage.startsWith('http')) {
        return respond(400, { error: 'profileImage must be a valid URL' });
      }

      if (body.newPassword) {
        if (!body.currentPassword) {
          return respond(400, { error: 'Current password is required to set a new password' });
        }
        if (body.newPassword.length < 8) {
          return respond(400, { error: 'New password must be at least 8 characters long' });
        }

        const db   = await connectToDatabase();
        const user = await db.collection('users').findOne({ _id: userId });
        if (!user) return respond(404, { error: 'User not found' });

        const isValid = await bcrypt.compare(body.currentPassword, user.password);
        if (!isValid) return respond(401, { error: 'Current password is incorrect' });

        const isSame = await bcrypt.compare(body.newPassword, user.password);
        if (isSame) return respond(400, { error: 'New password must be different from current password' });

        updateFields.password = await bcrypt.hash(body.newPassword, 12);
      }

      if (Object.keys(updateFields).length === 0) {
        return respond(400, { error: 'No fields to update' });
      }

      updateFields.updatedAt = new Date();

      const db     = await connectToDatabase();
      const result = await db.collection('users').findOneAndUpdate(
        { _id: userId },
        { $set: updateFields },
        { returnDocument: 'after' }
      );

      // NOTE: findOneAndUpdate returns an object like { value: <doc>, ... } in current drivers.
      // Use result?.value if present to obtain the updated document.
      const updatedUser = result?.value ?? result;
      if (!updatedUser) return respond(404, { error: 'User not found' });

      return respond(200, {
        message: 'Profile updated successfully',
        user: safeUser(updatedUser),
      });
    } catch (err) {
      return handleAuthError(err);
    }
  }

  return respond(405, { error: 'Method not allowed' });
};

function safeUser(user) {
  return {
    _id:          user._id,
    email:        user.email,
    role:         user.role,
    firstName:    user.firstName,
    lastName:     user.lastName,
    phone:        user.phone,
    profileImage: user.profileImage,
    isVerified:   user.isVerified,
    permissions:  user.permissions || [],
    createdAt:    user.createdAt,
    updatedAt:    user.updatedAt,
    lastLogin:    user.lastLogin,
    lastLoginIP:  user.lastLoginIP,
  };
}

function handleAuthError(err) {
  console.error('Handler error:', err);
  if (err.name === 'JsonWebTokenError')    return respond(401, { error: 'Invalid token' });
  if (err.name === 'TokenExpiredError')    return respond(401, { error: 'Session expired. Please log in again.' });
  if (err.message === 'No token provided') return respond(401, { error: 'Unauthorized — no token provided' });
  if (err.message?.includes('ObjectId'))   return respond(400, { error: 'Invalid user ID' });
  if (err instanceof SyntaxError)          return respond(400, { error: 'Invalid JSON in request body' });
  return respond(500, { error: 'Internal server error', details: err.message });
}