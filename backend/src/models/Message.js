import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    // Client-generated (UUID v4), reused across retries of the same
    // logical send — the idempotency key the unique compound index below
    // dedups on (REALTIME.md §13, BACKEND.md §13b).
    clientMessageId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    deliveredAt: {
      type: Date,
    },
    readAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Pagination + the exact tuple-cursor comparison (BACKEND.md §12, M6).
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// Idempotent send / duplicate protection (REALTIME.md §13).
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });

export const Message = mongoose.model('Message', messageSchema);
