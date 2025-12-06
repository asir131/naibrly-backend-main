const express = require("express");
const {
  createWithdrawalRequest,
  getMyWithdrawals,
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
} = require("../controllers/withdrawalController");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Provider routes
router.post("/", auth, authorize("provider"), createWithdrawalRequest);
router.get("/my", auth, authorize("provider"), getMyWithdrawals);

// Admin routes
router.get("/admin", auth, authorize("admin"), getAllWithdrawals);
router.patch("/:withdrawalId/approve", auth, authorize("admin"), approveWithdrawal);
router.patch("/:withdrawalId/reject", auth, authorize("admin"), rejectWithdrawal);

module.exports = router;
