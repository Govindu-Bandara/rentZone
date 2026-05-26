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

async function sendToConnection(connectionId, data, sessionsCollection = null) {
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
    if (error.$metadata?.httpStatusCode === 410 || error.name === 'GoneException') {
      console.warn(`Stale connection ${connectionId} — marking inactive`);
      if (sessionsCollection) {
        await sessionsCollection.updateOne(
          { connectionId },
          { $set: { isActive: false, disconnectedAt: new Date() } }
        ).catch(() => {});
      }
    } else {
      console.error(`❌ Failed to send to ${connectionId}:`, error);
    }
    return false;
  }
}

export const handler = async (event) => {
  console.log('Send Message Event:', JSON.stringify(event, null, 2));

  if (!WEBSOCKET_ENDPOINT) {
    console.error('❌ WEBSOCKET_ENDPOINT env var is not set!');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body);
  const { receiverId, message, messageType = 'text', attachments = [], tempId } = body;

  if (!receiverId || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'receiverId and message are required' }) };
  }

  try {
    const db = await connectToDatabase();
    const sessionsCollection      = db.collection('websocket_sessions');
    const messagesCollection      = db.collection('messages');
    const conversationsCollection = db.collection('conversations');
    const notificationsCollection = db.collection('notifications');
    const usersCollection         = db.collection('users');

    // Look up the sender session — userId stored as plain string by connect Lambda
    const session = await sessionsCollection.findOne({ connectionId, isActive: true });
    if (!session) {
      console.warn(`No active session for connectionId ${connectionId}`);
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
    }

    // DEBUG — log types to help diagnose any remaining mismatch
    console.log('session.userId:', session.userId, 'type:', typeof session.userId);
    console.log('receiverId from payload:', receiverId, 'type:', typeof receiverId);

    // Keep userId values as plain strings throughout this Lambda.
    // ObjectId conversions are only done when querying the users collection (_id field).
    const senderIdStr   = session.userId;          // plain string
    const receiverIdStr = receiverId.toString();    // plain string (normalise in case client sends non-string)

    // Fetch sender and receiver user documents
    const senderObjId   = new ObjectId(senderIdStr);
    const receiverObjId = new ObjectId(receiverIdStr);

    const receiver = await usersCollection.findOne({ _id: receiverObjId });
    if (!receiver) {
      console.warn(`Receiver not found: ${receiverIdStr}`);
      return { statusCode: 404, body: JSON.stringify({ error: 'Receiver not found' }) };
    }

    const sender = await usersCollection.findOne(
      { _id: senderObjId },
      { projection: { firstName: 1, lastName: 1, profileImage: 1 } }
    );

    // Build a stable conversationId from sorted user id strings
    const sortedIds      = [senderIdStr, receiverIdStr].sort();
    const conversationId = sortedIds.join('_');
    const now            = new Date();

    // Upsert the conversation document.
    // On first insert ($setOnInsert) the receiver's unreadCount is set to 1 (not 0)
    // because the message that triggered this upsert is already unread for them.
    await conversationsCollection.updateOne(
      { conversationId },
      {
        $set: {
          participants:  [senderObjId, receiverObjId],
          lastMessage:   message,
          lastMessageAt: now,
          updatedAt:     now,
        },
        $setOnInsert: {
          createdAt: now,
          participantsMeta: [
            { userId: senderObjId,   lastSeen: now, unreadCount: 0 },
            { userId: receiverObjId, lastSeen: now, unreadCount: 1 }, // first message already unread
          ],
        },
      },
      { upsert: true }
    );

    // For existing conversations, increment the receiver's unread count.
    // The $setOnInsert path above already handles new conversations with unreadCount:1,
    // so this update is a no-op on first insert (the document was just created with the
    // correct value) and correctly increments on subsequent messages.
    await conversationsCollection.updateOne(
      {
        conversationId,
        'participantsMeta.userId': receiverObjId,
        createdAt: { $lt: now }, // only update pre-existing docs, not the one we just inserted
      },
      { $inc: { 'participantsMeta.$.unreadCount': 1 } }
    );

    // Insert the message document — store sender/receiver ids as ObjectIds for consistency
    // with get-messages Lambda which queries by ObjectId participant.
    const messageDoc = {
      conversationId,
      senderId:    senderObjId,
      receiverId:  receiverObjId,
      message,
      messageType,
      attachments,
      isRead:      false,
      isDelivered: false,
      createdAt:   now,
      metadata: {
        senderName:   sender ? `${sender.firstName} ${sender.lastName}` : '',
        senderImage:  sender?.profileImage || null,
        receiverName: `${receiver.firstName} ${receiver.lastName}`,
      },
    };

    const messageResult = await messagesCollection.insertOne(messageDoc);
    const messageId     = messageResult.insertedId;

    // Look up receiver's active WebSocket session — userId stored as plain string
    const receiverSession = await sessionsCollection.findOne({
      userId:   receiverIdStr,  // plain string — matches how connect Lambda stored it
      isActive: true,
    });

    console.log(`Receiver session lookup (userId="${receiverIdStr}"): ${receiverSession ? 'FOUND ' + receiverSession.connectionId : 'NOT FOUND (offline)'}`);

    const messagePayload = {
      action: 'newMessage',
      message: {
        _id:           messageId.toString(),
        conversationId,
        senderId:      senderIdStr,
        receiverId:    receiverIdStr,
        message,
        messageType,
        attachments,
        metadata:      messageDoc.metadata,
        createdAt:     now.toISOString(),
        isRead:        false,
        isDelivered:   false,
      },
    };

    // Push message to receiver if online
    let receiverIsOnline = false;
    if (receiverSession) {
      console.log(`Pushing newMessage to receiver connection: ${receiverSession.connectionId}`);
      receiverIsOnline = await sendToConnection(
        receiverSession.connectionId,
        messagePayload,
        sessionsCollection
      );
    }

    // Confirm to sender that message was accepted
    await sendToConnection(connectionId, {
      action:         'messageSent',
      messageId:      messageId.toString(),
      conversationId,
      tempId:         tempId || null,
      timestamp:      now.toISOString(),
    }, sessionsCollection);

    // If receiver was online and we pushed successfully, mark as delivered immediately
    if (receiverIsOnline) {
      const deliveredAt = new Date();
      await messagesCollection.updateOne(
        { _id: messageId },
        { $set: { deliveredAt, isDelivered: true } }
      );
      await sendToConnection(connectionId, {
        action:      'messageDelivered',
        messageId:   messageId.toString(),
        conversationId,
        deliveredAt: deliveredAt.toISOString(),
      }, sessionsCollection);
    }

    // Persist a notification for the receiver (shown in notification centre)
    await notificationsCollection.insertOne({
      userId:    receiverObjId,
      type:      'message',
      title:     'New Message',
      message:   `${messageDoc.metadata.senderName} sent you a message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`,
      data: {
        conversationId,
        messageId:  messageId.toString(),
        senderId:   senderIdStr,
        senderName: messageDoc.metadata.senderName,
      },
      isRead:    false,
      priority:  'medium',
      category:  'message',
      senderId:  senderObjId,
      createdAt: now,
      actionUrl: `/messages/${conversationId}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success:        true,
        messageId:      messageId.toString(),
        conversationId,
        timestamp:      now.toISOString(),
      }),
    };

  } catch (error) {
    console.error('❌ Send message error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error:   'Failed to send message',
        details: error.message,
      }),
    };
  }
};