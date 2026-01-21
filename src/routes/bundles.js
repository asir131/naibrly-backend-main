const express = require("express");
const router = express.Router();

const bundleController = require("../controllers/bundleController");
const { auth, authorize } = require("../middleware/auth");

// Customer routes
router.post(
  "/create",
  auth,
  authorize("customer"),
  bundleController.createBundle
);
router.post(
  "/:bundleId/join",
  auth,
  authorize("customer"),
  bundleController.joinBundle
);
router.get(
  "/user-bundles",
  auth,
  authorize("customer"),
  bundleController.getUserBundles
);

// Check if current customer is a participant of a bundle
router.get(
  "/:bundleId/participation",
  auth,
  authorize("customer"),
  bundleController.checkBundleParticipation
);

// NEW ROUTE: Get nearby bundles for customer
router.get(
  "/customer/nearby",
  auth,
  authorize("customer"),
  bundleController.getNearbyBundlesForCustomer
);

// Provider routes
router.post(
  "/:bundleId/provider/accept",
  auth,
  authorize("provider"),
  bundleController.providerAcceptBundle
);
router.patch(
  "/:bundleId/status",
  auth,
  authorize("provider"),
  bundleController.updateBundleStatus
);
router.patch(
  "/:bundleId/participants/:customerId/status",
  auth,
  authorize("provider"),
  bundleController.updateBundleParticipantStatus
);
// Customer cancels their own participation in a bundle
router.patch(
  "/:bundleId/participants/me/cancel",
  auth,
  authorize("customer"),
  bundleController.cancelBundleParticipation
);
router.get("/search", bundleController.searchBundlesByNameAndZip);
router.get("/all", bundleController.getAllBundles);

// Public routes
router.get("/by-zipcode", bundleController.getBundlesByZipCode);
router.get("/:bundleId", bundleController.getBundleDetails);
router.post(
  "/share/:shareToken",
  auth,
  authorize("customer"),
  bundleController.joinBundleViaShareToken
);
// Allow GET for share links as well (requires bearer token in headers)
router.get(
  "/share/:shareToken",
  auth,
  authorize("customer"),
  bundleController.getBundleByShareToken
);
router.post(
  "/:bundleId/review",
  auth,
  authorize("customer"),
  bundleController.addBundleReview
);

module.exports = router;
