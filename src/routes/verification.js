const express = require("express");
const { auth } = require("../middleware/auth");
const { adminAuth } = require("../middleware/adminAuth");
const { uploadVerificationDocuments } = require("../config/cloudinary");
const {
  submitVerification,
  getVerificationStatus,
  getAllVerifications,
  reviewVerification,
  deleteVerification,
  getVerificationById,
  getProviderVerificationBundle,
} = require("../controllers/verificationController");

const router = express.Router();

// Provider routes
router.post(
  "/submit",
  auth,
  uploadVerificationDocuments.fields([
    { name: "insuranceDocument", maxCount: 1 },
    { name: "idCardFront", maxCount: 1 },
    { name: "idCardBack", maxCount: 1 },
  ]),
  submitVerification
);

router.get("/status", auth, getVerificationStatus);
router.delete("/delete", auth, deleteVerification);

// Admin routes
router.get("/admin/all", adminAuth, getAllVerifications);
router.get("/admin/:verificationId", adminAuth, getVerificationById);
router.get(
  "/admin/provider/:providerId",
  adminAuth,
  getProviderVerificationBundle
);
router.patch("/admin/:verificationId/review", adminAuth, reviewVerification);

module.exports = router;
