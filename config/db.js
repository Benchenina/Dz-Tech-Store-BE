/**
 * MongoDB connection helper.
 * Keeps connection logic isolated from the Express bootstrap so it can be
 * reused by the server and by the standalone seed script.
 */
const mongoose = require('mongoose');

async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is not defined. Copy .env.example to .env first.');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  const { host, name } = mongoose.connection;
  console.log(`[database] Connected to MongoDB at ${host}/${name}`);
  return mongoose.connection;
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[database] Connection closed');
  }
}

module.exports = { connectDB, disconnectDB };
