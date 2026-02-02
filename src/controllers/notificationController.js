const Notification = require("../models/Notification");
const DeviceToken = require("../models/DeviceToken");

const getUserModelFromRole = (role) => {
  if (role === "provider") return "ServiceProvider";
  if (role === "admin") return "Admin";
  return "Customer";
};

// GET /api/notifications/me
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, data: notifications });
  } catch (error) {
    console.error("getMyNotifications error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

// PATCH /api/notifications/:id/read
const markNotificationRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    await Notification.updateOne({ _id: id, user: userId }, { isRead: true });
    res.json({ success: true });
  } catch (error) {
    console.error("markNotificationRead error:", error);
    res.status(500).json({ success: false, message: "Failed to mark notification read" });
  }
};

// PATCH /api/notifications/read-all
const markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.updateMany({ user: userId, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    res.status(500).json({ success: false, message: "Failed to mark all notifications read" });
  }
};

// POST /api/notifications/device-token
const registerDeviceToken = async (req, res) => {
  try {
    const userId = req.user._id;
    const { token, platform } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }

    const userModel = getUserModelFromRole(req.user.role);
    await DeviceToken.findOneAndUpdate(
      { user: userId, token },
      {
        user: userId,
        userModel,
        token,
        platform: platform || "web",
        lastSeenAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("registerDeviceToken error:", error);
    res.status(500).json({ success: false, message: "Failed to register device token" });
  }
};

// DELETE /api/notifications/device-token
const removeDeviceToken = async (req, res) => {
  try {
    const userId = req.user._id;
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }
    await DeviceToken.deleteOne({ user: userId, token });
    res.json({ success: true });
  } catch (error) {
    console.error("removeDeviceToken error:", error);
    res.status(500).json({ success: false, message: "Failed to remove device token" });
  }
};

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  registerDeviceToken,
  removeDeviceToken,
};
