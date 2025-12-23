import { MongoClient, ObjectId } from 'mongodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const MONGODB_URI = process.env.MONGODB_URI;
const WEBSOCKET_ENDPOINT = `https://${process.env.API_GATEWAY_ID}.execute-api.ap-south-1.amazonaws.com/production`;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

// Helper to send message via WebSocket
async function sendToConnection(connectionId, data) {
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_ENDPOINT
  });
  
  const command = new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: JSON.stringify(data)
  });
  
  try {
    await apiGatewayClient.send(command);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send to connection ${connectionId}:`, error);
    return false;
  }
}

export const handler = async (event) => {
  console.log('Send Message Event:', JSON.stringify(event, null, 2));
  
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body);
  
  const { receiverId, message, messageType = 'text', attachments = [] } = body;
  
  try {
    const db = await connectToDatabase();
    const sessionsCollection = db.collection('websocket_sessions');
    const messagesCollection = db.collection('messages');
    const conversationsCollection = db.collection('conversations');
    const notificationsCollection = db.collection('notifications');
    const usersCollection = db.collection('users');
    
    // Get sender from connection
    const session = await sessionsCollection.findOne({ connectionId, isActive: true });
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
    }
    
    const senderId = new ObjectId(session.userId);
    const receiverIdObj = new ObjectId(receiverId);
    
    // Validate receiver exists
    const receiver = await usersCollection.findOne({ _id: receiverIdObj });
    if (!receiver) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Receiver not found' }) };
    }
    
    // Get sender info
    const sender = await usersCollection.findOne(
      { _id: senderId },
      { projection: { firstName: 1, lastName: 1, profileImage: 1 } }
    );
    
    // Create conversation ID (sorted)
    const participants = [senderId, receiverIdObj];
    participants.sort((a, b) => a.toString().localeCompare(b.toString()));
    const conversationId = participants.join('_');
    
    // Create or update conversation
    const conversationUpdate = {
      $set: {
        participants,
        lastMessage: message,
        lastMessageAt: new Date(),
        updatedAt: new Date()
      }
    };
    
    // Set on insert for new conversations
    if (!(await conversationsCollection.findOne({ conversationId }))) {
      conversationUpdate.$setOnInsert = {
        createdAt: new Date(),
        participantsMeta: participants.map(userId => ({
          userId,
          lastSeen: new Date(),
          unreadCount: userId.toString() === senderId.toString() ? 0 : 1
        }))
      };
    }
    
    await conversationsCollection.updateOne(
      { conversationId },
      conversationUpdate,
      { upsert: true }
    );
    
    // Create message document
    const messageDoc = {
      conversationId,
      senderId,
      receiverId: receiverIdObj,
      message,
      messageType,
      attachments,
      isRead: false,
      deliveredAt: new Date(),
      createdAt: new Date(),
      metadata: {
        senderName: `${sender.firstName} ${sender.lastName}`,
        senderImage: sender.profileImage,
        receiverName: `${receiver.firstName} ${receiver.lastName}`
      }
    };
    
    const messageResult = await messagesCollection.insertOne(messageDoc);
    const messageId = messageResult.insertedId;
    
    // Update receiver's unread count in conversation
    await conversationsCollection.updateOne(
      { conversationId, 'participantsMeta.userId': receiverIdObj },
      { $inc: { 'participantsMeta.$.unreadCount': 1 } }
    );
    
    // Send real-time message to receiver if online
    const receiverSession = await sessionsCollection.findOne({ 
      userId: receiverIdObj, 
      isActive: true 
    });
    
    const messagePayload = {
      action: 'newMessage',
      message: {
        _id: messageId,
        conversationId,
        senderId: senderId.toString(),
        receiverId: receiverId.toString(),
        message,
        messageType,
        attachments,
        metadata: messageDoc.metadata,
        createdAt: messageDoc.createdAt,
        isRead: false
      }
    };
    
    if (receiverSession) {
      await sendToConnection(receiverSession.connectionId, messagePayload);
    }
    
    // Send confirmation to sender
    await sendToConnection(connectionId, {
      action: 'messageSent',
      messageId: messageId.toString(),
      timestamp: new Date().toISOString()
    });
    
    // Create notification for receiver (for when they're offline)
    await notificationsCollection.insertOne({
      userId: receiverIdObj,
      type: 'message',
      title: 'New Message',
      message: `${sender.firstName} sent you a message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`,
      data: {
        conversationId,
        messageId: messageId.toString(),
        senderId: senderId.toString(),
        senderName: `${sender.firstName} ${sender.lastName}`
      },
      isRead: false,
      priority: 'medium',
      category: 'message',
      senderId,
      createdAt: new Date(),
      actionUrl: `/messages/${conversationId}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        messageId: messageId.toString(),
        conversationId,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ Send message error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        error: 'Failed to send message', 
        details: error.message 
      })
    };
  }
};