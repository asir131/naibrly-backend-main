const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "/" },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
