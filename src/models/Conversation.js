const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  senderRole: {
    type: String,
    required: true,
    enum: ["customer", "provider"],
  },
  content: {
    type: String,
    required: true,
  },
  quickChatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "QuickChat",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const conversationSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      // Optional for bundles
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
    },
    bundleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bundle",
    },
    messages: [messageSchema],
    lastMessage: {
      type: String,
    },
    lastMessageAt: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure one conversation per service request
conversationSchema.index({ requestId: 1 }, { unique: true, sparse: true });

// Allow per-participant bundle conversations (one per bundleId + customerId), ignoring nulls
conversationSchema.index(
  { bundleId: 1, customerId: 1 },
  {
    name: "bundle_customer_unique_nonnull",
    unique: true,
    partialFilterExpression: {
      bundleId: { $exists: true, $type: ["objectId", "string"] },
      customerId: { $exists: true, $type: "objectId" },
    },
  }
);

module.exports = mongoose.model("Conversation", conversationSchema);
