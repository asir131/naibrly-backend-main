const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "userModel",
    },
    userModel: {
      type: String,
      required: true,
      enum: ["Customer", "ServiceProvider", "Admin"],
    },
    token: {
      type: String,
      required: true,
      index: true,
    },
    platform: {
      type: String,
      default: "web",
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ user: 1, token: 1 }, { unique: true });

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
