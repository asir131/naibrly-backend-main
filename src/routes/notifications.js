const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  registerDeviceToken,
  removeDeviceToken,
} = require("../controllers/notificationController");

router.get("/me", auth, getMyNotifications);
router.patch("/:id/read", auth, markNotificationRead);
router.patch("/read-all", auth, markAllNotificationsRead);
router.post("/device-token", auth, registerDeviceToken);
router.delete("/device-token", auth, removeDeviceToken);

module.exports = router;
