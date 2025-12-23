import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'ap-south-1' });
let cachedDb = null;
let cachedConnectionString = null;

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

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }
  
  const token = authHeader.substring(7);
  return jwt.verify(token, process.env.JWT_SECRET);
}

// Fraud detection algorithms
const fraudDetectionAlgorithms = {
  // Detect multiple accounts from same IP
  detectMultipleAccounts: async (usersCollection, ipAddress) => {
    return await usersCollection.countDocuments({ 
      registrationIp: ipAddress,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });
  },
  
  // Detect suspicious email patterns
  detectSuspiciousEmail: (email) => {
    const suspiciousPatterns = [
      /^\d+@/, // Starts with numbers
      /@(temp|fake|disposable)\./i, // Temp email services
      /\.(xyz|top|club|gq)$/i, // Suspicious TLDs
      /([a-zA-Z0-9._%+-]+){5,}@/i, // Very long local part
      /(test|demo|example)@/i // Test emails
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(email));
  },
  
  // Detect unusual payment activity
  detectUnusualPayments: async (bookingsCollection, userId) => {
    const recentBookings = await bookingsCollection.find({
      $or: [
        { renterId: new ObjectId(userId) },
        { ownerId: new ObjectId(userId) }
      ],
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    }).toArray();
    
    return {
      count: recentBookings.length,
      totalAmount: recentBookings.reduce((sum, b) => sum + b.totalAmount, 0),
      isUnusual: recentBookings.length > 5 || 
                recentBookings.reduce((sum, b) => sum + b.totalAmount, 0) > 10000
    };
  },
  
  // Detect duplicate property listings
  detectDuplicateListings: async (housesCollection, ownerId) => {
    const ownerListings = await housesCollection.find({ 
      ownerId: new ObjectId(ownerId),
      status: { $in: ['pending', 'approved'] }
    }).toArray();
    
    // Check for similar titles/descriptions
    const duplicates = [];
    for (let i = 0; i < ownerListings.length; i++) {
      for (let j = i + 1; j < ownerListings.length; j++) {
        const similarity = calculateSimilarity(
          ownerListings[i].title + ownerListings[i].description,
          ownerListings[j].title + ownerListings[j].description
        );
        
        if (similarity > 0.8) { // 80% similarity threshold
          duplicates.push({
            listing1: ownerListings[i]._id,
            listing2: ownerListings[j]._id,
            similarity: similarity
          });
        }
      }
    }
    
    return duplicates;
  }
};

// Helper function for string similarity (Levenshtein distance)
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

function levenshteinDistance(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    if (decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can access fraud monitoring' })
      };
    }
    
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const housesCollection = db.collection('houses');
    const bookingsCollection = db.collection('bookings');
    const fraudReportsCollection = db.collection('fraud_reports');
    
    // GET - Get flagged accounts and fraud reports
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      const query = { isFlagged: true };
      
      // Filter by risk level
      if (params.riskLevel) {
        if (params.riskLevel === 'high') {
          query.riskScore = { $gte: 70 };
        } else if (params.riskLevel === 'medium') {
          query.riskScore = { $gte: 40, $lt: 70 };
        } else if (params.riskLevel === 'low') {
          query.riskScore = { $lt: 40 };
        }
      }
      
      // Filter by user type
      if (params.userType && params.userType !== 'All Types') {
        query.role = params.userType.toLowerCase();
      }
      
      // Search by name, email, or reason
      if (params.search) {
        const searchRegex = new RegExp(params.search, 'i');
        query.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { 'fraudDetails.reason': searchRegex }
        ];
      }
      
      // Filter by date
      if (params.startDate && params.endDate) {
        query.flaggedAt = {
          $gte: new Date(params.startDate),
          $lte: new Date(params.endDate)
        };
      }
      
      // Pagination
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 20;
      const skip = (page - 1) * limit;
      
      // Sorting
      let sort = { riskScore: -1, flaggedAt: -1 };
      if (params.sortBy === 'recent') sort = { flaggedAt: -1 };
      if (params.sortBy === 'oldest') sort = { flaggedAt: 1 };
      if (params.sortBy === 'name') sort = { firstName: 1, lastName: 1 };
      
      // Get flagged users
      const flaggedUsers = await usersCollection.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .project({ password: 0, __v: 0 })
        .toArray();
      
      // Get fraud reports
      const fraudReports = await fraudReportsCollection.find({})
        .sort({ reportedAt: -1 })
        .limit(10)
        .toArray();
      
      const total = await usersCollection.countDocuments(query);
      
      // Calculate statistics
      const highRisk = await usersCollection.countDocuments({ 
        isFlagged: true, 
        riskScore: { $gte: 70 } 
      });
      
      const mediumRisk = await usersCollection.countDocuments({ 
        isFlagged: true, 
        riskScore: { $gte: 40, $lt: 70 } 
      });
      
      const lowRisk = await usersCollection.countDocuments({ 
        isFlagged: true, 
        riskScore: { $lt: 40 } 
      });
      
      // Get fraud patterns
      const fraudPatterns = await fraudReportsCollection.aggregate([
        { $group: { 
          _id: "$type", 
          count: { $sum: 1 },
          avgResolutionTime: { $avg: "$resolutionTime" }
        }},
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]).toArray();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Fraud monitoring data retrieved successfully',
          flaggedAccounts: flaggedUsers,
          fraudReports,
          statistics: {
            highRisk,
            mediumRisk,
            lowRisk,
            totalFlagged: highRisk + mediumRisk + lowRisk,
            resolvedToday: await fraudReportsCollection.countDocuments({
              resolvedAt: { 
                $gte: new Date(new Date().setHours(0, 0, 0, 0)) 
              }
            }),
            pendingReview: total
          },
          fraudPatterns,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        })
      };
    }
    
    // POST - Run fraud detection scan
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { scanType, userId } = body;
      
      if (!scanType) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Scan type is required' })
        };
      }
      
      let scanResults = [];
      
      if (scanType === 'full' || scanType === 'users') {
        // Scan all users for fraud indicators
        const users = await usersCollection.find({}).toArray();
        
        for (const user of users) {
          let riskScore = 0;
          let reasons = [];
          
          // Check email
          if (fraudDetectionAlgorithms.detectSuspiciousEmail(user.email)) {
            riskScore += 25;
            reasons.push('Suspicious email pattern');
          }
          
          // Check recent activity
          if (user.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
            riskScore += 15;
            reasons.push('Recently created account');
          }
          
          // Check verification status
          if (!user.isVerified) {
            riskScore += 10;
            reasons.push('Unverified account');
          }
          
          // Check profile completeness
          if (!user.profileImage || !user.phone) {
            riskScore += 5;
            reasons.push('Incomplete profile');
          }
          
          // Update user if risk score changed
          if (riskScore >= 30 && (!user.riskScore || user.riskScore !== riskScore)) {
            await usersCollection.updateOne(
              { _id: user._id },
              { 
                $set: { 
                  riskScore,
                  isFlagged: riskScore >= 40,
                  flaggedAt: riskScore >= 40 ? new Date() : null,
                  fraudDetails: {
                    reasons,
                    lastScanned: new Date()
                  },
                  updatedAt: new Date()
                }
              }
            );
            
            if (riskScore >= 40) {
              scanResults.push({
                userId: user._id,
                email: user.email,
                name: `${user.firstName} ${user.lastName}`,
                riskScore,
                reasons,
                type: user.role,
                flagged: true
              });
            }
          }
        }
      }
      
      if (scanType === 'full' || scanType === 'listings') {
        // Scan listings for fraud
        const listings = await housesCollection.find({ 
          status: { $in: ['pending', 'approved'] } 
        }).toArray();
        
        for (const listing of listings) {
          let riskScore = 0;
          let reasons = [];
          
          // Check for duplicate listings
          const duplicates = await fraudDetectionAlgorithms.detectDuplicateListings(
            housesCollection, 
            listing.ownerId
          );
          
          if (duplicates.length > 0) {
            riskScore += 30;
            reasons.push(`Found ${duplicates.length} duplicate listings`);
          }
          
          // Check for suspicious pricing
          if (listing.price.amount < 10) {
            riskScore += 25;
            reasons.push('Unrealistically low price');
          }
          
          // Check for missing images
          if (!listing.images || listing.images.length < 2) {
            riskScore += 15;
            reasons.push('Insufficient images');
          }
          
          // Check for external links in description
          if (listing.description && listing.description.includes('http')) {
            riskScore += 10;
            reasons.push('External links in description');
          }
          
          // Update listing if high risk
          if (riskScore >= 40) {
            await housesCollection.updateOne(
              { _id: listing._id },
              { 
                $set: { 
                  fraudRiskScore: riskScore,
                  fraudReasons: reasons,
                  requiresReview: true,
                  lastFraudScan: new Date()
                }
              }
            );
            
            // Also flag the owner
            await usersCollection.updateOne(
              { _id: listing.ownerId },
              { 
                $inc: { riskScore: riskScore * 0.5 }, // Owner gets 50% of listing risk
                $set: { 
                  isFlagged: true,
                  flaggedAt: new Date(),
                  updatedAt: new Date()
                },
                $push: {
                  fraudDetails: {
                    listingId: listing._id,
                    reasons: reasons,
                    timestamp: new Date()
                  }
                }
              }
            );
          }
        }
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Fraud detection scan (${scanType}) completed successfully`,
          results: {
            scanType,
            timestamp: new Date().toISOString(),
            accountsScanned: scanType === 'full' ? 'all' : scanType,
            newFlags: scanResults.length,
            details: scanResults
          },
          recommendations: scanResults.length > 0 ? [
            'Review high-risk accounts immediately',
            'Consider temporary suspension for accounts with risk score > 70',
            'Request additional verification for medium-risk accounts'
          ] : [
            'No immediate action required',
            'Schedule next scan in 24 hours'
          ]
        })
      };
    }
    
    // PUT - Resolve fraud case
    if (event.httpMethod === 'PUT') {
      const caseId = event.pathParameters?.id;
      
      if (!caseId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Case ID is required' })
        };
      }
      
      const body = JSON.parse(event.body);
      const { action, resolution, notes, userId } = body;
      
      if (!action || !resolution) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Action and resolution are required' })
        };
      }
      
      const validActions = ['dismiss', 'suspend', 'warn', 'require_verification'];
      if (!validActions.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid action. Must be one of: ${validActions.join(', ')}` 
          })
        };
      }
      
      let result;
      
      if (userId) {
        // Resolve user fraud case
        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        
        if (!user) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'User not found' })
          };
        }
        
        const updateFields = {
          updatedAt: new Date(),
          fraudCaseResolved: true,
          fraudResolution: {
            action,
            resolution,
            notes,
            resolvedBy: decoded.userId,
            resolvedByEmail: decoded.email,
            resolvedAt: new Date()
          }
        };
        
        // Apply action
        switch (action) {
          case 'suspend':
            updateFields.isSuspended = true;
            updateFields.suspendedAt = new Date();
            updateFields.suspensionReason = `Fraud detection: ${resolution}`;
            break;
            
          case 'warn':
            updateFields.lastWarningAt = new Date();
            updateFields.warningReason = resolution;
            break;
            
          case 'require_verification':
            updateFields.requiresAdditionalVerification = true;
            updateFields.verificationRequiredReason = resolution;
            break;
        }
        
        result = await usersCollection.findOneAndUpdate(
          { _id: new ObjectId(userId) },
          { $set: updateFields },
          { returnDocument: 'after', projection: { password: 0, __v: 0 } }
        );
        
        // Create fraud report record
        await fraudReportsCollection.insertOne({
          userId: user._id,
          userEmail: user.email,
          userName: `${user.firstName} ${user.lastName}`,
          type: 'user_fraud',
          action,
          resolution,
          notes,
          reportedAt: user.flaggedAt || new Date(),
          resolvedBy: decoded.userId,
          resolvedByEmail: decoded.email,
          resolvedAt: new Date(),
          resolutionTime: new Date() - (user.flaggedAt || new Date())
        });
        
      } else {
        // Handle other types of fraud cases
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'User ID is required for fraud resolution' })
        };
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Fraud case resolved with action: ${action}`,
          result,
          action,
          resolution,
          resolvedBy: decoded.email,
          resolvedAt: new Date().toISOString()
        })
      };
    }
    
  } catch (error) {
    console.error('Fraud monitoring error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' })
      };
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