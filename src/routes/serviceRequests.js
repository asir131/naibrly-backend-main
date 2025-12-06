const express = require("express");
const {
  createServiceRequest,
  getCustomerRequests,
  getCustomerAllRequests,
  getProviderRequests,
  updateRequestStatus,
  cancelRequest,
  addReview,
  getProvidersByService,
  testProviderServices,
  getProviderRequestsByStatus,
  getProviderDashboardStats,
  getProvidersByServiceAndZip,
} = require("../controllers/serviceRequestController");
const { auth } = require("../middleware/auth");

const router = express.Router();

// Test route for debugging
router.get("/test-provider/:providerId", testProviderServices);

// Customer routes
router.post("/", auth, createServiceRequest);
router.get("/customer/my-requests", auth, getCustomerRequests);
router.get("/customer/my-all-requests", auth, getCustomerAllRequests);
router.patch("/:requestId/cancel", auth, cancelRequest);
router.post("/:requestId/review", auth, addReview);

// Provider routes - Enhanced status management
router.get("/provider/my-requests", auth, getProviderRequests);
router.get("/provider/status/:status", auth, getProviderRequestsByStatus);
router.get("/provider/stats", auth, getProviderDashboardStats);
router.patch("/:requestId/status", auth, updateRequestStatus);

// Public routes (for browsing providers)
router.get("/providers", getProvidersByService);
router.get("/search-providers", getProvidersByServiceAndZip);

// Customer: Nearby services by ZIP
router.get(
  "/customer/nearby-services",
  auth,
  require("../controllers/serviceRequestController").getNearbyServicesByZip
);

module.exports = router;
