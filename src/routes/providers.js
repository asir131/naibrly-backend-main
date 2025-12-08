const express = require("express");
const {
  updateProviderCapacity,
  getProviderCapacity,
  getProviderServices,
  getMyServices,
  getProviderServiceDetailWithFeedback,
  getMyServiceDetail,
  addProviderServiceFeedback,
  getProviderServiceDetailsByQuery,
  // Service Areas exports
  getProviderServiceAreas,
  getMyServiceAreas,
  addServiceArea,
  updateServiceArea,
  removeServiceArea,
  getProviderReviews,
  getMyReviews,
  getMyAllReviews,
  getServiceReviewById,
  getBundleReviewsById,
  getProvidersByServiceArea,
  getTopProvidersByService,
  getProviderServiceDetailsWithReviews,
  getAllProvidersInfo,
  deleteMyService,
  addMyService,
  getMyBalance,
  getMyAnalytics,
  getMyPayoutInformation,
} = require("../controllers/providerController");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Provider capacity routes
router.get("/capacity", auth, authorize("provider"), getProviderCapacity);
router.put("/capacity", auth, authorize("provider"), updateProviderCapacity);

// Provider self reviews (requires bearer token)
router.get(
  "/reviews/my",
  auth,
  authorize("provider"),
  getMyReviews
);
router.get(
  "/reviews/my/all",
  auth,
  authorize("provider"),
  getMyAllReviews
);
router.get(
  "/reviews/my/service/:requestId",
  auth,
  authorize("provider"),
  getServiceReviewById
);
router.get(
  "/reviews/my/bundle/:bundleId",
  auth,
  authorize("provider"),
  getBundleReviewsById
);

// Authenticated provider services (no providerId required)
router.get("/services", auth, authorize("provider"), getProviderServices);
router.get("/analytics/my", auth, authorize("provider"), getMyAnalytics);

// Service routes - Public (using providerId)
router.get("/:providerId/reviews", getProviderReviews);
router.get("/:providerId/services", getProviderServices);
router.get(
  "/:providerId/services/:serviceName",
  getProviderServiceDetailWithFeedback
);
router.post("/top-by-service", getTopProvidersByService);
// Service routes - Authenticated Provider (using bearer token)
router.get("/services/my-services", auth, authorize("provider"), getMyServices);
router.get(
  "/services/my-services/:serviceName",
  auth,
  authorize("provider"),
  getMyServiceDetail
);
router.post(
  "/services/my-services",
  auth,
  authorize("provider"),
  addMyService
);
router.delete(
  "/services/my-services",
  auth,
  authorize("provider"),
  deleteMyService
);
router.get("/balance/my", auth, authorize("provider"), getMyBalance);
router.get(
  "/payout/my-information",
  auth,
  authorize("provider"),
  getMyPayoutInformation
);

router.post("/service-details", getProviderServiceDetailsWithReviews);

// Public query endpoint
router.get("/service-details", getProviderServiceDetailsByQuery);

// Public: list all providers
router.get("/all", getAllProvidersInfo);

// Customer feedback on a specific provider service
router.post(
  "/:providerId/services/:serviceName/feedback",
  auth,
  authorize("customer"),
  addProviderServiceFeedback
);

// ========== SERVICE AREAS ROUTES ========== //

// Public routes for service areas (using providerId)
router.get("/:providerId/service-areas", getProviderServiceAreas);
router.get("/service-areas/zip-code/:zipCode", getProvidersByServiceArea);

// Protected provider routes for service areas management (using bearer token)
router.get(
  "/service-areas/my-areas",
  auth,
  authorize("provider"),
  getMyServiceAreas
);
router.post("/service-areas/add", auth, authorize("provider"), addServiceArea);
router.patch(
  "/service-areas/:areaId",
  auth,
  authorize("provider"),
  updateServiceArea
);
router.delete(
  "/service-areas/:areaId",
  auth,
  authorize("provider"),
  removeServiceArea
);

module.exports = router;
