import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body);
  
  const { messageIds, conversationId } = body;
  
  try {
    const db = await connectToDatabase();
    const sessionsCollection = db.collection('websocket_sessions');
    const messagesCollection = db.collection('messages');
    const conversationsCollection = db.collection('conversations');
    
    // Get user from connection
    const session = await sessionsCollection.findOne({ connectionId, isActive: true });
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
    }
    
    const userId = new ObjectId(session.userId);
    
    if (messageIds && messageIds.length > 0) {
      // Mark specific messages as read
      const messageObjectIds = messageIds.map(id => new ObjectId(id));
      
      await messagesCollection.updateMany(
        {
          _id: { $in: messageObjectIds },
          receiverId: userId,
          isRead: false
        },
        {
          $set: {
            isRead: true,
            readAt: new Date()
          }
        }
      );
    }
    
    if (conversationId) {
      // Mark all messages in conversation as read
      await messagesCollection.updateMany(
        {
          conversationId,
          receiverId: userId,
          isRead: false
        },
        {
          $set: {
            isRead: true,
            readAt: new Date()
          }
        }
      );
      
      // Reset unread count in conversation
      await conversationsCollection.updateOne(
        { conversationId, 'participantsMeta.userId': userId },
        {
          $set: {
            'participantsMeta.$.unreadCount': 0,
            'participantsMeta.$.lastSeen': new Date()
          }
        }
      );
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Messages marked as read' 
      })
    };
    
  } catch (error) {
    console.error('❌ Mark as read error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        error: 'Failed to mark messages as read' 
      })
    };
  }
};