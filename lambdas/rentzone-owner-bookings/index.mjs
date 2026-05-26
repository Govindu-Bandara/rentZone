import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const ssmClient = new SSMClient({ region: 'ap-southeast-2' });
let cachedDb = null;
let cachedConnectionString = null;

async function getConnectionString() {
  if (cachedConnectionString) return cachedConnectionString;
  const command = new GetParameterCommand({ Name: process.env.MONGODB_URI_PARAM, WithDecryption: true });
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
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('No token provided');
  const token = authHeader.substring(7);
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function sendWebSocketNotification(connectionId, notificationData) {
  try {
    if (!process.env.WEBSOCKET_ENDPOINT) return false;
    const apiGatewayClient = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_ENDPOINT });
    await apiGatewayClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: 'notification', notification: notificationData }),
      }),
    );
    return true;
  } catch (error) {
    console.error('Failed to send WebSocket notification:', error.message);
    return false;
  }
}

function buildDurationDisplay(booking) {
  if (booking.isDailyRental) {
    const n = booking.totalNights || 0;
    return `${n} night${n !== 1 ? 's' : ''}`;
  }
  if (booking.duration && booking.durationType) {
    return `${booking.duration} ${booking.durationType}`;
  }
  return 'N/A';
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);

    if (decoded.role !== 'owner' && decoded.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only owners and admins can manage bookings' }),
      };
    }

    const db = await connectToDatabase();
    const bookingsCollection = db.collection('bookings');
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const notificationsCollection = db.collection('notifications');
    const sessionsCollection = db.collection('websocket_sessions');

    const ownerId = new ObjectId(decoded.userId);

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const query = { ownerId };

      if (params.status) {
        query.status = params.status;
      } else {
        query.status = { $in: ['pending', 'confirmed', 'active'] };
      }

      if (params.houseId) query.houseId = new ObjectId(params.houseId);

      if (params.startDate && params.endDate) {
        query.createdAt = { $gte: new Date(params.startDate), $lte: new Date(params.endDate) };
      }

      const page = parseInt(params.page, 10) || 1;
      const limit = parseInt(params.limit, 10) || 20;
      const skip = (page - 1) * limit;

      let sort = { createdAt: -1 };
      if (params.sortBy === 'checkin') sort = { checkInDate: 1 };
      if (params.sortBy === 'checkout') sort = { checkOutDate: 1 };
      if (params.sortBy === 'amount') sort = { totalAmount: -1 };

      const bookings = await bookingsCollection.find(query).sort(sort).skip(skip).limit(limit).toArray();

      const enrichedBookings = await Promise.all(
        bookings.map(async (booking) => {
          const house = await housesCollection.findOne(
            { _id: booking.houseId },
            { projection: { title: 1, propertyType: 1, images: 1, 'location.address': 1, 'location.city': 1 } },
          );
          const renter = await usersCollection.findOne(
            { _id: booking.renterId },
            { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, profileImage: 1 } },
          );

          return {
            ...booking,
            property: house
              ? {
                  title: house.title,
                  propertyType: house.propertyType,
                  mainImage: house.images?.[0],
                  address: house.location?.address,
                  city: house.location?.city,
                }
              : null,
            renter: renter
              ? {
                  name: `${renter.firstName} ${renter.lastName}`,
                  email: renter.email,
                  phone: renter.phone,
                  profileImage: renter.profileImage,
                }
              : null,
            durationDisplay: buildDurationDisplay(booking),
          };
        }),
      );

      const total = await bookingsCollection.countDocuments(query);

      const stats = await bookingsCollection
        .aggregate([
          { $match: { ownerId } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalRevenue: {
                $sum: {
                  $cond: [{ $in: ['$status', ['confirmed', 'active', 'completed']] }, '$totalAmount', 0],
                },
              },
            },
          },
        ])
        .toArray();

      const unreadBookingNotifications = await notificationsCollection.countDocuments({
        userId: ownerId,
        category: 'booking',
        isRead: false,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Owner bookings retrieved successfully',
          bookings: enrichedBookings,
          stats: stats.reduce((acc, s) => {
            acc[s._id] = { count: s.count, revenue: s.totalRevenue };
            return acc;
          }, {}),
          notifications: {
            unreadCount: unreadBookingNotifications,
            pendingBookings: await bookingsCollection.countDocuments({ ownerId, status: 'pending' }),
          },
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        }),
      };
    }

    if (event.httpMethod === 'PUT') {
      const bookingId = event.pathParameters?.id;
      if (!bookingId || !ObjectId.isValid(bookingId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid booking ID is required' }) };
      }

      const body = JSON.parse(event.body || '{}');
      const { action, reason, notes } = body;

      const validActions = ['accept', 'reject', 'cancel', 'complete'];
      if (!validActions.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Invalid action. Must be one of: accept, reject, cancel, complete',
          }),
        };
      }

      const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId), ownerId });
      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      const stateTransition = {
        pending: ['accept', 'reject', 'cancel'],
        confirmed: ['cancel', 'active', 'complete'],
        active: ['complete'],
        completed: [],
        cancelled: [],
        rejected: [],
      };

      if (!stateTransition[booking.status]?.includes(action)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Cannot ${action} booking with status: ${booking.status}` }),
        };
      }

      const updateFields = { updatedAt: new Date() };
      let newStatus = booking.status;
      let message = '';

      switch (action) {
        case 'accept':
          newStatus = 'confirmed';
          updateFields.confirmedAt = new Date();
          updateFields.confirmedBy = ownerId;
          message = 'Booking request accepted';
          break;
        case 'reject':
          newStatus = 'rejected';
          updateFields.rejectedAt = new Date();
          updateFields.rejectionReason = reason;
          message = 'Booking request rejected';
          break;
        case 'cancel':
          newStatus = 'cancelled';
          updateFields.cancelledAt = new Date();
          updateFields.cancelledBy = ownerId;
          updateFields.cancellationReason = reason;
          message = 'Booking cancelled';
          break;
        case 'complete':
          newStatus = 'completed';
          updateFields.completedAt = new Date();
          updateFields.completedBy = ownerId;
          updateFields.completionNotes = notes;
          message = 'Booking marked as completed';
          break;
      }

      updateFields.status = newStatus;
      updateFields.statusHistory = [
        ...(booking.statusHistory || []),
        { from: booking.status, to: newStatus, action, by: ownerId, reason, notes, at: new Date() },
      ];

      if (action === 'accept') {
        const overlapping = await bookingsCollection
          .find({
            _id: { $ne: new ObjectId(bookingId) },
            houseId: booking.houseId,
            status: { $in: ['confirmed', 'active'] },
            $or: [{ checkInDate: { $lte: booking.checkOutDate }, checkOutDate: { $gte: booking.checkInDate } }],
          })
          .toArray();

        if (overlapping.length > 0) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
              error: 'Cannot accept booking due to date conflicts with existing bookings',
              conflictingBookings: overlapping.map((b) => ({
                id: b._id,
                checkIn: b.checkInDate,
                checkOut: b.checkOutDate,
                status: b.status,
              })),
            }),
          };
        }
      }

      const result = await bookingsCollection.findOneAndUpdate(
        { _id: new ObjectId(bookingId), ownerId },
        { $set: updateFields },
        { returnDocument: 'after' },
      );

      try {
        const house = await housesCollection.findOne(
          { _id: booking.houseId },
          { projection: { title: 1, images: 1, 'location.address': 1 } },
        );
        const owner = await usersCollection.findOne(
          { _id: ownerId },
          { projection: { firstName: 1, lastName: 1, email: 1 } },
        );
        const renter = await usersCollection.findOne(
          { _id: booking.renterId },
          { projection: { firstName: 1, lastName: 1, email: 1 } },
        );

        const notifMap = {
          accept: {
            type: 'booking_confirmed',
            title: 'Booking Confirmed',
            msg: `Your booking request for "${house?.title}" has been approved`,
            emoji: 'OK',
            priority: 'high',
          },
          reject: {
            type: 'booking_rejected',
            title: 'Booking Declined',
            msg: `Your booking request for "${house?.title}" was declined${reason ? `: ${reason}` : ''}`,
            emoji: 'NO',
            priority: 'medium',
          },
          cancel: {
            type: 'booking_cancelled',
            title: 'Booking Cancelled',
            msg: `Your booking for "${house?.title}" has been cancelled${reason ? `: ${reason}` : ''}`,
            emoji: 'WARN',
            priority: 'low',
          },
          complete: {
            type: 'booking_completed',
            title: 'Booking Completed',
            msg: `Your stay at "${house?.title}" has been completed`,
            emoji: 'DONE',
            priority: 'low',
          },
        };
        const n = notifMap[action];

        const sharedData = {
          bookingId: booking._id,
          bookingCode: booking.bookingCode,
          houseId: booking.houseId,
          action,
          reason,
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          totalAmount: booking.totalAmount,
          propertyTitle: house?.title,
          isDailyRental: booking.isDailyRental,
          nights: booking.totalNights,
          duration: booking.duration,
          durationType: booking.durationType,
        };

        await notificationsCollection.insertOne({
          userId: booking.renterId,
          type: n.type,
          title: n.title,
          message: n.msg,
          data: {
            ...sharedData,
            ownerId: ownerId.toString(),
            ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
            propertyAddress: house?.location?.address,
          },
          isRead: false,
          priority: n.priority,
          category: 'booking',
          senderId: ownerId,
          createdAt: new Date(),
          actionUrl: `/renter/bookings/${booking._id}`,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        const renterSession = await sessionsCollection.findOne({ userId: booking.renterId, isActive: true });
        if (renterSession) {
          await sendWebSocketNotification(renterSession.connectionId, {
            _id: new ObjectId().toString(),
            type: n.type,
            title: n.title,
            message: n.msg,
            data: {
              ...sharedData,
              ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
              amount: booking.totalAmount,
              checkInDate: booking.checkInDate.toISOString().split('T')[0],
              checkOutDate: booking.checkOutDate.toISOString().split('T')[0],
            },
            isRead: false,
            priority: n.priority,
            category: 'booking',
            createdAt: new Date().toISOString(),
            actionUrl: `/renter/bookings/${booking._id}`,
          });
        }

        await notificationsCollection.insertOne({
          userId: ownerId,
          type: `booking_${action}ed`,
          title: `${n.emoji} Booking ${action.charAt(0).toUpperCase() + action.slice(1)}ed`,
          message: `You ${action}ed the booking request from ${renter?.firstName} ${renter?.lastName}`,
          data: {
            ...sharedData,
            renterId: booking.renterId.toString(),
            renterName: renter ? `${renter.firstName} ${renter.lastName}` : 'Renter',
          },
          isRead: false,
          priority: 'medium',
          category: 'booking',
          senderId: booking.renterId,
          createdAt: new Date(),
          actionUrl: `/owner/bookings/${booking._id}`,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        if (action === 'accept') {
          const otherPending = await bookingsCollection
            .find({
              _id: { $ne: new ObjectId(bookingId) },
              houseId: booking.houseId,
              status: 'pending',
              $or: [{ checkInDate: { $lte: booking.checkOutDate }, checkOutDate: { $gte: booking.checkInDate } }],
            })
            .toArray();

          if (otherPending.length > 0) {
            await bookingsCollection.updateMany(
              { _id: { $in: otherPending.map((b) => b._id) } },
              {
                $set: {
                  status: 'rejected',
                  rejectedAt: new Date(),
                  rejectionReason: 'Dates no longer available (booking accepted for another renter)',
                  updatedAt: new Date(),
                },
              },
            );

            for (const pb of otherPending) {
              await notificationsCollection.insertOne({
                userId: pb.renterId,
                type: 'booking_auto_rejected',
                title: 'Booking Unavailable',
                message: `The dates you requested for "${house?.title}" are no longer available`,
                data: {
                  bookingId: pb._id,
                  bookingCode: pb.bookingCode,
                  houseId: booking.houseId,
                  originalCheckInDate: pb.checkInDate,
                  originalCheckOutDate: pb.checkOutDate,
                  propertyTitle: house?.title,
                  reason: "Another renter's booking was accepted for these dates",
                },
                isRead: false,
                priority: 'medium',
                category: 'booking',
                senderId: ownerId,
                createdAt: new Date(),
                actionUrl: `/renter/bookings/${pb._id}`,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              });

              const otherSession = await sessionsCollection.findOne({ userId: pb.renterId, isActive: true });
              if (otherSession) {
                await sendWebSocketNotification(otherSession.connectionId, {
                  _id: new ObjectId().toString(),
                  type: 'booking_auto_rejected',
                  title: 'Booking Unavailable',
                  message: 'The dates you requested are no longer available',
                  data: {
                    bookingId: pb._id.toString(),
                    propertyTitle: house?.title,
                    reason: "Another renter's booking was accepted for these dates",
                  },
                  isRead: false,
                  priority: 'medium',
                  category: 'booking',
                  createdAt: new Date().toISOString(),
                  actionUrl: `/renter/bookings/${pb._id}`,
                });
              }
            }

            console.log(`Auto-rejected ${otherPending.length} conflicting bookings`);
          }
        }
      } catch (notificationError) {
        console.error('Booking notification failed:', notificationError);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message,
          booking: result,
          action,
          newStatus,
          notification: {
            sent: true,
            message: `Renter has been notified about the ${action} action`,
          },
        }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Owner bookings error:', error);
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
      body: JSON.stringify({ error: 'Internal server error', details: error.message }),
    };
  }
};