const express = require('express');
const {
    sendResetOTP,
    verifyOTP,
    resetPassword,
    resendOTP
} = require('../controllers/passwordResetController');

const router = express.Router();

// Send OTP for password reset
router.post('/forgot-password', sendResetOTP);

// Verify OTP
router.post('/verify-otp', verifyOTP);

// Reset password with new password
router.post('/reset-password', resetPassword);

// Resend OTP
router.post('/resend-otp', resendOTP);

module.exports = router;