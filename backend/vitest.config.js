import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 15000,
    // mongodb-memory-server can take a while to boot the first time it
    // downloads its binary — give beforeAll/afterAll enough room.
    hookTimeout: 60000,
  },
});
