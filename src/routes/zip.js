const express = require("express");
const {
  getProviderServiceAreas,
  addServiceArea,
  removeServiceArea,
  toggleServiceArea,
  getNearbyBundles,
  getProvidersByZipCode,
} = require("../controllers/zipController");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Provider service areas management
router.get(
  "/provider/service-areas",
  auth,
  authorize("provider"),
  getProviderServiceAreas
);
router.post(
  "/provider/service-areas/add",
  auth,
  authorize("provider"),
  addServiceArea
);
router.delete(
  "/provider/service-areas/remove",
  auth,
  authorize("provider"),
  removeServiceArea
);
router.patch(
  "/provider/service-areas/toggle",
  auth,
  authorize("provider"),
  toggleServiceArea
);

// Provider nearby bundles
router.get(
  "/provider/nearby-bundles",
  auth,
  authorize("provider"),
  getNearbyBundles
);

// Public: Find providers by ZIP code
router.get("/providers", getProvidersByZipCode);

module.exports = router;
