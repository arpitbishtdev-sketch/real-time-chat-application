import mongoose from 'mongoose';

const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Automatic cleanup — MongoDB reaps documents in the background once
// expiresAt has passed (BACKEND.md §6a/§11). Refresh still re-checks
// expiresAt explicitly (auth.service.js) since the reaper isn't instant.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
