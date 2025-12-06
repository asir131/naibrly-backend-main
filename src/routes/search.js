const express = require("express");
const {
  searchProvidersByServiceAndZip,
  getPopularServicesByZip,
  autoSuggestServices,
  checkServiceAvailability,
  advancedSearch,
} = require("../controllers/searchController");

const router = express.Router();

// All routes now use POST for request body
router.post("/providers", searchProvidersByServiceAndZip);
router.post("/popular-services", getPopularServicesByZip);
router.post("/suggest-services", autoSuggestServices);
router.post("/check-availability", checkServiceAvailability);
router.post("/advanced-search", advancedSearch);

module.exports = router;
