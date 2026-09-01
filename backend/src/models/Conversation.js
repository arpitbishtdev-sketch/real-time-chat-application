import mongoose from 'mongoose';

const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      required: true,
    },
    // `[idA, idB].sort().join('_')` — order-independent key so the pair
    // {A,B} and {B,A} always collide on the same unique index (BACKEND.md §13a).
    participantsKey: {
      type: String,
      required: true,
      unique: true,
    },
    lastMessageAt: {
      type: Date,
    },
    lastMessagePreview: {
      type: String,
    },
    // Keyed by userId string; only ever read/written per-key via atomic
    // $inc/$set (BACKEND.md §13b) once M5 lands — never fetch-then-save.
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
