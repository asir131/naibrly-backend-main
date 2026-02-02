const express = require("express");
const {
  sendEmailVerificationOTP,
  verifyEmailVerificationOTP,
  resendEmailVerificationOTP,
} = require("../controllers/emailVerificationController");

const router = express.Router();

router.post("/send-otp", sendEmailVerificationOTP);
router.post("/verify-otp", verifyEmailVerificationOTP);
router.post("/resend-otp", resendEmailVerificationOTP);

module.exports = router;
