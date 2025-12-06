const express = require("express");
const {
  getCommissionSettings,
  updateCommissionSettings,
  getCommissionEarnings,
} = require("../controllers/commissionController");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Public route to get current commission settings
router.get("/settings", getCommissionSettings);

// Admin routes
router.get("/earnings", auth, authorize("admin"), getCommissionEarnings);
router.put("/settings", auth, authorize("admin"), updateCommissionSettings);

module.exports = router;
