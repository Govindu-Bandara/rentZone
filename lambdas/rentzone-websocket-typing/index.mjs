import { MongoClient } from 'mongodb';
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
    console.error(`Failed to send typing indicator to ${connectionId}:`, error);
    return false;
  }
}

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body);
  const { conversationId, receiverId, isTyping } = body;

  try {
    const db = await connectToDatabase();
    const sessionsCollection = db.collection('websocket_sessions');

    const session = await sessionsCollection.findOne({ connectionId, isActive: true });
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
    }

    const senderIdStr   = session.userId;       // plain string
    const receiverIdStr = receiverId.toString(); // normalise

    // Look up receiver by plain string userId — matches connect Lambda storage
    const receiverSession = await sessionsCollection.findOne({
      userId:   receiverIdStr,
      isActive: true,
    });

    if (receiverSession) {
      await sendToConnection(receiverSession.connectionId, {
        action:         'typing',
        conversationId,
        senderId:       senderIdStr,
        isTyping,
        timestamp:      new Date().toISOString(),
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('❌ Typing indicator error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};