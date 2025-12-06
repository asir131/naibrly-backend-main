const express = require("express");
const {
  getBundleSettings,
  updateBundleDiscount,
} = require("../controllers/bundleSettingsController");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Public route to get settings
router.get("/", getBundleSettings);

// Admin routes
router.put("/update-discount", auth, authorize("admin"), updateBundleDiscount);

module.exports = router;
