const express = require("express");
const {
  adminLogin,
  getDashboardStats,
  getAllCustomers,
  getAllProviders,
  approveProvider,
  updateUserStatus,
  getAdminProfile,
  getEarnings,
} = require("../controllers/adminController");
const { protect, adminAuth } = require("../middleware/adminAuth");
const { verifyPayoutInformation } = require("../controllers/payoutController");

const router = express.Router();

// Admin login (public route)
router.post("/login", adminLogin);
router.patch(
  "/payout/:payoutInfoId/verify",
  adminAuth,
  verifyPayoutInformation
);

// Protected admin routes
router.get("/dashboard/stats", adminAuth, getDashboardStats);
router.get("/dashboard/earnings", adminAuth, getEarnings);
router.get("/customers", adminAuth, getAllCustomers);
router.get("/providers", adminAuth, getAllProviders);
router.patch("/providers/:providerId/approve", adminAuth, approveProvider);
router.patch("/users/:userId/:role/status", adminAuth, updateUserStatus);
router.get("/profile", adminAuth, getAdminProfile);

module.exports = router;
