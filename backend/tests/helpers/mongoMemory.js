import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

export async function connect() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { serverSelectionTimeoutMS: 5000 });

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
