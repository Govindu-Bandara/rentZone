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

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
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
        body: JSON.stringify({ error: 'Only renters can access bookings' })
      };
    }
    
    const db = await connectToDatabase();
    const bookingsCollection = db.collection('bookings');
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    
    const renterId = new ObjectId(decoded.userId);
    const params = event.queryStringParameters || {};
    
    // GET - Get bookings
    if (event.httpMethod === 'GET') {
      const query = { renterId };
      
      // Filter by status
      if (params.status) {
        if (params.status === 'active') {
          query.status = { $in: ['confirmed', 'active'] };
        } else {
          query.status = params.status;
        }
      }
      
      // Filter by property
      if (params.houseId) {
        query.houseId = new ObjectId(params.houseId);
      }
      
      // Pagination
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 10;
      const skip = (page - 1) * limit;
      
      // Sorting
      let sort = { createdAt: -1 };
      if (params.sortBy === 'checkin') sort = { checkInDate: 1 };
      if (params.sortBy === 'checkout') sort = { checkOutDate: 1 };
      
      const bookings = await bookingsCollection.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray();
      
      // Enrich with property and owner details
      const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
        const house = await housesCollection.findOne(
          { _id: booking.houseId },
          { projection: { title: 1, images: 1, 'location.city': 1, 'location.address': 1 } }
        );
        
        const owner = await usersCollection.findOne(
          { _id: booking.ownerId },
          { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, profileImage: 1 } }
        );
        
        return {
          ...booking,
          property: house ? {
            title: house.title,
            mainImage: house.images?.[0],
            city: house.location?.city,
            address: house.location?.address
          } : null,
          owner: owner ? {
            name: `${owner.firstName} ${owner.lastName}`,
            email: owner.email,
            phone: owner.phone,
            profileImage: owner.profileImage
          } : null
        };
      }));
      
      const total = await bookingsCollection.countDocuments(query);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Bookings retrieved successfully',
          bookings: enrichedBookings,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        })
      };
    }
    
    // POST - Create new booking
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const {
        houseId,
        checkInDate,
        checkOutDate,
        guests,
        specialRequests,
        paymentMethod
      } = body;
      
      // Validation
      if (!houseId || !checkInDate || !checkOutDate || !guests) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing required fields: houseId, checkInDate, checkOutDate, guests' })
        };
      }
      
      // Check if house exists and is available
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
      
      // Check if dates are available
      const existingBooking = await bookingsCollection.findOne({
        houseId: new ObjectId(houseId),
        status: { $in: ['pending', 'confirmed', 'active'] },
        $or: [
          {
            checkInDate: { $lte: new Date(checkOutDate) },
            checkOutDate: { $gte: new Date(checkInDate) }
          }
        ]
      });
      
      if (existingBooking) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Property not available for selected dates' })
        };
      }
      
      // Calculate total amount
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
      const months = Math.ceil(nights / 30);
      
      let totalAmount = 0;
      if (house.rentalType === 'daily') {
        totalAmount = house.price.amount * nights;
      } else {
        totalAmount = house.price.amount * months;
      }
      
      // Apply discounts
      if (house.price.weeklyDiscount && nights >= 7) {
        totalAmount -= (totalAmount * house.price.weeklyDiscount / 100);
      }
      
      if (house.price.monthlyDiscount && nights >= 30) {
        totalAmount -= (totalAmount * house.price.monthlyDiscount / 100);
      }
      
      // Add security deposit if applicable
      if (house.price.securityDeposit) {
        totalAmount += house.price.securityDeposit;
      }
      
      // Create booking
      const newBooking = {
        houseId: new ObjectId(houseId),
        ownerId: house.ownerId,
        renterId,
        renterName: `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim(),
        renterEmail: decoded.email,
        renterPhone: body.phone || null,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        nights,
        months,
        guests: parseInt(guests),
        specialRequests: specialRequests || '',
        totalAmount,
        status: 'pending',
        paymentStatus: 'pending',
        paymentMethod: paymentMethod || 'card',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await bookingsCollection.insertOne(newBooking);
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          message: 'Booking request created successfully',
          bookingId: result.insertedId,
          booking: { ...newBooking, _id: result.insertedId }
        })
      };
    }
    
    // PUT - Update booking (cancel, etc.)
    if (event.httpMethod === 'PUT') {
      const bookingId = event.pathParameters?.id;
      if (!bookingId || !ObjectId.isValid(bookingId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid booking ID is required' })
        };
      }
      
      const body = JSON.parse(event.body);
      const { action, reason } = body;
      
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
        renterId
      });
      
      if (!booking) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Booking not found' })
        };
      }
      
      let updateFields = {};
      
      if (action === 'cancel') {
        if (booking.status === 'cancelled') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Booking is already cancelled' })
          };
        }
        
        if (booking.status === 'completed') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Cannot cancel completed booking' })
          };
        }
        
        updateFields.status = 'cancelled';
        updateFields.cancellationReason = reason;
        updateFields.cancelledAt = new Date();
        
      } else if (action === 'update_dates') {
        if (booking.status !== 'pending') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Can only update dates for pending bookings' })
          };
        }
        
        if (!body.checkInDate || !body.checkOutDate) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'checkInDate and checkOutDate are required' })
          };
        }
        
        updateFields.checkInDate = new Date(body.checkInDate);
        updateFields.checkOutDate = new Date(body.checkOutDate);
        
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
      }
      
      updateFields.updatedAt = new Date();
      
      const result = await bookingsCollection.findOneAndUpdate(
        { _id: new ObjectId(bookingId), renterId },
        { $set: updateFields },
        { returnDocument: 'after' }
      );
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Booking ${action} successful`,
          booking: result
        })
      };
    }
    
  } catch (error) {
    console.error('Bookings error:', error);
    
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
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};