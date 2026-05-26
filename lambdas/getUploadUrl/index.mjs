import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { v4 as uuidv4 } from 'uuid';

const REGION = 'ap-southeast-2';
const BUCKET = process.env.S3_BUCKET_NAME;
const ssmClient = new SSMClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

let cachedParams = {};
async function getParam(name) {
  if (cachedParams[name]) return cachedParams[name];
  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const res = await ssmClient.send(command);
  cachedParams[name] = res.Parameter.Value;
  return cachedParams[name];
}

async function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('No token provided');
  const token = authHeader.substring(7);
  // For NIC uploads (pre-registration), we use a lightweight check
  // The JWT_SECRET env var is used directly here for speed
  return jwt.verify(token, process.env.JWT_SECRET || await getParam(process.env.JWT_SECRET_PARAM));
}

// For pre-registration NIC uploads (no auth token yet), use a temp token approach
function verifyTempToken(tempToken) {
  const secret = process.env.JWT_SECRET || process.env.TEMP_UPLOAD_SECRET || 'temp-nic-upload-secret';
  return jwt.verify(tempToken, secret);
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Upload-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { fileName, fileType, uploadType } = body;
    // uploadType: 'profile' | 'property' | 'nic_front' | 'nic_back'

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(fileType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid file type. Only JPG, PNG, WEBP allowed.' }) };
    }

    const ext = fileType.split('/')[1];
    let key;
    let userId;

    // ── NIC uploads don't require a logged-in user yet (pre-registration) ──
    if (uploadType === 'nic_front' || uploadType === 'nic_back') {
      // Use a temporary session ID to organise the file
      const sessionId = body.sessionId || uuidv4();
      key = `nic-documents/${sessionId}/${uploadType}_${uuidv4()}.${ext}`;
    } else {
      // Regular uploads require authentication
      const authHeader = event.headers.Authorization || event.headers.authorization;
      const decoded = await verifyToken(authHeader);
      userId = decoded.userId;

      if (uploadType === 'property') {
        key = `owners/${userId}/${uuidv4()}.${ext}`;
      } else {
        key = `profile-images/${userId}/${uuidv4()}.${ext}`;
      }
    }

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: fileType,
      ACL: 'public-read',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ uploadUrl, publicUrl, key, sessionId: body.sessionId })
    };

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};