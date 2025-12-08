const express = require("express");
const {
  adminLogin,
  getDashboardStats,
  getAllCustomers,
  getAllProviders,
  approveProvider,
  updateUserStatus,
  getAdminProfile,
  getEarningsSummary,
  getCustomerDetails,
  getProviderDetails,
  approveProviderVerification,
  rejectProviderVerification,
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
router.get("/dashboard/earnings", adminAuth, getEarningsSummary);
router.get("/customers", adminAuth, getAllCustomers);
router.get("/customers/:customerId", adminAuth, getCustomerDetails);
router.get("/providers", adminAuth, getAllProviders);
router.get("/providers/:providerId", adminAuth, getProviderDetails);
router.patch("/providers/:providerId/approve", adminAuth, approveProvider);
router.patch(
  "/providers/:providerId/verification/approve",
  adminAuth,
  approveProviderVerification
);
router.patch(
  "/providers/:providerId/verification/reject",
  adminAuth,
  rejectProviderVerification
);
router.patch("/users/:userId/:role/status", adminAuth, updateUserStatus);
router.get("/profile", adminAuth, getAdminProfile);

module.exports = router;
