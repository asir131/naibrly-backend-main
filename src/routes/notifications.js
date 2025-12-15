const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

router.get("/me", auth, getMyNotifications);
router.patch("/:id/read", auth, markNotificationRead);
router.patch("/read-all", auth, markAllNotificationsRead);

module.exports = router;
