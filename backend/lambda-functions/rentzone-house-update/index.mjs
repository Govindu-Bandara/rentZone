import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

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

// Helper function to send WebSocket notifications (consistent with other functions)
async function sendWebSocketNotification(connectionId, notificationData) {
  try {
    if (!process.env.WEBSOCKET_ENDPOINT) {
      console.log('WebSocket endpoint not configured');
      return false;
    }
    
    const apiGatewayClient = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_ENDPOINT
    });
    
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: 'notification',
        notification: notificationData
      })
    });
    
    await apiGatewayClient.send(command);
    console.log(`✅ WebSocket notification sent to connection: ${connectionId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send WebSocket notification:', error.message);
    return false;
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'PUT,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    const houseId = event.pathParameters?.id;
    
    if (!houseId || !ObjectId.isValid(houseId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid house ID is required' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const notificationsCollection = db.collection('notifications');
    const sessionsCollection = db.collection('websocket_sessions');
    
    const existingHouse = await housesCollection.findOne({ _id: new ObjectId(houseId) });
    
    if (!existingHouse) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'House not found' })
      };
    }
    
    // Check if user owns this house or is admin (consistent with create function)
    if (existingHouse.ownerId.toString() !== decoded.userId && decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'You do not have permission to update this house',
          message: 'Only property owners or admins can update listings'
        })
      };
    }
    
    const body = JSON.parse(event.body);
    
    // VALIDATION: Same as create function
    const {
      title,
      description,
      rentalType,
      price,
      location,
      propertyDetails,
      propertyType,
      rules,
      amenities,
      images,
      tags,
      availability,
      contactPhone,
      showPhone
    } = body;
    
    const updateFields = {
      updatedAt: new Date()
    };
    
    // Only update fields that are provided
    if (title !== undefined) {
      if (!title || title.trim().length < 10) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Title must be at least 10 characters' })
        };
      }
      updateFields.title = title.trim();
    }
    
    if (description !== undefined) {
      if (!description || description.trim().length < 50) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Description must be at least 50 characters' })
        };
      }
      updateFields.description = description.trim();
    }
    
    if (rentalType !== undefined) {
      const validRentalTypes = ['daily', 'monthly'];
      if (!validRentalTypes.includes(rentalType)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid rental type. Must be one of: ${validRentalTypes.join(', ')}` 
          })
        };
      }
      updateFields.rentalType = rentalType;
    }
    
    if (propertyType !== undefined) {
      const validPropertyTypes = ['Apartment', 'House', 'Boarding Place', 'Short-Stay Rental'];
      if (!validPropertyTypes.includes(propertyType)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid property type. Must be one of: ${validPropertyTypes.join(', ')}` 
          })
        };
      }
      updateFields.propertyType = propertyType;
    }
    
    // Validate property type and rental type consistency (from create function)
    if (propertyType && rentalType) {
      if (propertyType === 'Short-Stay Rental' && rentalType !== 'daily') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Short-Stay Rental must be daily basis. Change rentalType to "daily".' 
          })
        };
      } else if (propertyType !== 'Short-Stay Rental' && rentalType !== 'monthly') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Apartment, House, and Boarding Place must be monthly basis. Change rentalType to "monthly".' 
          })
        };
      }
    }
    
    if (location !== undefined) {
      if (!location.address || !location.city) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Address and city are required in location' })
        };
      }
      updateFields.location = {
        address: location.address.trim(),
        city: location.city.trim(),
        state: location.state?.trim() || null,
        country: location.country?.trim() || 'Sri Lanka',
        zipCode: location.zipCode?.trim() || null,
        coordinates: location.coordinates ? {
          latitude: location.coordinates.latitude,
          longitude: location.coordinates.longitude
        } : null,
        district: location.district?.trim() || null,
        province: location.province?.trim() || null,
        landmark: location.landmark?.trim() || null
      };
    }
    
    if (price !== undefined) {
      if (!price.amount || typeof price.amount !== 'number' || price.amount <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid price amount is required' })
        };
      }
      
      updateFields.price = {
        amount: parseFloat(price.amount),
        currency: price.currency?.toUpperCase() || 'LKR',
        period: price.period || (rentalType || existingHouse.rentalType) === 'daily' ? 'per day' : 'per month',
        securityDeposit: price.securityDeposit ? parseFloat(price.securityDeposit) : null,
        cleaningFee: price.cleaningFee ? parseFloat(price.cleaningFee) : null,
        weeklyDiscount: price.weeklyDiscount ? parseFloat(price.weeklyDiscount) : 0,
        monthlyDiscount: price.monthlyDiscount ? parseFloat(price.monthlyDiscount) : 0,
        minMonthsForDiscount: price.minMonthsForDiscount || null
      };
    }
    
    if (propertyDetails !== undefined) {
      if (!propertyDetails.bedrooms || propertyDetails.bedrooms < 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Bedrooms count is required in propertyDetails' })
        };
      }
      
      if (!propertyDetails.bathrooms || propertyDetails.bathrooms < 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Bathrooms count is required in propertyDetails' })
        };
      }
      
      updateFields.propertyDetails = {
        bedrooms: parseInt(propertyDetails.bedrooms) || 0,
        bathrooms: parseInt(propertyDetails.bathrooms) || 0,
        squareFeet: parseFloat(propertyDetails.squareFeet) || null,
        furnishingStatus: propertyDetails.furnishingStatus || 'unfurnished',
        beds: parseInt(propertyDetails.beds) || parseInt(propertyDetails.bedrooms) || 1,
        totalRooms: parseInt(propertyDetails.totalRooms) || null,
        floor: parseInt(propertyDetails.floor) || null,
        totalFloors: parseInt(propertyDetails.totalFloors) || null,
        yearBuilt: parseInt(propertyDetails.yearBuilt) || null,
        parkingSpaces: parseInt(propertyDetails.parkingSpaces) || 0
      };
    }
    
    // Parse arrays if provided as strings
    if (amenities !== undefined) {
      const parsedAmenities = Array.isArray(amenities) ? amenities : 
                             (amenities ? amenities.split(',').map(a => a.trim()) : []);
      updateFields.amenities = parsedAmenities;
    }
    
    if (rules !== undefined) {
      const parsedRules = Array.isArray(rules) ? rules : 
                         (rules ? rules.split(',').map(r => r.trim()) : []);
      updateFields.rules = parsedRules;
    }
    
    if (tags !== undefined) {
      const parsedTags = Array.isArray(tags) ? tags : 
                        (tags ? tags.split(',').map(t => t.trim()) : []);
      updateFields.tags = parsedTags;
    }
    
    if (images !== undefined) {
      updateFields.images = Array.isArray(images) ? images : [];
    }
    
    if (availability !== undefined) {
      updateFields.availability = {
        isAvailable: availability?.isAvailable !== false,
        availableFrom: availability?.availableFrom ? new Date(availability.availableFrom) : new Date(),
        availableUntil: availability?.availableUntil ? new Date(availability.availableUntil) : null,
        minStay: availability?.minStay || (rentalType || existingHouse.rentalType) === 'daily' ? 1 : 1,
        maxStay: availability?.maxStay || null,
        bookingAdvance: availability?.bookingAdvance || 0
      };
    }
    
    if (contactPhone !== undefined) {
      if (!updateFields.contactInfo) updateFields.contactInfo = {};
      updateFields.contactInfo.phone = contactPhone;
    }
    
    if (showPhone !== undefined) {
      if (!updateFields.contactInfo) updateFields.contactInfo = {};
      updateFields.contactInfo.showPhone = showPhone !== false;
    }
    
    // Reset verification status if significant changes made (admin will need to re-verify)
    const significantFields = ['title', 'description', 'price', 'location', 'propertyDetails', 'images'];
    const hasSignificantChanges = Object.keys(updateFields).some(field => 
      significantFields.includes(field) && field !== 'updatedAt'
    );
    
    if (hasSignificantChanges && existingHouse.isVerified) {
      updateFields.isVerified = false;
      updateFields.verificationStatus = 'pending';
      updateFields.verificationHistory = existingHouse.verificationHistory || [];
      updateFields.verificationHistory.push({
        action: 'reverification_required',
        reason: 'Significant changes made to listing',
        performedBy: decoded.userId,
        performedByEmail: decoded.email,
        timestamp: new Date(),
        changes: Object.keys(updateFields).filter(field => significantFields.includes(field))
      });
    }
    
    const result = await housesCollection.findOneAndUpdate(
      { _id: new ObjectId(houseId) },
      { $set: updateFields },
      { returnDocument: 'after' }
    );
    
    // ========== NOTIFICATION SYSTEM INTEGRATION (Consistent with other functions) ==========
    try {
      // Get owner details
      const owner = await usersCollection.findOne(
        { _id: existingHouse.ownerId },
        { projection: { firstName: 1, lastName: 1, email: 1 } }
      );
      
      // Create notification for property update
      const notification = {
        userId: existingHouse.ownerId,
        type: 'listing_updated',
        title: '📝 Listing Updated',
        message: `Your listing "${result.title}" has been updated successfully`,
        data: {
          listingId: result._id,
          title: result.title,
          updatedFields: Object.keys(updateFields).filter(f => !['updatedAt', 'verificationHistory'].includes(f)),
          updatedAt: new Date(),
          previousStatus: existingHouse.verificationStatus,
          currentStatus: result.verificationStatus,
          verificationNote: hasSignificantChanges && existingHouse.isVerified ? 
            'Property requires re-verification due to significant changes' : null
        },
        isRead: false,
        priority: 'medium',
        category: 'listing',
        senderId: new ObjectId(decoded.userId),
        createdAt: new Date(),
        actionUrl: `/owner/listings/${result._id}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };
      
      await notificationsCollection.insertOne(notification);
      
      // Send real-time WebSocket notification if owner is online
      const ownerSession = await sessionsCollection.findOne({ 
        userId: existingHouse.ownerId, 
        isActive: true 
      });
      
      if (ownerSession) {
        await sendWebSocketNotification(ownerSession.connectionId, {
          _id: new ObjectId().toString(),
          type: 'listing_updated',
          title: '📝 Listing Updated',
          message: `Your listing "${result.title}" has been updated`,
          data: {
            listingId: result._id.toString(),
            title: result.title,
            verificationStatus: result.verificationStatus,
            requiresReVerification: hasSignificantChanges && existingHouse.isVerified
          },
          isRead: false,
          priority: 'medium',
          category: 'listing',
          createdAt: new Date().toISOString(),
          actionUrl: `/owner/listings/${result._id}`
        });
      }
      
      console.log('📢 Listing update notification sent');
      
    } catch (notificationError) {
      console.error('❌ Listing update notification failed:', notificationError);
      // Don't fail the update if notifications fail
    }
    // ========== END NOTIFICATION SYSTEM ==========
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'House updated successfully',
        house: result,
        changes: Object.keys(updateFields).filter(f => f !== 'updatedAt'),
        verification: {
          status: result.verificationStatus,
          isVerified: result.isVerified,
          requiresReVerification: hasSignificantChanges && existingHouse.isVerified,
          note: hasSignificantChanges && existingHouse.isVerified ? 
            'Property requires admin re-verification due to significant changes' : null
        },
        notification: {
          sent: true,
          message: 'Owner has been notified of the update'
        }
      })
    };
    
  } catch (error) {
    console.error('❌ Update house error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' })
      };
    }
    
    if (error.name === 'ValidationError') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Validation error', details: error.message })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};