import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
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

async function sendWebSocketNotification(connectionId, notificationData) {
  try {
    if (!process.env.WEBSOCKET_ENDPOINT) {
      console.log('WebSocket endpoint not configured');
      return false;
    }
    const apiGatewayClient = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_ENDPOINT,
    });
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: 'notification',
        notification: notificationData,
      }),
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
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
        body: JSON.stringify({ error: 'Only renters can submit booking requests' }),
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
      duration,
      durationType,
      specialRequests,
      renterPhone,
    } = body;

    if (!houseId || !moveInDate || !duration) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields: houseId, moveInDate, duration',
        }),
      };
    }

    const house = await housesCollection.findOne({
      _id: new ObjectId(houseId),
      status: 'approved',
      isActive: true,
      'availability.isAvailable': true,
    });

    if (!house) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Property not available for booking' }),
      };
    }

    const checkInDate = new Date(moveInDate);
    let checkOutDate = new Date(checkInDate);

    switch (durationType) {
      case 'days':
        checkOutDate.setDate(checkOutDate.getDate() + parseInt(duration, 10));
        break;
      case 'weeks':
        checkOutDate.setDate(checkOutDate.getDate() + (parseInt(duration, 10) * 7));
        break;
      case 'months':
      default:
        checkOutDate.setMonth(checkOutDate.getMonth() + parseInt(duration, 10));
        break;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkInDate < today) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Move-in date must be in the future' }),
      };
    }

    const existingBooking = await bookingsCollection.findOne({
      houseId: new ObjectId(houseId),
      status: { $in: ['pending', 'confirmed', 'active'] },
      $or: [
        {
          checkInDate: { $lte: checkOutDate },
          checkOutDate: { $gte: checkInDate },
        },
      ],
    });

    if (existingBooking) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: 'Property not available for selected dates',
          conflictingDates: {
            existingCheckIn: existingBooking.checkInDate,
            existingCheckOut: existingBooking.checkOutDate,
          },
        }),
      };
    }

    const pricePerUnit = Number(house.price?.amount || 0);
    const securityDeposit = Number(house.price?.securityDeposit || 0);
    const isDailyRental =
      house.rentalType === 'daily' || house.propertyType === 'Short-Stay Rental';

    let rentAmount = 0;
    let totalNights = 0;

    if (isDailyRental) {
      const timeDiff = checkOutDate - checkInDate;
      totalNights = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      rentAmount = pricePerUnit * totalNights;
      console.log(`📅 Daily rental: ${totalNights} nights @ LKR ${pricePerUnit}/night = LKR ${rentAmount}`);
    } else {
      switch (durationType) {
        case 'days': {
          const days = parseInt(duration, 10);
          rentAmount = (pricePerUnit / 30) * days;
          console.log(`📅 Monthly rental (days): ${days} days = LKR ${rentAmount}`);
          break;
        }
        case 'weeks': {
          const weeks = parseInt(duration, 10);
          rentAmount = (pricePerUnit / 4) * weeks;
          console.log(`📅 Monthly rental (weeks): ${weeks} weeks = LKR ${rentAmount}`);
          break;
        }
        case 'months':
        default:
          rentAmount = pricePerUnit * parseInt(duration, 10);
          console.log(`📅 Monthly rental: ${duration} months = LKR ${rentAmount}`);
          break;
      }
    }

    if (!isDailyRental && house.price?.monthlyDiscount && parseInt(duration, 10) >= Number(house.price?.minMonthsForDiscount || 0)) {
      rentAmount -= (rentAmount * Number(house.price.monthlyDiscount)) / 100;
      console.log(`💰 Monthly rental discount applied: LKR ${rentAmount}`);
    }

    const totalAmount = rentAmount + securityDeposit;

    // Fetch renter with profileImage
    const renter = await usersCollection.findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, profileImage: 1 } }
    );

    // Fetch owner with profileImage
    const owner = await usersCollection.findOne(
      { _id: house.ownerId },
      { projection: { firstName: 1, lastName: 1, email: 1, profileImage: 1 } }
    );

    const bookingRequest = {
      houseId: new ObjectId(houseId),
      ownerId: house.ownerId,
      renterId: new ObjectId(decoded.userId),
      renterName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim(),
      renterEmail: renter?.email || '',
      renterPhone: renterPhone || renter?.phone || '',
      moveInDate: checkInDate,
      duration: parseInt(duration, 10),
      durationType: durationType || 'months',
      checkInDate,
      checkOutDate,
      specialRequests: specialRequests || '',
      monthlyRent: pricePerUnit,
      rentAmount,
      securityDeposit,
      totalAmount,
      isDailyRental,
      totalNights: isDailyRental ? totalNights : null,
      status: 'pending',
      paymentStatus: 'pending',
      bookingCode: `BK-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(bookingRequest);

    const propertyDetails = await housesCollection.findOne(
      { _id: new ObjectId(houseId) },
      { projection: { title: 1, images: 1, mainImage: 1, 'location.address': 1, 'location.city': 1 } }
    );

    try {
      const notificationsCollection = db.collection('notifications');
      const sessionsCollection = db.collection('websocket_sessions');

      const mainImageUrl = propertyDetails?.mainImage?.url || propertyDetails?.mainImage || propertyDetails?.images?.[0]?.url || propertyDetails?.images?.[0];

      // ── OWNER NOTIFICATION ── with renter profileImage
      const ownerNotification = {
        userId: house.ownerId,
        type: 'booking_request',
        title: '📥 New Booking Request!',
        message: `${renter?.firstName || 'A renter'} ${renter?.lastName || ''} wants to book "${propertyDetails?.title || 'your property'}"`,
        data: {
          bookingId: result.insertedId,
          bookingCode: bookingRequest.bookingCode,
          houseId,
          renterId: decoded.userId,
          renterName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim(),
          renterEmail: renter?.email || '',
          renterProfileImage: renter?.profileImage || null, // ← profileImage added
          moveInDate: checkInDate,
          checkOutDate,
          totalAmount,
          duration: `${duration} ${durationType}`,
          propertyTitle: propertyDetails?.title,
          propertyAddress: propertyDetails?.location?.address,
          mainImage: mainImageUrl,
          isDailyRental,
          nights: isDailyRental ? totalNights : null,
          dailyRate: isDailyRental ? pricePerUnit : null,
        },
        isRead: false,
        priority: 'high',
        category: 'booking',
        senderId: new ObjectId(decoded.userId),
        createdAt: new Date(),
        actionUrl: `/owner/bookings/${result.insertedId}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      await notificationsCollection.insertOne(ownerNotification);

      const ownerSession = await sessionsCollection.findOne({
        userId: house.ownerId,
        isActive: true,
      });

      if (ownerSession) {
        await sendWebSocketNotification(ownerSession.connectionId, {
          _id: new ObjectId().toString(),
          type: 'booking_request',
          title: '📥 New Booking Request!',
          message: `You have a new booking request from ${renter?.firstName || 'a renter'}`,
          data: {
            bookingId: result.insertedId.toString(),
            bookingCode: bookingRequest.bookingCode,
            propertyTitle: propertyDetails?.title,
            mainImage: mainImageUrl,
            renterName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim(),
            renterProfileImage: renter?.profileImage || null, // ← profileImage added
            amount: totalAmount,
            moveInDate: checkInDate.toISOString().split('T')[0],
            checkOutDate: checkOutDate.toISOString().split('T')[0],
            isDailyRental,
            nights: isDailyRental ? totalNights : null,
            dailyRate: isDailyRental ? pricePerUnit : null,
          },
          isRead: false,
          priority: 'high',
          category: 'booking',
          createdAt: new Date().toISOString(),
          actionUrl: `/owner/bookings/${result.insertedId}`,
        });
      }

      // ── RENTER NOTIFICATION ── with owner profileImage
      const renterNotification = {
        userId: new ObjectId(decoded.userId),
        type: 'booking_submitted',
        title: '✅ Booking Request Sent!',
        message: `Your booking request for "${propertyDetails?.title || 'your property'}" has been sent to the owner`,
        data: {
          bookingId: result.insertedId,
          bookingCode: bookingRequest.bookingCode,
          houseId,
          ownerId: house.ownerId.toString(),
          ownerName: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : 'Property Owner',
          ownerProfileImage: owner?.profileImage || null, // ← profileImage added
          moveInDate: checkInDate,
          checkOutDate,
          totalAmount,
          duration: `${duration} ${durationType}`,
          propertyTitle: propertyDetails?.title,
          mainImage: mainImageUrl,
          isDailyRental,
          nights: isDailyRental ? totalNights : null,
          dailyRate: isDailyRental ? pricePerUnit : null,
        },
        isRead: false,
        priority: 'medium',
        category: 'booking',
        senderId: house.ownerId,
        createdAt: new Date(),
        actionUrl: `/renter/bookings/${result.insertedId}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      await notificationsCollection.insertOne(renterNotification);

      const renterSession = await sessionsCollection.findOne({
        userId: new ObjectId(decoded.userId),
        isActive: true,
      });

      if (renterSession) {
        await sendWebSocketNotification(renterSession.connectionId, {
          _id: new ObjectId().toString(),
          type: 'booking_submitted',
          title: '✅ Booking Request Sent!',
          message: 'Your booking request has been submitted successfully',
          data: {
            bookingId: result.insertedId.toString(),
            bookingCode: bookingRequest.bookingCode,
            propertyTitle: propertyDetails?.title,
            mainImage: mainImageUrl,
            ownerName: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : 'Property Owner',
            ownerProfileImage: owner?.profileImage || null, // ← profileImage added
            isDailyRental,
            totalAmount,
          },
          isRead: false,
          priority: 'medium',
          category: 'booking',
          createdAt: new Date().toISOString(),
          actionUrl: `/renter/bookings/${result.insertedId}`,
        });
      }

      console.log('📢 Notifications created successfully');
    } catch (notificationError) {
      console.error('❌ Notification creation failed:', notificationError);
    }

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
          property: propertyDetails
            ? {
                title: propertyDetails.title,
                mainImage: propertyDetails.mainImage?.url || propertyDetails.mainImage || propertyDetails.images?.[0]?.url || propertyDetails.images?.[0],
                address: propertyDetails.location?.address,
                city: propertyDetails.location?.city,
              }
            : null,
        },
        paymentInstructions: {
          totalDue: totalAmount,
          breakdown: {
            rent: rentAmount,
            securityDeposit,
          },
          pricing: isDailyRental
            ? {
                type: 'daily',
                ratePerDay: pricePerUnit,
                numberOfNights: totalNights,
                totalRent: rentAmount,
                note: `${totalNights} night${totalNights !== 1 ? 's' : ''} @ LKR ${pricePerUnit.toLocaleString()}/night = LKR ${rentAmount.toLocaleString()}`,
              }
            : {
                type: 'monthly',
                note: 'Payment will be required after owner accepts your booking request',
              },
        },
        notification: {
          sent: true,
          message: 'Owner has been notified of your booking request',
        },
      }),
    };
  } catch (error) {
    console.error('❌ Booking request error:', error);

    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message,
      }),
    };
  }
};