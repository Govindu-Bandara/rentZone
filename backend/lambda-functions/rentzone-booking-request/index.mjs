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

// Helper function to send WebSocket notifications
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
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    
    if (decoded.role !== 'renter') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only renters can submit booking requests' })
      };
    }
    
    const db = await connectToDatabase();
    const bookingsCollection = db.collection('bookings');
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    
    const body = JSON.parse(event.body);
    const {
      houseId,
      moveInDate,
      duration, // in months
      durationType, // 'days', 'weeks', 'months'
      specialRequests,
      renterPhone
    } = body;
    
    // Validation
    if (!houseId || !moveInDate || !duration) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields: houseId, moveInDate, duration' 
        })
      };
    }
    
    // Validate house exists and is available
    const house = await housesCollection.findOne({
      _id: new ObjectId(houseId),
      status: 'approved',
      isActive: true,
      'availability.isAvailable': true
    });
    
    if (!house) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Property not available for booking' })
      };
    }
    
    // Calculate dates
    const checkInDate = new Date(moveInDate);
    let checkOutDate = new Date(checkInDate);
    
    switch (durationType) {
      case 'days':
        checkOutDate.setDate(checkOutDate.getDate() + parseInt(duration));
        break;
      case 'weeks':
        checkOutDate.setDate(checkOutDate.getDate() + (parseInt(duration) * 7));
        break;
      case 'months':
      default:
        checkOutDate.setMonth(checkOutDate.getMonth() + parseInt(duration));
        break;
    }
    
    // Validate move-in date is in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (checkInDate < today) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Move-in date must be in the future' })
      };
    }
    
    // Check if dates are available
    const existingBooking = await bookingsCollection.findOne({
      houseId: new ObjectId(houseId),
      status: { $in: ['pending', 'confirmed', 'active'] },
      $or: [
        {
          checkInDate: { $lte: checkOutDate },
          checkOutDate: { $gte: checkInDate }
        }
      ]
    });
    
    if (existingBooking) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ 
          error: 'Property not available for selected dates',
          conflictingDates: {
            existingCheckIn: existingBooking.checkInDate,
            existingCheckOut: existingBooking.checkOutDate
          }
        })
      };
    }
    
    // Calculate total amount based on your screenshot (LKR 125,000 total)
    const monthlyRent = house.price.amount;
    const securityDeposit = house.price.securityDeposit || 0;
    
    // Calculate rent for the duration
    let rentAmount = 0;
    switch (durationType) {
      case 'days':
        const days = parseInt(duration);
        rentAmount = (monthlyRent / 30) * days;
        break;
      case 'weeks':
        const weeks = parseInt(duration);
        rentAmount = (monthlyRent / 4) * weeks;
        break;
      case 'months':
      default:
        rentAmount = monthlyRent * parseInt(duration);
        break;
    }
    
    // Apply any discounts
    if (house.price.monthlyDiscount && parseInt(duration) >= house.price.minMonthsForDiscount) {
      rentAmount -= (rentAmount * house.price.monthlyDiscount / 100);
    }
    
    const totalAmount = rentAmount + securityDeposit;
    
    // Get renter profile
    const renter = await usersCollection.findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { firstName: 1, lastName: 1, email: 1, phone: 1 } }
    );
    
    // Create booking request
    const bookingRequest = {
      houseId: new ObjectId(houseId),
      ownerId: house.ownerId,
      renterId: new ObjectId(decoded.userId),
      renterName: `${renter.firstName || ''} ${renter.lastName || ''}`.trim(),
      renterEmail: renter.email,
      renterPhone: renterPhone || renter.phone,
      moveInDate: checkInDate,
      duration: parseInt(duration),
      durationType: durationType || 'months',
      checkInDate: checkInDate,
      checkOutDate: checkOutDate,
      specialRequests: specialRequests || '',
      monthlyRent: monthlyRent,
      rentAmount: rentAmount,
      securityDeposit: securityDeposit,
      totalAmount: totalAmount,
      status: 'pending',
      paymentStatus: 'pending',
      bookingCode: `BK-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await bookingsCollection.insertOne(bookingRequest);
    
    // Get property details for response
    const propertyDetails = await housesCollection.findOne(
      { _id: new ObjectId(houseId) },
      { projection: { title: 1, images: 1, 'location.address': 1, 'location.city': 1 } }
    );
    
    // ========== NOTIFICATION SYSTEM INTEGRATION ==========
    
    try {
      const notificationsCollection = db.collection('notifications');
      const sessionsCollection = db.collection('websocket_sessions');
      
      // Get owner details for notification
      const owner = await usersCollection.findOne(
        { _id: house.ownerId },
        { projection: { firstName: 1, lastName: 1, email: 1 } }
      );
      
      // 1. Create database notification for owner
      const ownerNotification = {
        userId: house.ownerId,
        type: 'booking_request',
        title: '📥 New Booking Request!',
        message: `${renter.firstName} ${renter.lastName} wants to book "${propertyDetails?.title || 'your property'}"`,
        data: {
          bookingId: result.insertedId,
          bookingCode: bookingRequest.bookingCode,
          houseId: houseId,
          renterId: decoded.userId,
          renterName: `${renter.firstName} ${renter.lastName}`,
          renterEmail: renter.email,
          moveInDate: checkInDate,
          checkOutDate: checkOutDate,
          totalAmount: totalAmount,
          duration: `${duration} ${durationType}`,
          propertyTitle: propertyDetails?.title,
          propertyAddress: propertyDetails?.location?.address
        },
        isRead: false,
        priority: 'high',
        category: 'booking',
        senderId: new ObjectId(decoded.userId),
        createdAt: new Date(),
        actionUrl: `/owner/bookings/${result.insertedId}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };
      
      await notificationsCollection.insertOne(ownerNotification);
      
      // 2. Send real-time WebSocket notification to owner if online
      const ownerSession = await sessionsCollection.findOne({ 
        userId: house.ownerId, 
        isActive: true 
      });
      
      if (ownerSession) {
        await sendWebSocketNotification(ownerSession.connectionId, {
          _id: new ObjectId().toString(),
          type: 'booking_request',
          title: '📥 New Booking Request!',
          message: `You have a new booking request from ${renter.firstName}`,
          data: {
            bookingId: result.insertedId.toString(),
            bookingCode: bookingRequest.bookingCode,
            propertyTitle: propertyDetails?.title,
            renterName: `${renter.firstName} ${renter.lastName}`,
            amount: totalAmount,
            moveInDate: checkInDate.toISOString().split('T')[0]
          },
          isRead: false,
          priority: 'high',
          category: 'booking',
          createdAt: new Date().toISOString(),
          actionUrl: `/owner/bookings/${result.insertedId}`
        });
      }
      
      // 3. Create database notification for renter (confirmation)
      const renterNotification = {
        userId: new ObjectId(decoded.userId),
        type: 'booking_submitted',
        title: '✅ Booking Request Sent!',
        message: `Your booking request for "${propertyDetails?.title}" has been sent to the owner`,
        data: {
          bookingId: result.insertedId,
          bookingCode: bookingRequest.bookingCode,
          houseId: houseId,
          ownerId: house.ownerId.toString(),
          ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
          moveInDate: checkInDate,
          checkOutDate: checkOutDate,
          totalAmount: totalAmount,
          duration: `${duration} ${durationType}`,
          propertyTitle: propertyDetails?.title
        },
        isRead: false,
        priority: 'medium',
        category: 'booking',
        senderId: house.ownerId,
        createdAt: new Date(),
        actionUrl: `/renter/bookings/${result.insertedId}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };
      
      await notificationsCollection.insertOne(renterNotification);
      
      // 4. Send real-time WebSocket notification to renter
      const renterSession = await sessionsCollection.findOne({ 
        userId: new ObjectId(decoded.userId), 
        isActive: true 
      });
      
      if (renterSession) {
        await sendWebSocketNotification(renterSession.connectionId, {
          _id: new ObjectId().toString(),
          type: 'booking_submitted',
          title: '✅ Booking Request Sent!',
          message: `Your booking request has been submitted successfully`,
          data: {
            bookingId: result.insertedId.toString(),
            bookingCode: bookingRequest.bookingCode,
            propertyTitle: propertyDetails?.title,
            ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner'
          },
          isRead: false,
          priority: 'medium',
          category: 'booking',
          createdAt: new Date().toISOString(),
          actionUrl: `/renter/bookings/${result.insertedId}`
        });
      }
      
      console.log('📢 Notifications created successfully');
      
    } catch (notificationError) {
      console.error('❌ Notification creation failed:', notificationError);
      // Don't fail the booking request if notifications fail
    }
    // ========== END NOTIFICATION SYSTEM ==========
    
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: 'Booking request submitted successfully',
        bookingId: result.insertedId,
        bookingCode: bookingRequest.bookingCode,
        booking: {
          ...bookingRequest,
          _id: result.insertedId,
          property: propertyDetails ? {
            title: propertyDetails.title,
            mainImage: propertyDetails.images?.[0],
            address: propertyDetails.location?.address,
            city: propertyDetails.location?.city
          } : null
        },
        paymentInstructions: {
          totalDue: totalAmount,
          breakdown: {
            rent: rentAmount,
            securityDeposit: securityDeposit
          },
          note: 'Payment will be required after owner accepts your booking request'
        },
        notification: {
          sent: true,
          message: 'Owner has been notified of your booking request'
        }
      })
    };
    
  } catch (error) {
    console.error('❌ Booking request error:', error);
    
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