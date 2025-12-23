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
  const client = await MongoClient.connect(connectionString, {
    serverSelectionTimeoutMS: 10000
  });
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

function verifyTokenIfPresent(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  try {
    const token = authHeader.substring(7);
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.log('Token verification failed:', error.message);
    return null;
  }
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const houseId = event.pathParameters?.id;
    
    if (!houseId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'House ID is required' })
      };
    }
    
    if (!ObjectId.isValid(houseId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid house ID format' })
      };
    }
    
    const db = await connectToDatabase();
    const housesCollection = db.collection('houses');
    const usersCollection = db.collection('users');
    const favoritesCollection = db.collection('favorites');
    const bookingsCollection = db.collection('bookings');
    const reviewsCollection = db.collection('reviews');
    
    // Check authentication
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const decoded = verifyTokenIfPresent(authHeader);
    
    // Get house details and increment view count
    const house = await housesCollection.findOneAndUpdate(
      { _id: new ObjectId(houseId) },
      { 
        $inc: { views: 1 },
        $push: {
          viewedBy: {
            userId: decoded ? new ObjectId(decoded.userId) : null,
            viewedAt: new Date(),
            userType: decoded?.role || 'guest'
          }
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!house) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'House not found' })
      };
    }
    
    // Check if house is active and approved (for non-owners/admins)
    if (!decoded || (decoded.role !== 'owner' && decoded.role !== 'admin')) {
      if (house.status !== 'approved' || !house.isActive || !house.availability?.isAvailable) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Property not available' })
        };
      }
    }
    
    // Get owner details (without password)
    const owner = await usersCollection.findOne(
      { _id: house.ownerId },
      { projection: { password: 0, __v: 0 } }
    );
    
    // Prepare owner response (safe fields only) - FROM FIGMA DESIGN
    const ownerResponse = owner ? {
      _id: owner._id,
      name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
      email: house.contactInfo?.showPhone ? owner.email : null,
      phone: house.contactInfo?.showPhone ? owner.phone : null,
      profileImage: owner.profileImage,
      isVerified: owner.isVerified,
      joinedDate: owner.createdAt,
      rating: owner.rating || 0,
      totalProperties: owner.totalProperties || 0,
      responseRate: owner.responseRate || 0,
      responseTime: owner.responseTime || 'within 24 hours'
    } : null;
    
    // Get similar properties (same property type and city)
    // Renters see ALL similar properties (verified and unverified)
    const similarQuery = {
      _id: { $ne: new ObjectId(houseId) },
      'location.city': house.location?.city,
      propertyType: house.propertyType,
      status: 'approved',
      isActive: true,
      'availability.isAvailable': true
    };
    
    const similarHouses = await housesCollection.find(similarQuery)
      .sort({ rating: -1, views: -1 })
      .limit(4)
      .toArray();
    
    // Get reviews for this property
    const reviews = await reviewsCollection.find({
      houseId: new ObjectId(houseId),
      isApproved: true
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
    
    // Calculate review stats
    const reviewStats = {
      total: reviews.length,
      averageRating: house.rating || 0,
      breakdown: {
        5: reviews.filter(r => r.rating === 5).length,
        4: reviews.filter(r => r.rating === 4).length,
        3: reviews.filter(r => r.rating === 3).length,
        2: reviews.filter(r => r.rating === 2).length,
        1: reviews.filter(r => r.rating === 1).length
      }
    };
    
    // Get availability calendar (next 90 days)
    const today = new Date();
    const ninetyDaysLater = new Date();
    ninetyDaysLater.setDate(today.getDate() + 90);
    
    const bookedDates = await bookingsCollection.find({
      houseId: new ObjectId(houseId),
      status: { $in: ['confirmed', 'active'] },
      checkInDate: { $lte: ninetyDaysLater },
      checkOutDate: { $gte: today }
    }, {
      projection: { checkInDate: 1, checkOutDate: 1 }
    }).toArray();
    
    // Prepare response object - ALIGNED WITH FIGMA DESIGN
    const responseHouse = {
      _id: house._id,
      title: house.title,
      description: house.description,
      propertyType: house.propertyType,
      rentalType: house.rentalType,
      
      // VERIFICATION: Only show badge if verified, otherwise null
      isVerified: house.isVerified || false,
      verificationBadge: house.isVerified ? {
        type: 'verified',
        label: 'Verified',
        color: 'green',
        icon: 'shield-check',
        tooltip: 'This property has been verified by Rent Zone admin'
      } : null,
      adminBadges: house.isVerified ? (house.badges?.map(badge => ({
        label: badge === 'premium' ? 'Premium' : badge,
        color: badge === 'premium' ? 'purple' : 'blue',
        icon: badge === 'premium' ? 'star' : 'badge'
      })) || []) : [],
      
      price: {
        amount: house.price.amount,
        currency: house.price.currency,
        period: house.price.period,
        securityDeposit: house.price.securityDeposit,
        cleaningFee: house.price.cleaningFee,
        weeklyDiscount: house.price.weeklyDiscount,
        monthlyDiscount: house.price.monthlyDiscount,
        minMonthsForDiscount: house.price.minMonthsForDiscount
      },
      location: {
        address: house.location?.address,
        city: house.location?.city,
        district: house.location?.district,
        province: house.location?.province,
        country: house.location?.country,
        zipCode: house.location?.zipCode,
        coordinates: house.location?.coordinates,
        landmark: house.location?.landmark
      },
      propertyDetails: {
        bedrooms: house.propertyDetails?.bedrooms || 0,
        bathrooms: house.propertyDetails?.bathrooms || 0,
        beds: house.propertyDetails?.beds || 0,
        squareFeet: house.propertyDetails?.squareFeet,
        furnishingStatus: house.propertyDetails?.furnishingStatus,
        floor: house.propertyDetails?.floor,
        totalFloors: house.propertyDetails?.totalFloors,
        yearBuilt: house.propertyDetails?.yearBuilt,
        parkingSpaces: house.propertyDetails?.parkingSpaces || 0
      },
      amenities: house.amenities || [],
      rules: house.rules || [],
      images: house.images || [],
      tags: house.tags || [],
      availability: house.availability || {
        isAvailable: true,
        availableFrom: new Date(),
        minStay: 1,
        maxStay: null
      },
      isFeatured: house.isFeatured || false,
      views: house.views || 0,
      favorites: house.favorites || 0,
      rating: house.rating || 0,
      reviewCount: house.reviewCount || 0,
      contactInfo: house.contactInfo || {}
    };
    
    // Add user-specific data if authenticated
    let userSpecificData = {};
    if (decoded) {
      // Check if property is in user's favorites
      if (decoded.role === 'renter') {
        const isFavorite = await favoritesCollection.findOne({
          userId: new ObjectId(decoded.userId),
          houseId: new ObjectId(houseId)
        });
        
        userSpecificData.isFavorite = !!isFavorite;
        userSpecificData.favoriteId = isFavorite?._id;
      }
      
      // Check if user has any bookings for this property
      const userBooking = await bookingsCollection.findOne({
        $or: [
          { renterId: new ObjectId(decoded.userId) },
          { ownerId: new ObjectId(decoded.userId) }
        ],
        houseId: new ObjectId(houseId),
        status: { $in: ['pending', 'confirmed', 'active'] }
      });
      
      userSpecificData.userBooking = userBooking ? {
        id: userBooking._id,
        status: userBooking.status,
        checkInDate: userBooking.checkInDate,
        checkOutDate: userBooking.checkOutDate,
        totalAmount: userBooking.totalAmount,
        paymentStatus: userBooking.paymentStatus
      } : null;
      
      // For owners/admins viewing their own property
      if ((decoded.role === 'owner' && house.ownerId.toString() === decoded.userId) || decoded.role === 'admin') {
        // Get booking stats for this property
        const bookingStats = await bookingsCollection.aggregate([
          { $match: { houseId: new ObjectId(houseId) } },
          { $group: { 
            _id: "$status",
            count: { $sum: 1 },
            totalRevenue: { 
              $sum: { 
                $cond: [{ $in: ["$status", ["confirmed", "completed", "active"]] }, "$totalAmount", 0] 
              }
            }
          }}
        ]).toArray();
        
        userSpecificData.bookingStats = bookingStats.reduce((stats, stat) => {
          stats[stat._id] = stat.count;
          stats.totalRevenue = (stats.totalRevenue || 0) + stat.totalRevenue;
          return stats;
        }, {});
        
        // Get recent bookings
        const recentBookings = await bookingsCollection.find({
          houseId: new ObjectId(houseId)
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();
        
        userSpecificData.recentBookings = recentBookings;
        
        // Add owner-specific fields including verification details
        userSpecificData.isOwner = true;
        userSpecificData.ownerId = house.ownerId;
        
        // Show verification details only to owners/admins
        userSpecificData.verificationDetails = {
          isVerified: house.isVerified || false,
          verificationStatus: house.verificationStatus || 'pending',
          verifiedAt: house.verifiedAt,
          verifiedBy: house.verifiedByEmail,
          adminBadges: house.badges || [],
          verificationHistory: house.verificationHistory || []
        };
      }
    }
    
    // Format availability calendar
    const availabilityCalendar = [];
    const currentDate = new Date(today);
    while (currentDate <= ninetyDaysLater) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const isBooked = bookedDates.some(booking => {
        return currentDate >= new Date(booking.checkInDate) && currentDate <= new Date(booking.checkOutDate);
      });
      
      availabilityCalendar.push({
        date: dateStr,
        available: !isBooked,
        price: house.price.amount
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Format similar properties for response
    const formattedSimilarHouses = similarHouses.map(similar => ({
      _id: similar._id,
      title: similar.title,
      images: similar.images,
      location: {
        city: similar.location?.city,
        address: similar.location?.address
      },
      propertyDetails: {
        bedrooms: similar.propertyDetails?.bedrooms || 0,
        bathrooms: similar.propertyDetails?.bathrooms || 0
      },
      price: {
        amount: similar.price.amount,
        currency: similar.price.currency,
        period: similar.price.period
      },
      rentalType: similar.rentalType,
      propertyType: similar.propertyType,
      rating: similar.rating || 0,
      reviewCount: similar.reviewCount || 0,
      isVerified: similar.isVerified || false,
      verificationBadge: similar.isVerified ? {
        type: 'verified',
        label: 'Verified',
        color: 'green',
        icon: 'shield-check'
      } : null
    }));
    
    // Format reviews for response
    const formattedReviews = reviews.map(review => ({
      _id: review._id,
      userId: review.userId,
      userName: review.userName,
      userImage: review.userImage,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      helpfulCount: review.helpfulCount || 0,
      isVerified: review.isVerified || false
    }));
    
    // Calculate price breakdown for display (from your screenshots)
    const monthlyRent = house.price.amount;
    const securityDeposit = house.price.securityDeposit || 0;
    const cleaningFee = house.price.cleaningFee || 0;
    
    let totalAmount = monthlyRent;
    if (house.rentalType === 'monthly') {
      // For monthly rentals, add security deposit
      totalAmount += securityDeposit;
    } else if (house.rentalType === 'daily') {
      // For daily rentals, might include cleaning fee
      totalAmount += cleaningFee;
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        house: responseHouse,
        owner: ownerResponse,
        similarProperties: formattedSimilarHouses,
        reviews: {
          list: formattedReviews,
          stats: reviewStats
        },
        availability: {
          calendar: availabilityCalendar.slice(0, 30), // First 30 days
          bookedDates: bookedDates.map(b => ({
            checkIn: b.checkInDate,
            checkOut: b.checkOutDate
          })),
          minStay: house.availability?.minStay || 1,
          maxStay: house.availability?.maxStay || null,
          bookingAdvance: house.availability?.bookingAdvance || 0,
          availableFrom: house.availability?.availableFrom,
          availableUntil: house.availability?.availableUntil
        },
        priceBreakdown: {
          monthlyRent: monthlyRent,
          securityDeposit: securityDeposit,
          cleaningFee: cleaningFee,
          totalAmount: totalAmount,
          currency: house.price.currency,
          period: house.price.period
        },
        userSpecific: userSpecificData,
        meta: {
          timestamp: new Date().toISOString(),
          viewedByCount: house.viewedBy?.length || 0,
          favoritesCount: house.favorites || 0,
          isAvailable: house.availability?.isAvailable !== false,
          canBook: house.status === 'approved' && house.isActive && house.availability?.isAvailable !== false
        }
      })
    };
    
  } catch (error) {
    console.error('Get house error:', error);
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