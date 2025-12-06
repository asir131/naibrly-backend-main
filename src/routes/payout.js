const express = require("express");
const router = express.Router();
const {
  savePayoutInformation,
  getPayoutInformation,
  deletePayoutInformation,
  getPayoutStatus,
  updatePayoutInformation,
} = require("../controllers/payoutController");

const { getAllBanks, searchBanks } = require("../controllers/bankController");

const { auth, authorize } = require("../middleware/auth");

// Public bank routes
router.get("/banks", getAllBanks);
router.get("/banks/search", searchBanks);

// Provider payout routes
router.post("/information", auth, authorize("provider"), savePayoutInformation);
router.put("/information", auth, authorize("provider"), updatePayoutInformation);
router.get("/information", auth, authorize("provider"), getPayoutInformation);
router.delete(
  "/information",
  auth,
  authorize("provider"),
  deletePayoutInformation
);
router.get("/status", auth, authorize("provider"), getPayoutStatus);

module.exports = router;
