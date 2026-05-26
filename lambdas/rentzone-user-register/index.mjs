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

async function getParam(name) {
  if (cachedParams[name]) return cachedParams[name];
  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const response = await ssmClient.send(command);
  cachedParams[name] = response.Parameter.Value;
  return cachedParams[name];
}

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const connectionString = await getParam(process.env.MONGODB_URI_PARAM);
  const client = await MongoClient.connect(connectionString);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

async function createTransporter() {
  const user = await getParam(process.env.EMAIL_USER_PARAM);
  const pass = await getParam(process.env.EMAIL_PASS_PARAM);
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function getVerificationEmailHTML(firstName, otp, frontendUrl) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - Rent Zone</title>
</head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2563EB 0%,#14B8A6 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">Rent Zone</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Your Trusted Rental Platform</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="color:#1E293B;font-size:22px;font-weight:700;margin:0 0 12px;">Verify Your Email Address</h2>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">
              Hi <strong>${firstName}</strong>, welcome to Rent Zone! Use the verification code below to confirm your email address. This code expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.
            </p>
            <!-- OTP Box -->
            <div style="background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:12px;padding:28px;text-align:center;margin:0 0 28px;">
              <p style="color:#64748B;font-size:13px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Your Verification Code</p>
              <div style="font-size:44px;font-weight:800;color:#2563EB;letter-spacing:12px;font-family:monospace;">${otp}</div>
              <p style="color:#94A3B8;font-size:12px;margin:12px 0 0;">Valid for ${OTP_EXPIRY_MINUTES} minutes only</p>
            </div>
            <!-- CTA -->
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
              Enter this code on the verification page to activate your account. If you didn't create an account, please ignore this email.
            </p>
            <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 18px;margin:0 0 8px;">
              <p style="color:#92400E;font-size:13px;margin:0;font-weight:500;">⚠️ Never share this code with anyone. Rent Zone staff will never ask for it.</p>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F8FAFC;padding:24px 40px;border-top:1px solid #E2E8F0;text-align:center;">
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

async function logSystemActivity(db, level, category, message, userEmail, ipAddress, details) {
  try {
    await db.collection('system_logs').insertOne({
      level, category, message,
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body);
    const {
      email, password, role, firstName, lastName, phone,
      bankAccountNumber, accountHolderName, bankName, branchName,
      nicFrontUrl, nicBackUrl
    } = body;

    // ── Validate required fields ──────────────────────────────────────────────
    const requiredFields = ['email', 'password', 'role', 'firstName', 'lastName'];
    const missingFields = requiredFields.filter(f => !body[f]);
    if (missingFields.length > 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields', missingFields }) };
    }

    if (!['renter', 'owner', 'admin'].includes(role)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid role' }) };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email format' }) };
    }

    if (password.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be at least 8 characters long' }) };
    }

    // ── Owner-specific validation ─────────────────────────────────────────────
    if (role === 'owner') {
      const requiredBankFields = ['bankAccountNumber', 'accountHolderName', 'bankName', 'branchName'];
      const missingBankFields = requiredBankFields.filter(f => !body[f]);
      if (missingBankFields.length > 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bank details are required for owners', missingBankFields }) };
      }
      if (!/^\d+$/.test(bankAccountNumber)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bank account number must contain only numbers' }) };
      }
      if (accountHolderName.trim().length < 3) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Account holder name must be at least 3 characters long' }) };
      }
      // NIC images required for owners
      if (!nicFrontUrl || !nicBackUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'NIC front and back images are required for owners' }) };
      }
    }

    const db = await connectToDatabase();
    const usersCollection = db.collection('users');

    const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'User with this email already exists' }) };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // ── Generate OTP ──────────────────────────────────────────────────────────
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const bankDetails = role === 'owner' ? {
      bankAccountNumber, accountHolderName, bankName, branchName,
      isVerified: false, verifiedAt: null, verifiedBy: null
    } : null;

    const nicDetails = role === 'owner' ? {
      frontImageUrl: nicFrontUrl,
      backImageUrl: nicBackUrl,
      uploadedAt: new Date(),
      verifiedAt: null,
      verifiedBy: null
    } : null;

    const newUser = {
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      firstName,
      lastName,
      phone: phone || null,
      profileImage: null,
      isVerified: false,           // email not verified yet
      isAdminVerified: false,      // admin hasn't verified identity yet
      isActive: true,
      isSuspended: false,
      loginAttempts: 0,
      emailVerification: {
        otp: await bcrypt.hash(otp, 10),   // store hashed OTP
        expiresAt: otpExpiry,
        attempts: 0,
        verified: false
      },
      bankDetails,
      nicDetails,
      permissions: role === 'admin' ? [
        'manage_users', 'manage_properties', 'manage_bookings', 'view_analytics'
      ] : role === 'owner' ? [
        'manage_own_properties', 'manage_own_bookings', 'view_own_analytics'
      ] : [
        'book_properties', 'manage_own_bookings', 'write_reviews'
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await usersCollection.insertOne(newUser);

    // ── Send verification email ───────────────────────────────────────────────
    const frontendUrl = await getParam(process.env.FRONTEND_URL_PARAM);
    try {
      const transporter = await createTransporter();
      const emailUser = await getParam(process.env.EMAIL_USER_PARAM);
      await transporter.sendMail({
        from: `"Rent Zone" <${emailUser}>`,
        to: email,
        subject: 'Verify Your Email — Rent Zone',
        html: getVerificationEmailHTML(firstName, otp, frontendUrl)
      });
    } catch (emailError) {
      console.error('Email send failed:', emailError);
      // Don't block registration — user can resend OTP
    }

    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    await logSystemActivity(db, 'INFO', 'User Registration',
      `New ${role} registered (pending email verification): ${email}`,
      email, ipAddress,
      { userId: result.insertedId.toString(), role, firstName, lastName }
    );

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: 'Registration successful. Please check your email for the verification code.',
        userId: result.insertedId.toString(),
        email: email.toLowerCase(),
        requiresVerification: true,
        expiresIn: `${OTP_EXPIRY_MINUTES} minutes`
      })
    };

  } catch (error) {
    console.error('Registration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};