const mongoose = require("mongoose");

const quickChatSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: [true, "Quick chat content is required"],
      trim: true,
      maxlength: 500,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "createdByRole",
      required: true,
    },
    createdByRole: {
      type: String,
      enum: ["customer", "provider", "admin"],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
quickChatSchema.index({ createdBy: 1, createdByRole: 1 });

module.exports = mongoose.model("QuickChat", quickChatSchema);
