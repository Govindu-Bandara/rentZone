import { MongoClient, ObjectId } from 'mongodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const MONGODB_URI = process.env.MONGODB_URI;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

async function sendToConnection(connectionId, data) {
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_ENDPOINT,
  });
  const command = new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: JSON.stringify(data),
  });
  try {
    await apiGatewayClient.send(command);
    return true;
  } catch (error) {
    console.error(`Failed to notify sender of read receipt (${connectionId}):`, error);
    return false;
  }
}

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body);
  const { messageIds, conversationId } = body;

  try {
    const db = await connectToDatabase();
    const sessionsCollection      = db.collection('websocket_sessions');
    const messagesCollection      = db.collection('messages');
    const conversationsCollection = db.collection('conversations');

    const session = await sessionsCollection.findOne({ connectionId, isActive: true });
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
    }

    // Use ObjectId for message/conversation queries (stored as ObjectId in those collections)
    // Use plain string for session queries (stored as string by connect Lambda)
    const readerIdStr = session.userId;                   // plain string for session lookups
    const readerObjId = new ObjectId(session.userId);     // ObjectId for message/conv queries
    const readAt      = new Date();
    let affectedMessageIds = [];

    if (messageIds && messageIds.length > 0) {
      const messageObjectIds = messageIds.map(id => new ObjectId(id));
      await messagesCollection.updateMany(
        { _id: { $in: messageObjectIds }, receiverId: readerObjId, isRead: false },
        { $set: { isRead: true, readAt } }
      );
      affectedMessageIds = messageIds;
    }

    if (conversationId) {
      const unreadMessages = await messagesCollection.find(
        { conversationId, receiverId: readerObjId, isRead: false },
        { projection: { _id: 1 } }
      ).toArray();

      if (unreadMessages.length > 0) {
        const ids = unreadMessages.map(m => m._id);
        await messagesCollection.updateMany(
          { _id: { $in: ids } },
          { $set: { isRead: true, readAt } }
        );
        affectedMessageIds = [
          ...new Set([...affectedMessageIds, ...ids.map(id => id.toString())])
        ];
      }

      await conversationsCollection.updateOne(
        { conversationId, 'participantsMeta.userId': readerObjId },
        {
          $set: {
            'participantsMeta.$.unreadCount': 0,
            'participantsMeta.$.lastSeen':    readAt,
          },
        }
      );
    }

    if (affectedMessageIds.length > 0) {
      const affectedObjectIds = affectedMessageIds
        .map(id => { try { return new ObjectId(id); } catch { return null; } })
        .filter(Boolean);

      const affectedMessages = await messagesCollection.find(
        { _id: { $in: affectedObjectIds } },
        { projection: { senderId: 1 } }
      ).toArray();

      // Collect unique sender id strings to notify
      const senderIdStrs = [
        ...new Set(affectedMessages.map(m => m.senderId.toString()))
      ];

      for (const senderIdStr of senderIdStrs) {
        if (senderIdStr === readerIdStr) continue;

        // Session lookup uses plain string — matches connect Lambda storage
        const senderSession = await sessionsCollection.findOne({
          userId:   senderIdStr,
          isActive: true,
        });

        if (senderSession) {
          await sendToConnection(senderSession.connectionId, {
            action:         'messageRead',
            messageIds:     affectedMessageIds,
            conversationId: conversationId || null,
            readerId:       readerIdStr,
            readAt:         readAt.toISOString(),
          });
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success:       true,
        message:       'Messages marked as read',
        affectedCount: affectedMessageIds.length,
      }),
    };

  } catch (error) {
    console.error('❌ Mark as read error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Failed to mark messages as read' }),
    };
  }
};