const crypto = require("crypto");
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Admin = require("../models/Admin");
const OTP = require("../models/OTP");
const emailService = require("../utils/emailService");
const { sendNotification } = require("../utils/notification");

// Generate random OTP
const generateOTP = (length = 5) => {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

// Send OTP for password reset
exports.sendResetOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Check if user exists in any model
    let user = await Customer.findOne({ email });
    if (!user) user = await ServiceProvider.findOne({ email });
    if (!user) user = await Admin.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Account is deactivated. Please contact support.",
      });
    }

    // Generate OTP
    const otpCode = generateOTP(parseInt(process.env.OTP_LENGTH) || 4);
    const expiresAt = new Date(
      Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000
    );

    // Delete any existing OTPs for this email
    await OTP.deleteMany({ email, purpose: "password_reset" });

    // Create new OTP
    const otp = new OTP({
      email,
      otp: otpCode,
      purpose: "password_reset",
      expiresAt,
    });

    await otp.save();

    // Send OTP email
    const emailResult = await emailService.sendOTPEmail(
      email,
      otpCode,
      `${user.firstName} ${user.lastName}`
    );

    // Fail fast if email sending fails
    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP email",
        error: emailResult.error || "Email service unavailable",
      });
    }

    await sendNotification({
      userId: user._id,
      title: "Password reset requested",
      body: "We sent a reset code to your email",
      link: "/Login",
    });

    res.json({
      success: true,
      message: "OTP sent successfully to your email",
      data: {
        email: email,
        expiresIn: process.env.OTP_EXPIRY_MINUTES || 10,
      },
    });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: error.message,
    });
  }
};

// Verify OTP and generate reset token
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    // Find the latest OTP for this email
    const otpRecord = await OTP.findOne({
      email,
      purpose: "password_reset",
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "OTP not found or expired",
      });
    }

    // Check if OTP is valid
    if (
      otpRecord.isUsed ||
      otpRecord.expiresAt < new Date() ||
      otpRecord.attempts >= 5
    ) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired or has been used",
      });
    }

    // Verify OTP code
    if (otpRecord.otp !== otp) {
      otpRecord.attempts += 1;
      await otpRecord.save();

      const attemptsLeft = 5 - otpRecord.attempts;
      if (attemptsLeft <= 0) {
        return res.status(400).json({
          success: false,
          message: "Too many failed attempts. Please request a new OTP.",
        });
      }

      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${attemptsLeft} attempts left.`,
      });
    }

    // Generate reset token (valid for 15 minutes)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);

    // Store reset token in the OTP record instead of user model
    otpRecord.resetToken = resetToken;
    otpRecord.resetTokenExpires = resetTokenExpiry;
    otpRecord.isUsed = true;
    await otpRecord.save();

    console.log("✅ Reset token stored in OTP record:", {
      email,
      resetToken,
      expiresAt: resetTokenExpiry,
    });

    res.json({
      success: true,
      message: "OTP verified successfully",
      data: {
        resetToken: resetToken,
        email: email,
        expiresIn: 15,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: error.message,
    });
  }
};

// Reset password with new password
exports.resetPassword = async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;
    const resetToken =
      req.headers["x-reset-token"] ||
      req.headers["authorization"]?.replace("Bearer ", "");

    console.log("🔍 Reset password request:", {
      email,
      resetToken: resetToken ? `${resetToken.substring(0, 10)}...` : "missing",
    });

    if (!resetToken) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required in headers",
      });
    }

    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // Find valid reset token in OTP collection
    const resetRecord = await OTP.findOne({
      email: email,
      resetToken: resetToken,
      resetTokenExpires: { $gt: new Date() },
      purpose: "password_reset",
    });

    console.log("🔍 Reset token verification:", {
      email,
      resetTokenFound: !!resetRecord,
      tokenExpired: resetRecord
        ? resetRecord.resetTokenExpires < new Date()
        : false,
      currentTime: new Date(),
      tokenExpiry: resetRecord ? resetRecord.resetTokenExpires : null,
    });

    if (!resetRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
        debug: {
          email: email,
          currentTime: new Date(),
        },
      });
    }

    // Find user to update password
    let user = await Customer.findOne({ email });
    let userType = "Customer";

    if (!user) {
      user = await ServiceProvider.findOne({ email });
      userType = "ServiceProvider";
    }

    if (!user) {
      user = await Admin.findOne({ email });
      userType = "Admin";
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Delete the used reset token
    await OTP.deleteOne({ _id: resetRecord._id });

    console.log(`✅ Password reset successful for: ${email} (${userType})`);

    // Send success email
    try {
      await emailService.sendPasswordResetSuccessEmail(
        email,
        `${user.firstName} ${user.lastName}`
      );
    } catch (emailError) {
      console.error("Failed to send success email:", emailError);
    }

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
      error: error.message,
    });
  }
};

// Resend OTP
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Check if user exists
    let user = await Customer.findOne({ email });
    if (!user) user = await ServiceProvider.findOne({ email });
    if (!user) user = await Admin.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address",
      });
    }

    // Check for recent OTP requests (prevent spam)
    const recentOTP = await OTP.findOne({
      email,
      purpose: "password_reset",
      createdAt: { $gte: new Date(Date.now() - 60000) }, // 1 minute ago
    });

    if (recentOTP) {
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting a new OTP",
      });
    }

    // Generate new OTP
    const otpCode = generateOTP(parseInt(process.env.OTP_LENGTH) || 5);
    const expiresAt = new Date(
      Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000
    );

    await OTP.deleteMany({ email, purpose: "password_reset" });

    const otp = new OTP({
      email,
      otp: otpCode,
      purpose: "password_reset",
      expiresAt,
    });

    await otp.save();

    const emailResult = await emailService.sendOTPEmail(
      email,
      otpCode,
      `${user.firstName} ${user.lastName}`
    );

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP email",
        error: emailResult.error || "Email service unavailable",
      });
    }

    res.json({
      success: true,
      message: "New OTP sent successfully",
      data: {
        email: email,
        expiresIn: process.env.OTP_EXPIRY_MINUTES || 10,
      },
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend OTP",
      error: error.message,
    });
  }
};






