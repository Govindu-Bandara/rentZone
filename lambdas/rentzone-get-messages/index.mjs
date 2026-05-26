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
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const decoded = verifyToken(event.headers.Authorization || event.headers.authorization);
    const userId  = new ObjectId(decoded.userId);

    const db = await connectToDatabase();
    const conversationsCollection = db.collection('conversations');
    const messagesCollection      = db.collection('messages');
    const usersCollection         = db.collection('users');

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};

      /* ── Single conversation messages ── */
      if (params.conversationId) {
        const conversation = await conversationsCollection.findOne({
          conversationId: params.conversationId,
          participants:   userId,
        });

        if (!conversation) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Conversation not found' }),
          };
        }

        const page  = parseInt(params.page)  || 1;
        const limit = parseInt(params.limit) || 50;
        const skip  = (page - 1) * limit;

        const messages = await messagesCollection
          .find({ conversationId: params.conversationId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const otherParticipantId = conversation.participants.find(
          id => id.toString() !== userId.toString()
        );
        const otherUserRaw = await usersCollection.findOne(
          { _id: otherParticipantId },
          { projection: { firstName: 1, lastName: 1, profileImage: 1, email: 1, phone: 1 } }
        );

        // Stringify _id so the frontend can compare it as a plain string
        const otherUser = otherUserRaw
          ? { ...otherUserRaw, _id: otherUserRaw._id.toString() }
          : null;

        const myMeta = conversation.participantsMeta?.find(
          p => p.userId.toString() === userId.toString()
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            conversation: {
              // Expose both _id and id so normaliseConvo always finds a key
              _id:            conversation.conversationId,
              id:             conversation.conversationId,
              conversationId: conversation.conversationId,
              participants:   conversation.participants,
              lastMessage:    conversation.lastMessage,
              lastMessageAt:  conversation.lastMessageAt,
              otherUser,
              unreadCount:    myMeta?.unreadCount || 0,
            },
            messages: messages.reverse(),
            pagination: {
              page,
              limit,
              total: await messagesCollection.countDocuments({
                conversationId: params.conversationId,
              }),
            },
          }),
        };
      }

      /* ── All conversations ── */
      const conversations = await conversationsCollection
        .find({ participants: userId })
        .sort({ lastMessageAt: -1 })
        .toArray();

      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          const otherParticipantId = conv.participants.find(
            id => id.toString() !== userId.toString()
          );
          const otherUserRaw = await usersCollection.findOne(
            { _id: otherParticipantId },
            { projection: { firstName: 1, lastName: 1, profileImage: 1, email: 1 } }
          );

          const otherUser = otherUserRaw
            ? { ...otherUserRaw, _id: otherUserRaw._id.toString() }
            : null;

          const myMeta = conv.participantsMeta?.find(
            p => p.userId.toString() === userId.toString()
          );

          return {
            // Expose both _id and id
            _id:            conv.conversationId,
            id:             conv.conversationId,
            conversationId: conv.conversationId,
            otherUser,
            lastMessage:    conv.lastMessage,
            lastMessageAt:  conv.lastMessageAt,
            unreadCount:    myMeta?.unreadCount || 0,
            lastSeen:       myMeta?.lastSeen,
            createdAt:      conv.createdAt,
          };
        })
      );

      const unreadConversations = enrichedConversations.filter(c => c.unreadCount > 0).length;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          conversations: enrichedConversations,
          counts: {
            total:  conversations.length,
            unread: unreadConversations,
          },
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request' }),
    };

  } catch (error) {
    console.error('❌ Get messages error:', error);
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