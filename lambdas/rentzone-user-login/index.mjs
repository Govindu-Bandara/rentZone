import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
let cachedDb = null;
let cachedParams = {};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const ACCESS_TOKEN_DURATION = '60m';
const REFRESH_TOKEN_DURATION = '7d';
const OTP_EXPIRY_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const RESET_TOKEN_EXPIRY_MINUTES = 15;

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

async function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.JWT_SECRET_PARAM) return await getParam(process.env.JWT_SECRET_PARAM);
  throw new Error('JWT secret not configured');
}

async function createTransporter() {
  const user = await getParam(process.env.EMAIL_USER_PARAM);
  const pass = await getParam(process.env.EMAIL_PASS_PARAM);
  return {
    transporter: nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      // Increase timeout for Lambda cold starts
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    }),
    emailUser: user,
  };
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

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ==================== EMAIL TEMPLATES ====================

function getOTPEmailHTML(firstName, otp, frontendUrl) {
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
        <tr>
          <td style="background:linear-gradient(135deg,#2563EB 0%,#14B8A6 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">Rent Zone</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Email Verification</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="color:#1E293B;font-size:22px;font-weight:700;margin:0 0 12px;">Verify Your Email Address</h2>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">
              Hi <strong>${firstName}</strong>, please use the code below to verify your email address.
            </p>
            <div style="text-align:center;margin:0 0 28px;">
              <div style="display:inline-block;background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:12px;padding:20px 40px;">
                <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#1E293B;">${otp}</span>
              </div>
            </div>
            <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 18px;margin:0 0 8px;">
              <p style="color:#92400E;font-size:13px;margin:0;font-weight:500;">
                ⚠️ This code expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.
              </p>
            </div>
          </td>
        </tr>
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

function getResetPasswordEmailHTML(firstName, resetLink) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - Rent Zone</title>
</head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563EB 0%,#14B8A6 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">Rent Zone</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Password Reset Request</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="color:#1E293B;font-size:22px;font-weight:700;margin:0 0 12px;">Reset Your Password</h2>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">
              Hi <strong>${firstName}</strong>, we received a request to reset your password. Click the button below to create a new password.
            </p>
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${resetLink}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">Reset Password</a>
            </div>
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
              Or copy this link: <br>
              <span style="color:#2563EB;word-break:break-all;">${resetLink}</span>
            </p>
            <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 18px;margin:0 0 8px;">
              <p style="color:#92400E;font-size:13px;margin:0;font-weight:500;">
                ⚠️ This link will expire in ${RESET_TOKEN_EXPIRY_MINUTES} minutes. If you didn't request this, please ignore this email.
              </p>
            </div>
            <p style="color:#64748B;font-size:13px;margin:16px 0 0;">
              For security reasons, never share this link with anyone.
            </p>
          </td>
        </tr>
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

function getPasswordResetConfirmationHTML(firstName) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Successful - Rent Zone</title>
</head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563EB 0%,#14B8A6 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;">Password Reset Successful</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="color:#475569;font-size:16px;margin:0 0 20px;">Hi <strong>${firstName}</strong>,</p>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 20px;">
              Your password has been successfully reset. You can now log in with your new password.
            </p>
            <div style="background:#ECFDF5;border-left:4px solid #10B981;border-radius:6px;padding:14px 18px;">
              <p style="color:#065F46;font-size:13px;margin:0;">
                ✓ If you made this change, no further action is required.
              </p>
            </div>
            <p style="color:#64748B;font-size:13px;margin:20px 0 0;">
              If you didn't reset your password, please contact support immediately.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#F8FAFC;padding:20px;text-align:center;border-top:1px solid #E2E8F0;">
            <p style="color:#94A3B8;font-size:12px;margin:0;">© ${new Date().getFullYear()} Rent Zone. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ==================== LOGIN HANDLER ====================
async function handleLogin(event, headers, db) {
  const body = JSON.parse(event.body);
  const { email, password } = body;
  const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';

  if (!email || !password) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password are required' }) };
  }

  const usersCollection = db.collection('users');
  const refreshTokensCollection = db.collection('refreshTokens');

  const user = await usersCollection.findOne({ email: email.toLowerCase() });

  if (!user) {
    await createSystemLog(db, {
      level: 'WARNING',
      category: 'Authentication',
      message: `Failed login for non-existent email: ${email}`,
      ipAddress,
    });
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };
  }

  // Account lockout check
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

  await usersCollection.updateOne(
    { _id: user._id },
    { $set: { loginAttempts: 0, lastLogin: new Date(), lastLoginIP: ipAddress } }
  );

  const jwtSecret = await getJwtSecret();

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
    level: 'INFO',
    category: 'Authentication',
    message: `Successful login (${user.role}): ${email}`,
    ipAddress,
    userEmail: user.email,
    userId: user._id,
    userRole: user.role,
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
}

// ==================== REGISTER HANDLER ====================
async function handleRegister(event, headers, db) {
  const body = JSON.parse(event.body);
  const {
    email, password, role, firstName, lastName, phone,
    bankAccountNumber, accountHolderName, bankName, branchName,
    nicFrontUrl, nicBackUrl
  } = body;

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
    if (!nicFrontUrl || !nicBackUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'NIC front and back images are required for owners' }) };
    }
  }

  const usersCollection = db.collection('users');

  const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'User with this email already exists' }) };
  }

  const hashedPassword = await bcrypt.hash(password, 10);
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
    isVerified: false,
    isAdminVerified: false,
    isActive: true,
    isSuspended: false,
    loginAttempts: 0,
    emailVerification: {
      otp: await bcrypt.hash(otp, 10),
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

  // FIX: actually send the OTP email
  try {
    const frontendUrl = await getParam(process.env.FRONTEND_URL_PARAM);
    const { transporter, emailUser } = await createTransporter();

    console.log(`Sending OTP email to: ${email.toLowerCase()}`);

    await transporter.sendMail({
      from: `"Rent Zone" <${emailUser}>`,
      to: email.toLowerCase(),
      subject: 'Verify Your Email - Rent Zone',
      html: getOTPEmailHTML(firstName, otp, frontendUrl)
    });

    console.log('OTP email sent successfully');
  } catch (emailError) {
    console.error('Registration OTP email failed:', emailError.message);
    console.error('Full error:', JSON.stringify(emailError, null, 2));
    // Don't fail registration — user can resend OTP
  }

  const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';

  // FIX: was calling createSystemLog with positional args — now uses object
  await createSystemLog(db, {
    level: 'INFO',
    category: 'User Registration',
    message: `New ${role} registered (pending email verification): ${email}`,
    userEmail: email,
    ipAddress,
    details: { userId: result.insertedId.toString(), role, firstName, lastName }
  });

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
}

// ==================== FORGOT PASSWORD HANDLER ====================
async function handleForgotPassword(event, headers, db) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email } = body;
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email address is required' })
      };
    }

    const usersCollection = db.collection('users');
    const resetTokensCollection = db.collection('passwordResetTokens');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });

    // Security: always return the same response even if email doesn't exist
    if (!user) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Password Reset',
        message: `Password reset requested for non-existent email: ${email}`,
        ipAddress,
        details: { email }
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'If an account exists with that email, you will receive a password reset link.' })
      };
    }

    if (user.isSuspended || !user.isActive) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Password Reset',
        message: `Password reset attempted on suspended/inactive account: ${email}`,
        ipAddress,
        userEmail: user.email,
        userId: user._id
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'If an account exists with that email, you will receive a password reset link.' })
      };
    }

    // Generate token and store it BEFORE attempting email send
    const resetToken = generateResetToken();
    const tokenExpiry = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    const hashedToken = await bcrypt.hash(resetToken, 10);

    await resetTokensCollection.updateOne(
      { userId: user._id },
      {
        $set: {
          tokenHash: hashedToken,
          expiresAt: tokenExpiry,
          createdAt: new Date(),
          isUsed: false
        }
      },
      { upsert: true }
    );

    // Clean up old expired tokens for this user (runs after upsert so new token is safe)
    await resetTokensCollection.deleteMany({
      userId: user._id,
      expiresAt: { $lt: new Date() },
      isUsed: true  // FIX: only delete used+expired tokens, not the fresh one
    });

    // Send reset email
    const frontendUrl = await getParam(process.env.FRONTEND_URL_PARAM);
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    console.log(`Attempting password reset email to: ${user.email}`);
    console.log(`Reset link: ${resetLink}`);

    try {
      const { transporter, emailUser } = await createTransporter();

      const info = await transporter.sendMail({
        from: `"Rent Zone" <${emailUser}>`,
        to: user.email,
        subject: 'Reset Your Password - Rent Zone',
        html: getResetPasswordEmailHTML(user.firstName, resetLink)
      });

      console.log('Password reset email sent. MessageId:', info.messageId);

    } catch (emailError) {
      console.error('Password reset email FAILED:', emailError.message);
      console.error('Error code:', emailError.code);
      console.error('Full error:', JSON.stringify(emailError, null, 2));

      await createSystemLog(db, {
        level: 'ERROR',
        category: 'Password Reset',
        message: `Failed to send reset email to: ${email}`,
        ipAddress,
        userEmail: user.email,
        userId: user._id,
        details: { error: emailError.message, code: emailError.code }
      });

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to send reset email. Please try again later.' })
      };
    }

    await createSystemLog(db, {
      level: 'INFO',
      category: 'Password Reset',
      message: `Password reset link sent to: ${email}`,
      ipAddress,
      userEmail: user.email,
      userId: user._id,
      userRole: user.role
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'If an account exists with that email, you will receive a password reset link.' })
    };

  } catch (error) {
    console.error('Forgot password error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
}

// ==================== RESET PASSWORD HANDLER ====================
async function handleResetPassword(event, headers, db) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { token, email, newPassword } = body;
    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';

    if (!token || !email || !newPassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Token, email, and new password are required' })
      };
    }

    if (newPassword.length < 8) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Password must be at least 8 characters long' })
      };
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
        })
      };
    }

    const usersCollection = db.collection('users');
    const resetTokensCollection = db.collection('passwordResetTokens');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });

    if (!user) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Password Reset',
        message: `Reset password attempted for non-existent email: ${email}`,
        ipAddress
      });
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired reset link' })
      };
    }

    const resetTokenDoc = await resetTokensCollection.findOne({
      userId: user._id,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!resetTokenDoc) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Password Reset',
        message: `Invalid or expired reset token used for: ${email}`,
        ipAddress,
        userEmail: user.email,
        userId: user._id
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired reset link. Please request a new one.' })
      };
    }

    const isValidToken = await bcrypt.compare(token, resetTokenDoc.tokenHash);
    if (!isValidToken) {
      await createSystemLog(db, {
        level: 'WARNING',
        category: 'Password Reset',
        message: `Invalid token hash for: ${email}`,
        ipAddress,
        userEmail: user.email,
        userId: user._id
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired reset link. Please request a new one.' })
      };
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'New password cannot be the same as your current password' })
      };
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedNewPassword,
          updatedAt: new Date(),
          loginAttempts: 0
        }
      }
    );

    await resetTokensCollection.updateOne(
      { _id: resetTokenDoc._id },
      { $set: { isUsed: true, usedAt: new Date() } }
    );

    // Invalidate all refresh tokens to force re-login on all devices
    const refreshTokensCollection = db.collection('refreshTokens');
    await refreshTokensCollection.updateMany(
      { userId: user._id },
      { $set: { isRevoked: true } }
    );

    // Send confirmation email (non-blocking — don't fail the request if this fails)
    try {
      const { transporter, emailUser } = await createTransporter();
      await transporter.sendMail({
        from: `"Rent Zone" <${emailUser}>`,
        to: user.email,
        subject: 'Password Reset Successful - Rent Zone',
        html: getPasswordResetConfirmationHTML(user.firstName)
      });
    } catch (emailError) {
      console.error('Password reset confirmation email failed:', emailError.message);
    }

    await createSystemLog(db, {
      level: 'INFO',
      category: 'Password Reset',
      message: `Password reset successful for: ${email}`,
      ipAddress,
      userEmail: user.email,
      userId: user._id,
      userRole: user.role
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Password reset successful. You can now log in with your new password.' })
    };

  } catch (error) {
    console.error('Reset password error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
}

// ==================== MAIN HANDLER ====================
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
    const db = await connectToDatabase();
    const path = event.path || event.rawPath || '';
    const normalizedPath = path.toLowerCase();

    if (normalizedPath.includes('/auth/login')) {
      return await handleLogin(event, headers, db);
    }

    if (normalizedPath.includes('/auth/register')) {
      return await handleRegister(event, headers, db);
    }

    if (normalizedPath.includes('/auth/forgot-password')) {
      return await handleForgotPassword(event, headers, db);
    }

    if (normalizedPath.includes('/auth/reset-password')) {
      return await handleResetPassword(event, headers, db);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (error) {
    console.error('Auth handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
