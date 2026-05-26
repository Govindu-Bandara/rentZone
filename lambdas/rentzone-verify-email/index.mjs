import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
let cachedDb = null;
let cachedParams = {};

const ACCESS_TOKEN_DURATION = '60m';
const REFRESH_TOKEN_DURATION = '7d';
const OTP_EXPIRY_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;

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

async function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.JWT_SECRET_PARAM) return await getParam(process.env.JWT_SECRET_PARAM);
  throw new Error('JWT secret not configured — set JWT_SECRET or JWT_SECRET_PARAM env var');
}

async function createTransporter() {
  const user = await getParam(process.env.EMAIL_USER_PARAM);
  const pass = await getParam(process.env.EMAIL_PASS_PARAM);
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function getResendEmailHTML(firstName, otp) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563EB 0%,#14B8A6 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;">Rent Zone</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Your Trusted Rental Platform</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="color:#1E293B;font-size:20px;margin:0 0 12px;">New Verification Code</h2>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 24px;">
              Hi <strong>${firstName}</strong>, here's your new verification code:
            </p>
            <div style="background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:12px;padding:28px;text-align:center;margin:0 0 24px;">
              <p style="color:#64748B;font-size:13px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Verification Code</p>
              <div style="font-size:44px;font-weight:800;color:#2563EB;letter-spacing:12px;font-family:monospace;">${otp}</div>
              <p style="color:#94A3B8;font-size:12px;margin:12px 0 0;">Valid for ${OTP_EXPIRY_MINUTES} minutes only</p>
            </div>
            <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 18px;">
              <p style="color:#92400E;font-size:13px;margin:0;font-weight:500;">⚠️ Never share this code with anyone. Rent Zone staff will never ask for it.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#F8FAFC;padding:20px 40px;border-top:1px solid #E2E8F0;text-align:center;">
            <p style="color:#94A3B8;font-size:12px;margin:0;">© ${new Date().getFullYear()} Rent Zone. All rights reserved.</p>
            <p style="color:#CBD5E1;font-size:11px;margin:6px 0 0;">This is an automated email. Please do not reply.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Handles both REST API (event.path) and HTTP API (event.rawPath)
function detectRoute(event) {
  const path =
    event.rawPath ||
    event.path ||
    event.requestContext?.resourcePath ||
    '';

  const normalized = path.toLowerCase();

  if (normalized.includes('resend-otp') || normalized.includes('resend_otp')) {
    return 'resend-otp';
  }
  if (normalized.includes('verify-email') || normalized.includes('verify_email')) {
    return 'verify-email';
  }

  const resource = (event.requestContext?.resourcePath || '').toLowerCase();
  if (resource.includes('resend')) return 'resend-otp';
  if (resource.includes('verify')) return 'verify-email';

  return 'unknown';
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

  const route = detectRoute(event);
  console.log('rentzone-verify-email | route:', route, '| path:', event.rawPath || event.path);

  // ── POST /auth/verify-email ───────────────────────────────────────────────
  if (route === 'verify-email') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { userId, otp } = body;

      if (!userId || !otp) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'userId and otp are required' })
        };
      }

      if (!/^\d{6}$/.test(otp)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'OTP must be a 6-digit number' })
        };
      }

      if (!ObjectId.isValid(userId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid user ID' })
        };
      }

      const db = await connectToDatabase();
      const usersCollection = db.collection('users');
      const refreshTokensCollection = db.collection('refreshTokens');

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

      if (!user) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
      }

      if (user.emailVerification?.verified || user.isVerified) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email is already verified' })
        };
      }

      if ((user.emailVerification?.attempts || 0) >= MAX_OTP_ATTEMPTS) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: 'Too many failed attempts. Please request a new verification code.',
            requiresResend: true
          })
        };
      }

      if (
        !user.emailVerification?.expiresAt ||
        new Date() > new Date(user.emailVerification.expiresAt)
      ) {
        return {
          statusCode: 410,
          headers,
          body: JSON.stringify({
            error: 'Verification code has expired. Please request a new one.',
            requiresResend: true
          })
        };
      }

      const isValidOTP = await bcrypt.compare(otp, user.emailVerification.otp);

      if (!isValidOTP) {
        await usersCollection.updateOne(
          { _id: user._id },
          { $inc: { 'emailVerification.attempts': 1 } }
        );
        const attemptsUsed = (user.emailVerification?.attempts || 0) + 1;
        const remaining = Math.max(0, MAX_OTP_ATTEMPTS - attemptsUsed);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: 'Invalid verification code',
            attemptsRemaining: remaining
          })
        };
      }

      // OTP valid — mark verified and issue tokens
      const jwtSecret = await getJwtSecret();

      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            isVerified: true,
            'emailVerification.verified': true,
            'emailVerification.verifiedAt': new Date(),
            updatedAt: new Date()
          }
        }
      );

      const tokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        tokenType: 'access'
      };
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
        userAgent: event.headers?.['User-Agent'] || 'unknown',
        ipAddress: event.requestContext?.identity?.sourceIp || 'unknown',
        deviceInfo: event.headers?.['Device-Info'] || 'unknown',
        userType: user.role,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: false
      });

      const userResponse = {
        _id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        profileImage: user.profileImage,
        isVerified: true,
        isAdminVerified: user.isAdminVerified || false,
        permissions: user.permissions || [],
        bankDetails:
          user.role === 'owner' && user.bankDetails
            ? {
                bankAccountNumber: user.bankDetails.bankAccountNumber,
                accountHolderName: user.bankDetails.accountHolderName,
                bankName: user.bankDetails.bankName,
                branchName: user.bankDetails.branchName,
                isVerified: user.bankDetails.isVerified
              }
            : undefined
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Email verified successfully! Welcome to Rent Zone.',
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
      console.error('verify-email error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal server error', details: error.message })
      };
    }
  }

  // ── POST /auth/resend-otp ─────────────────────────────────────────────────
  if (route === 'resend-otp') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { userId } = body;

      if (!userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'userId is required' })
        };
      }

      if (!ObjectId.isValid(userId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid user ID format' })
        };
      }

      const db = await connectToDatabase();
      const usersCollection = db.collection('users');

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

      if (!user) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
      }

      if (user.emailVerification?.verified || user.isVerified) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email is already verified' })
        };
      }

      // Generate and hash new OTP
      const newOTP = generateOTP();
      const newExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      const hashedOTP = await bcrypt.hash(newOTP, 10);

      // Update DB first, reset attempts so user can try again
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            'emailVerification.otp': hashedOTP,
            'emailVerification.expiresAt': newExpiry,
            'emailVerification.attempts': 0,
            updatedAt: new Date()
          }
        }
      );

      // Send email
      try {
        const transporter = await createTransporter();
        const emailUser = await getParam(process.env.EMAIL_USER_PARAM);
        await transporter.sendMail({
          from: `"Rent Zone" <${emailUser}>`,
          to: user.email,
          subject: 'New Verification Code — Rent Zone',
          html: getResendEmailHTML(user.firstName, newOTP)
        });
      } catch (emailError) {
        console.error('Resend email delivery failed:', emailError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'Failed to send verification email. Please try again in a moment.'
          })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'New verification code sent to your email.',
          expiresIn: `${OTP_EXPIRY_MINUTES} minutes`
        })
      };

    } catch (error) {
      console.error('resend-otp error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal server error', details: error.message })
      };
    }
  }

  // ── Unknown route ─────────────────────────────────────────────────────────
  console.warn('rentzone-verify-email | unmatched route:', event.rawPath || event.path);
  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({
      error: 'Route not found',
      receivedPath: event.rawPath || event.path || 'unknown'
    })
  };
};