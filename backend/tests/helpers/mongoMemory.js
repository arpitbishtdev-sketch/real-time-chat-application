import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

export async function connect() {
  mongod = await MongoMemoryServer.create();
  // Mirrors config/db.js's production connection options exactly
  // (BACKEND.md §12/TESTING.md #31) — without `bufferCommands: false`,
  // Mongoose's default behavior queues operations for up to
  // `bufferTimeoutMS` (10s) while disconnected instead of failing fast via
  // server selection, silently testing a different failure mode than the
  // one actually documented and shipped.
  mongoose.set('bufferCommands', false);
  await mongoose.connect(mongod.getUri(), {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
  });

  // Mirrors config/db.js's production fix: without this, unique-index
  // tests (e.g. duplicate email) can pass by timing luck rather than by
  // the index actually existing yet — createIndexes() is idempotent.
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

export async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
}

export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}
