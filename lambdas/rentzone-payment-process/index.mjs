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

async function logSystemActivity(db, level, category, message, userEmail, ipAddress, details) {
  try {
    if (!db) return;
    const systemLogsCollection = db.collection('system_logs');

    await systemLogsCollection.insertOne({
      level,
      category,
      message,
      ipAddress: ipAddress || 'INTERNAL',
      userEmail: userEmail || null,
      details: details || null,
      timestamp: new Date(),
      source: 'payment_processing',
      severity: level === 'ERROR' ? 'high' : (level === 'WARNING' ? 'medium' : 'low'),
    });
  } catch (error) {
    console.error('Failed to log system activity:', error);
  }
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
    console.log(`WebSocket notification sent to connection: ${connectionId}`);
    return true;
  } catch (error) {
    console.error('Failed to send WebSocket notification:', error.message);
    return false;
  }
}

class DummyPaymentGateway {
  static async processPayment(paymentData) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const shouldFail = Math.random() < 0.1;
    if (shouldFail) {
      throw new Error('Payment failed: Insufficient funds or network error');
    }

    const transactionId = `TXN${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const authCode = `AUTH${Math.floor(Math.random() * 1000000)}`;

    return {
      success: true,
      transactionId,
      authCode,
      timestamp: new Date().toISOString(),
      amount: paymentData.amount,
      currency: paymentData.currency || 'LKR',
      paymentMethod: paymentData.paymentMethod || 'card',
    };
  }

  static validateCard(cardData) {
    const luhnCheck = (num) => {
      let arr = (num + '')
        .split('')
        .reverse()
        .map((x) => parseInt(x, 10));
      let lastDigit = arr.splice(0, 1)[0];
      let sum = arr.reduce((acc, val, i) => (i % 2 !== 0 ? acc + val : acc + ((val * 2) % 9) || 9), 0);
      sum += lastDigit;
      return sum % 10 === 0;
    };

    const currentYear = new Date().getFullYear() % 100;
    const currentMonth = new Date().getMonth() + 1;

    const [expMonth, expYear] = cardData.expiry.split('/').map((x) => parseInt(x.trim(), 10));

    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      throw new Error('Card has expired');
    }

    if (!luhnCheck(cardData.number.replace(/\s/g, ''))) {
      throw new Error('Invalid card number');
    }

    if (cardData.cvc.length < 3) {
      throw new Error('Invalid CVC');
    }

    return true;
  }
}

function getPayableNow(booking, house) {
  const fullTotal = Number(booking.totalAmount || 0);
  const isDailyRental = Boolean(booking.isDailyRental);
  const monthlyRent = Number(booking.monthlyRent || house?.price?.amount || 0);
  const securityDeposit = Number(booking.securityDeposit || house?.price?.securityDeposit || 0);

  if (isDailyRental) {
    return {
      isDailyRental,
      monthlyRent,
      securityDeposit,
      fullTotal,
      payableNow: fullTotal,
      rentComponent: Math.max(0, fullTotal - securityDeposit),
    };
  }

  const payableNow = monthlyRent + securityDeposit;
  return {
    isDailyRental,
    monthlyRent,
    securityDeposit,
    fullTotal,
    payableNow,
    rentComponent: monthlyRent,
  };
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let db = null;
  let decoded = null;

  try {
    decoded = verifyToken(event.headers.Authorization || event.headers.authorization);

    if (decoded.role !== 'renter') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only renters can make payments' }),
      };
    }

    db = await connectToDatabase();
    const bookingsCollection = db.collection('bookings');
    const paymentsCollection = db.collection('payments');
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const notificationsCollection = db.collection('notifications');
    const sessionsCollection = db.collection('websocket_sessions');

    const renterId = new ObjectId(decoded.userId);

    if (event.httpMethod === 'GET') {
      const bookingId = event.pathParameters?.id;

      if (!bookingId || !ObjectId.isValid(bookingId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid booking ID is required' }),
        };
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
        renterId,
      });

      if (!booking) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Booking not found' }),
        };
      }

      const house = await housesCollection.findOne(
        { _id: booking.houseId },
        { projection: { title: 1, images: 1, 'location.address': 1, price: 1 } },
      );

      const payments = await paymentsCollection
        .find({ bookingId: new ObjectId(bookingId) })
        .sort({ createdAt: -1 })
        .toArray();

      const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const pricing = getPayableNow(booking, house);
      const dueAmount = Math.max(0, pricing.payableNow - paidAmount);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Payment details retrieved',
          booking: {
            id: booking._id,
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            totalAmount: booking.totalAmount,
            payableNow: pricing.payableNow,
          },
          property: house
            ? {
                title: house.title,
                mainImage: house.images?.[0],
                address: house.location?.address,
                monthlyRent: pricing.monthlyRent,
              }
            : null,
          paymentBreakdown: {
            rentAmount: pricing.rentComponent,
            securityDeposit: pricing.securityDeposit,
            totalAmount: pricing.payableNow,
            paidAmount,
            dueAmount,
          },
          paymentHistory: payments.map((p) => ({
            id: p._id,
            amount: p.amount,
            status: p.status,
            method: p.paymentMethod,
            transactionId: p.transactionId,
            createdAt: p.createdAt,
          })),
        }),
      };
    }

    if (event.httpMethod === 'POST') {
      const bookingId = event.pathParameters?.id;
      const body = JSON.parse(event.body || '{}');

      const { paymentMethod, paymentType, cardDetails, amount } = body;

      if (!bookingId || !ObjectId.isValid(bookingId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Valid booking ID is required' }),
        };
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
        renterId,
      });

      if (!booking) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Booking not found' }),
        };
      }

      if (booking.status !== 'confirmed') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Booking must be confirmed by owner before payment',
            currentStatus: booking.status,
          }),
        };
      }

      const house = await housesCollection.findOne(
        { _id: booking.houseId },
        { projection: { title: 1, price: 1 } },
      );

      const owner = await usersCollection.findOne(
        { _id: booking.ownerId },
        { projection: { firstName: 1, lastName: 1, email: 1 } },
      );

      const renter = await usersCollection.findOne(
        { _id: renterId },
        { projection: { firstName: 1, lastName: 1, email: 1 } },
      );

      const existingPayments = await paymentsCollection
        .find({
          bookingId: new ObjectId(bookingId),
          status: 'completed',
        })
        .toArray();

      const paidAmount = existingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const pricing = getPayableNow(booking, house);
      const remainingNow = Math.max(0, pricing.payableNow - paidAmount);

      const requestedAmount = Number(amount);
      const paymentAmount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : remainingNow;

      if (paymentAmount <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid payment amount' }),
        };
      }

      if (Math.abs(paymentAmount - remainingNow) > 0.01) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Payment amount must match required payable amount',
            requiredAmount: remainingNow,
            paymentAmount,
          }),
        };
      }

      try {
        if (paymentMethod === 'card' && cardDetails) {
          DummyPaymentGateway.validateCard(cardDetails);
        }

        const paymentResult = await DummyPaymentGateway.processPayment({
          amount: paymentAmount,
          currency: 'LKR',
          paymentMethod,
          bookingId,
          renterId: decoded.userId,
        });

        const paymentRecord = {
          bookingId: new ObjectId(bookingId),
          houseId: booking.houseId,
          renterId,
          ownerId: booking.ownerId,
          amount: paymentAmount,
          paymentMethod,
          paymentType: paymentType || (pricing.isDailyRental ? 'full' : 'first_month_deposit'),
          status: 'completed',
          transactionId: paymentResult.transactionId,
          authCode: paymentResult.authCode,
          metadata: {
            cardLast4: cardDetails?.number?.slice(-4) || null,
            paymentGateway: 'DummyPayment',
            processedAt: paymentResult.timestamp,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const paymentResultDb = await paymentsCollection.insertOne(paymentRecord);

        const newPaidAmount = paidAmount + paymentAmount;
        const isNowSettled = Math.abs(newPaidAmount - pricing.payableNow) < 0.01;

        const updateFields = { updatedAt: new Date() };
        if (isNowSettled) {
          updateFields.paymentStatus = 'paid';
          updateFields.paidAt = new Date();
        } else {
          updateFields.paymentStatus = 'pending';
        }

        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: updateFields },
        );

        const updatedBooking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
        });

        const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
        await logSystemActivity(
          db,
          'INFO',
          'Payment',
          `Payment successful: LKR ${paymentAmount.toLocaleString()} for booking ${booking.bookingCode}`,
          decoded.email,
          ipAddress,
          {
            paymentId: paymentResultDb.insertedId.toString(),
            transactionId: paymentResult.transactionId,
            bookingId,
            bookingCode: booking.bookingCode,
            amount: paymentAmount,
            paymentMethod,
            renterId: decoded.userId,
            renterEmail: decoded.email,
            ownerId: booking.ownerId.toString(),
            propertyTitle: house?.title,
            isSettledForSystemPayment: isNowSettled,
            payableNow: pricing.payableNow,
          },
        );

        try {
          const renterNotification = {
            userId: renterId,
            type: 'payment_successful',
            title: 'Payment Successful',
            message: `Your payment of LKR ${paymentAmount.toLocaleString()} for "${house?.title || 'the property'}" was processed successfully`,
            data: {
              bookingId: booking._id,
              bookingCode: booking.bookingCode,
              paymentId: paymentResultDb.insertedId,
              amount: paymentAmount,
              transactionId: paymentResult.transactionId,
              propertyTitle: house?.title,
              ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
              payableNow: pricing.payableNow,
              isSettledForSystemPayment: isNowSettled,
            },
            isRead: false,
            priority: 'medium',
            category: 'payment',
            senderId: booking.ownerId,
            createdAt: new Date(),
            actionUrl: `/renter/bookings/${booking._id}/payment`,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          };

          await notificationsCollection.insertOne(renterNotification);

          const renterSession = await sessionsCollection.findOne({
            userId: renterId,
            isActive: true,
          });

          if (renterSession) {
            await sendWebSocketNotification(renterSession.connectionId, {
              _id: new ObjectId().toString(),
              type: 'payment_successful',
              title: 'Payment Successful',
              message: `Payment of LKR ${paymentAmount.toLocaleString()} processed`,
              data: {
                bookingId: booking._id.toString(),
                bookingCode: booking.bookingCode,
                amount: paymentAmount,
                transactionId: paymentResult.transactionId,
                propertyTitle: house?.title,
                payableNow: pricing.payableNow,
                isSettledForSystemPayment: isNowSettled,
              },
              isRead: false,
              priority: 'medium',
              category: 'payment',
              createdAt: new Date().toISOString(),
              actionUrl: `/renter/bookings/${booking._id}/payment`,
            });
          }

          const ownerNotification = {
            userId: booking.ownerId,
            type: 'payment_received',
            title: 'Payment Received',
            message: `${renter.firstName} ${renter.lastName} made a payment of LKR ${paymentAmount.toLocaleString()} for booking ${booking.bookingCode}`,
            data: {
              bookingId: booking._id,
              bookingCode: booking.bookingCode,
              renterId: renterId.toString(),
              renterName: `${renter.firstName} ${renter.lastName}`,
              renterEmail: renter.email,
              paymentId: paymentResultDb.insertedId,
              amount: paymentAmount,
              transactionId: paymentResult.transactionId,
              paymentMethod,
              propertyTitle: house?.title,
              isSettledForSystemPayment: isNowSettled,
            },
            isRead: false,
            priority: 'high',
            category: 'payment',
            senderId: renterId,
            createdAt: new Date(),
            actionUrl: `/owner/bookings/${booking._id}/payment`,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          };

          await notificationsCollection.insertOne(ownerNotification);

          const ownerSession = await sessionsCollection.findOne({
            userId: booking.ownerId,
            isActive: true,
          });

          if (ownerSession) {
            await sendWebSocketNotification(ownerSession.connectionId, {
              _id: new ObjectId().toString(),
              type: 'payment_received',
              title: 'Payment Received',
              message: `${renter.firstName} made a payment of LKR ${paymentAmount.toLocaleString()}`,
              data: {
                bookingId: booking._id.toString(),
                bookingCode: booking.bookingCode,
                renterName: `${renter.firstName} ${renter.lastName}`,
                amount: paymentAmount,
                transactionId: paymentResult.transactionId,
                isSettledForSystemPayment: isNowSettled,
              },
              isRead: false,
              priority: 'high',
              category: 'payment',
              createdAt: new Date().toISOString(),
              actionUrl: `/owner/bookings/${booking._id}/payment`,
            });
          }

          if (isNowSettled) {
            await notificationsCollection.insertOne({
              userId: booking.ownerId,
              type: 'payment_completed',
              title: 'Booking Payment Completed',
              message: `Booking ${booking.bookingCode} payment has been completed by ${renter.firstName}`,
              data: {
                bookingId: booking._id,
                bookingCode: booking.bookingCode,
                renterId: renterId.toString(),
                renterName: `${renter.firstName} ${renter.lastName}`,
                totalAmount: pricing.payableNow,
                propertyTitle: house?.title,
                checkInDate: booking.checkInDate,
              },
              isRead: false,
              priority: 'high',
              category: 'payment',
              senderId: renterId,
              createdAt: new Date(),
              actionUrl: `/owner/bookings/${booking._id}`,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });

            await notificationsCollection.insertOne({
              userId: renterId,
              type: 'booking_payment_completed',
              title: 'Booking Payment Completed',
              message: `Your booking ${booking.bookingCode} payment is completed`,
              data: {
                bookingId: booking._id,
                bookingCode: booking.bookingCode,
                totalAmount: pricing.payableNow,
                propertyTitle: house?.title,
                checkInDate: booking.checkInDate,
                ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Property Owner',
              },
              isRead: false,
              priority: 'medium',
              category: 'payment',
              senderId: booking.ownerId,
              createdAt: new Date(),
              actionUrl: `/renter/bookings/${booking._id}`,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });
          }

          console.log('Payment notifications created successfully');
        } catch (notificationError) {
          console.error('Payment notification failed:', notificationError);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: 'Payment processed successfully',
            payment: {
              id: paymentResultDb.insertedId,
              amount: paymentAmount,
              transactionId: paymentResult.transactionId,
              authCode: paymentResult.authCode,
              status: 'completed',
              paidAt: new Date(),
            },
            booking: {
              id: updatedBooking._id,
              paymentStatus: updatedBooking.paymentStatus,
              totalAmount: updatedBooking.totalAmount,
              payableNow: pricing.payableNow,
              paidAmount: newPaidAmount,
              dueAmount: Math.max(0, pricing.payableNow - newPaidAmount),
              isSettledForSystemPayment: isNowSettled,
            },
            notification: {
              sent: true,
              ownerNotified: true,
              message: 'Both renter and owner have been notified',
            },
            receipt: {
              receiptNumber: `RCPT${Date.now()}${Math.floor(Math.random() * 1000)}`,
              date: new Date().toISOString().split('T')[0],
              items: pricing.isDailyRental
                ? [
                    {
                      description: `Rent for ${house?.title || 'Property'}`,
                      amount: pricing.rentComponent,
                    },
                    {
                      description: 'Security Deposit',
                      amount: pricing.securityDeposit,
                    },
                  ]
                : [
                    {
                      description: '1st Month Rent',
                      amount: pricing.monthlyRent,
                    },
                    {
                      description: 'Security Deposit',
                      amount: pricing.securityDeposit,
                    },
                  ],
              total: pricing.payableNow,
            },
          }),
        };
      } catch (paymentError) {
        const failedPayment = {
          bookingId: new ObjectId(bookingId),
          renterId,
          amount: paymentAmount,
          paymentMethod,
          status: 'failed',
          error: paymentError.message,
          metadata: {
            cardLast4: cardDetails?.number?.slice(-4) || null,
            paymentGateway: 'DummyPayment',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await paymentsCollection.insertOne(failedPayment);

        const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
        await logSystemActivity(
          db,
          'ERROR',
          'Payment',
          `Payment failed: LKR ${paymentAmount.toLocaleString()} for booking ${booking.bookingCode}: ${paymentError.message}`,
          decoded.email,
          ipAddress,
          {
            bookingId,
            bookingCode: booking.bookingCode,
            amount: paymentAmount,
            paymentMethod,
            renterId: decoded.userId,
            renterEmail: decoded.email,
            error: paymentError.message,
          },
        );

        try {
          await notificationsCollection.insertOne({
            userId: renterId,
            type: 'payment_failed',
            title: 'Payment Failed',
            message: `Your payment of LKR ${paymentAmount.toLocaleString()} failed: ${paymentError.message}`,
            data: {
              bookingId: booking._id,
              bookingCode: booking.bookingCode,
              amount: paymentAmount,
              error: paymentError.message,
              propertyTitle: house?.title,
            },
            isRead: false,
            priority: 'high',
            category: 'payment',
            senderId: booking.ownerId,
            createdAt: new Date(),
            actionUrl: `/renter/bookings/${booking._id}/payment`,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });
        } catch (notificationError) {
          console.error('Failed to create payment failure notification:', notificationError);
        }

        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Payment processing failed',
            details: paymentError.message,
            paymentMethod,
            amount: paymentAmount,
          }),
        };
      }
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Payment process error:', error);

    const ipAddress = event.requestContext?.identity?.sourceIp || 'unknown';
    const bookingId = event.pathParameters?.id || 'unknown';

    await logSystemActivity(
      db,
      'ERROR',
      'Payment',
      `Payment processing error: ${error.message}`,
      decoded?.email || null,
      ipAddress,
      {
        error: error.message,
        bookingId,
        renterEmail: decoded?.email,
      },
    );

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