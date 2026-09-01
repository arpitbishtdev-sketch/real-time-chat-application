import mongoose from 'mongoose';
import { env } from './env.js';

// Fail fast instead of queuing operations indefinitely while disconnected
// (BACKEND.md §12) — turns a DB outage into a clean, bounded-time failure.
mongoose.set('bufferCommands', false);

export async function connectDB() {
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false,
    });

    // `unique: true` on a schema field only *declares* an index — Mongoose
    // builds it in the background after connecting and does NOT wait for
    // that build before accepting writes. Without this, a write landing
    // between "connected" and "index finished building" can silently skip
    // a uniqueness constraint (verified: this let a duplicate email through
    // during manual M2 testing). createIndexes() is idempotent, so calling
    // it here has no cost once indexes already exist. (Model.init() also
    // triggers an explicit createCollection() step that throws under
    // bufferCommands:false in this Mongoose version — createIndexes() alone
    // is both sufficient and the one that actually works here.)
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));

    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error('MongoDB connection failed on startup:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
