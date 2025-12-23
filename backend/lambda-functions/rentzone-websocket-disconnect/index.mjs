import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI);
  cachedDb = client.db('Rent_Zone');
  return cachedDb;
}

export const handler = async (event) => {
  console.log('WebSocket Disconnect Event:', JSON.stringify(event, null, 2));
  
  const connectionId = event.requestContext.connectionId;
  
  try {
    const db = await connectToDatabase();
    const sessionsCollection = db.collection('websocket_sessions');
    
    // Mark session as inactive
    await sessionsCollection.updateOne(
      { connectionId },
      {
        $set: {
          isActive: false,
          disconnectedAt: new Date()
        }
      }
    );
    
    console.log(`✅ Connection ${connectionId} disconnected`);
    
    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    console.error('❌ Disconnect error:', error);
    return { statusCode: 500, body: 'Disconnect failed' };
  }
};