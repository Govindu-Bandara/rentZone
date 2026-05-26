import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

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
  const client = await MongoClient.connect(connectionString, { serverSelectionTimeoutMS: 10000 });
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('No token provided');
  const token = authHeader.substring(7);
  return jwt.verify(token, process.env.JWT_SECRET);
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);

    if (decoded.role !== 'owner' && decoded.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only owners and admins can access dashboard stats' }) };
    }

    const db = await connectToDatabase();
    const housesCollection    = db.collection('houses');
    const bookingsCollection  = db.collection('bookings');
    const usersCollection     = db.collection('users');
    const messagesCollection  = db.collection('messages');

    const ownerId = new ObjectId(decoded.userId);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const totalProperties      = await housesCollection.countDocuments({ ownerId, status: 'approved' });
    const activeProperties     = await housesCollection.countDocuments({ ownerId, status: 'approved', isActive: true });
    const verifiedProperties   = await housesCollection.countDocuments({ ownerId, isVerified: true });
    const pendingVerification  = await housesCollection.countDocuments({ ownerId, verificationStatus: 'pending' });
    const rejectedProperties   = await housesCollection.countDocuments({ ownerId, verificationStatus: 'rejected' });
    const featuredProperties   = await housesCollection.countDocuments({ ownerId, isFeatured: true });

    const propertiesByVerification = await housesCollection.aggregate([
      { $match: { ownerId, status: 'approved' } },
      { $group: { _id: '$verificationStatus', count: { $sum: 1 }, totalViews: { $sum: '$views' }, totalFavorites: { $sum: '$favorites' }, avgRating: { $avg: '$rating' } } },
    ]).toArray();

    const recentProperties = await housesCollection
      .find({ ownerId, createdAt: { $gte: sevenDaysAgo } })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();

    const recentRevenue = await bookingsCollection.aggregate([
      { $match: { ownerId, status: { $in: ['confirmed', 'completed'] }, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
    ]).toArray();

    const totalRevenue       = recentRevenue[0]?.total ?? 0;
    const recentBookingCount = recentRevenue[0]?.count ?? 0;

    const pendingBookingsRaw = await bookingsCollection
      .find({ ownerId, status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    const pendingBookings = await Promise.all(
      pendingBookingsRaw.map(async (booking) => {
        const house = await housesCollection.findOne(
          { _id: booking.houseId },
          { projection: { title: 1, propertyType: 1 } }
        );
        return { ...booking, propertyType: house?.propertyType || 'Property', propertyTitle: house?.title || 'Property' };
      })
    );

    const bookingStats = await bookingsCollection.aggregate([
      { $match: { ownerId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray();

    const totalBookings      = bookingStats.reduce((sum, s) => sum + s.count, 0);
    const confirmedBookings  = bookingStats.find((s) => s._id === 'confirmed')?.count || 0;
    const bookingSuccessRate = totalBookings > 0 ? (confirmedBookings / totalBookings) * 100 : 0;

    const today = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(today.getDate() + 30);

    const upcomingBookings = await bookingsCollection
      .find({ ownerId, status: { $in: ['confirmed', 'active'] }, checkInDate: { $gte: today, $lte: nextMonth } })
      .sort({ checkInDate: 1 })
      .limit(5)
      .toArray();

    const topProperties = await housesCollection
      .find({ ownerId, status: 'approved' })
      .sort({ views: -1, favorites: -1 })
      .limit(3)
      .toArray();

    const performanceStats = await housesCollection.aggregate([
      { $match: { ownerId, status: 'approved' } },
      { $group: { _id: null, totalViews: { $sum: '$views' }, totalFavorites: { $sum: '$favorites' }, avgRating: { $avg: '$rating' }, totalReviews: { $sum: '$reviewCount' } } },
    ]).toArray();

    const recentViews = await housesCollection.aggregate([
      { $match: { ownerId } },
      { $unwind: { path: '$viewedBy', preserveNullAndEmptyArrays: true } },
      { $match: { 'viewedBy.viewedAt': { $gte: sevenDaysAgo } } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]).toArray();

    const unreadMessages = await messagesCollection.countDocuments({ receiverId: ownerId, isRead: false });

    const recentMessages = await messagesCollection
      .find({ $or: [{ senderId: ownerId }, { receiverId: ownerId }] })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    const ownerProfile = await usersCollection.findOne(
      { _id: ownerId },
      { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, profileImage: 1, createdAt: 1, rating: 1, responseRate: 1, responseTime: 1, isVerified: 1, totalProperties: 1, bio: 1 } }
    );

    const totalFavoritesReceived = await housesCollection.aggregate([
      { $match: { ownerId } },
      { $group: { _id: null, total: { $sum: '$favorites' } } },
    ]).toArray();

    const verificationStats = propertiesByVerification.reduce((acc, stat) => {
      acc[stat._id] = { count: stat.count, totalViews: stat.totalViews || 0, totalFavorites: stat.totalFavorites || 0, avgRating: stat.avgRating || 0 };
      return acc;
    }, {});

    // ── Build pendingRequests with correct duration ──────────────────────────
    const mappedPendingRequests = pendingBookings.map((booking) => {
      const isDailyRental = booking.isDailyRental;
      const nights = isDailyRental ? (booking.totalNights || 0) : null;

      let durationDisplay;
      if (isDailyRental) {
        durationDisplay = `${nights} night${nights !== 1 ? 's' : ''}`;
      } else if (booking.duration && booking.durationType) {
        durationDisplay = `${booking.duration} ${booking.durationType}`;
      } else {
        durationDisplay = 'N/A';
      }

      return {
        id: booking._id,
        propertyName: booking.propertyTitle,
        propertyType: booking.propertyType,
        renterName: booking.renterName,
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        totalAmount: booking.totalAmount,
        monthlyRent: booking.monthlyRent || null,
        status: booking.status,
        createdAt: booking.createdAt,
        isDailyRental,
        nights,
        duration: booking.duration || null,
        durationType: booking.durationType || null,
        durationDisplay,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Owner dashboard stats retrieved successfully',
        dashboard: {
          greeting: `Hello, ${ownerProfile?.firstName || 'Owner'}!`,
          summary: {
            totalProperties,
            activeProperties,
            recentBookings: recentBookingCount,
            totalRevenue,
            unreadMessages,
            verificationProgress: totalProperties > 0 ? ((verifiedProperties / totalProperties) * 100).toFixed(1) : 0,
          },
          user: {
            ...ownerProfile,
            memberSince: ownerProfile?.createdAt,
            responseRate: ownerProfile?.responseRate || 0,
            responseTime: ownerProfile?.responseTime || '24 hours',
            totalFavoritesReceived: totalFavoritesReceived[0]?.total || 0,
          },
          properties: {
            overview: { total: totalProperties, active: activeProperties, featured: featuredProperties, recent: recentProperties.length },
            verification: {
              verified: verifiedProperties, pending: pendingVerification, rejected: rejectedProperties,
              rate: totalProperties > 0 ? ((verifiedProperties / totalProperties) * 100).toFixed(1) : 0,
              details: verificationStats,
            },
            performance: {
              totalViews: performanceStats[0]?.totalViews || 0,
              totalFavorites: performanceStats[0]?.totalFavorites || 0,
              avgRating: performanceStats[0]?.avgRating || 0,
              totalReviews: performanceStats[0]?.totalReviews || 0,
              recentViews: recentViews[0]?.count || 0,
            },
            recent: recentProperties.map((p) => ({
              id: p._id, title: p.title, city: p.location?.city, price: p.price?.amount,
              isVerified: p.isVerified, verificationStatus: p.verificationStatus,
              images: p.images?.[0], views: p.views || 0, createdAt: p.createdAt,
            })),
            topPerforming: topProperties.map((p) => ({
              id: p._id, title: p.title, views: p.views || 0, favorites: p.favorites || 0,
              isVerified: p.isVerified, verificationStatus: p.verificationStatus,
              rating: p.rating || 0, city: p.location?.city,
            })),
          },
          bookings: {
            overview: { total: totalBookings, recent: recentBookingCount, successRate: bookingSuccessRate.toFixed(1), revenue: totalRevenue },
            pendingRequests: mappedPendingRequests,
            upcoming: upcomingBookings.map((b) => ({
              id: b._id, propertyName: b.propertyName || 'Property', renterName: b.renterName,
              checkInDate: b.checkInDate, checkOutDate: b.checkOutDate,
              totalAmount: b.totalAmount, status: b.status, guests: b.guests || 1,
            })),
            statusBreakdown: bookingStats.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
          },
          messages: {
            unread: unreadMessages,
            recent: recentMessages.map((msg) => ({
              id: msg._id, subject: msg.subject || 'No Subject',
              preview: msg.content?.substring(0, 50) + '...', sender: msg.senderName,
              isRead: msg.isRead, createdAt: msg.createdAt,
            })),
          },
          verification: {
            summary: {
              pendingCount: pendingVerification, verifiedCount: verifiedProperties,
              rejectedCount: rejectedProperties,
              progress: totalProperties > 0 ? ((verifiedProperties / totalProperties) * 100).toFixed(1) : 0,
            },
            insights: {
              averageVerificationTime: '2-3 days',
              commonRejectionReasons: pendingVerification > 0 ? ['Missing property photos', 'Incomplete description', 'Unverified contact information'] : [],
              tips: ['Add clear photos of all rooms', 'Write detailed property description', 'Verify your contact information'],
            },
            actionItems: pendingVerification > 0
              ? [`${pendingVerification} properties awaiting admin verification`, 'Ensure all property details are complete', 'Respond promptly to admin verification requests']
              : ['All properties are verified!', 'Consider adding more properties', 'Keep property information updated'],
          },
        },
        meta: { timePeriod: 'Last 30 days', timestamp: new Date().toISOString(), ownerId: decoded.userId, reportGenerated: new Date().toISOString(), dataFreshness: 'real-time' },
      }),
    };
  } catch (error) {
    console.error('Dashboard stats error:', error);
    if (error.name === 'JsonWebTokenError' || error.message === 'No token provided') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized - Invalid or missing token' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: error.message }) };
  }
};