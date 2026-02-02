const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Admin = require("../models/Admin");
const OTP = require("../models/OTP");
const emailService = require("../utils/emailService");

// Generate random OTP
const generateOTP = (length = 4) => {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

const findUserByEmail = async (email) => {
  let user = await Customer.findOne({ email });
  if (!user) user = await ServiceProvider.findOne({ email });
  if (!user) user = await Admin.findOne({ email });
  return user;
};

// Send OTP for email verification
exports.sendEmailVerificationOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address",
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    const otpCode = generateOTP(parseInt(process.env.OTP_LENGTH) || 4);
    const expiresAt = new Date(
      Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000
    );

    await OTP.deleteMany({ email, purpose: "email_verification" });

    const otp = new OTP({
      email,
      otp: otpCode,
      purpose: "email_verification",
      expiresAt,
    });

    await otp.save();

    const emailResult = await emailService.sendOTPEmail(
      email,
      otpCode,
      `${user.firstName || ""} ${user.lastName || ""}`.trim()
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
      message: "OTP sent successfully to your email",
      data: {
        email: email,
        expiresIn: process.env.OTP_EXPIRY_MINUTES || 10,
      },
    });
  } catch (error) {
    console.error("Send email verification OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: error.message,
    });
  }
};

// Verify OTP for email verification
exports.verifyEmailVerificationOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const otpRecord = await OTP.findOne({
      email,
      purpose: "email_verification",
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "OTP not found or expired",
      });
    }

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

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.isEmailVerified = true;
    await user.save();

    otpRecord.isUsed = true;
    await otpRecord.save();

    res.json({
      success: true,
      message: "Email verified successfully",
      data: { email },
    });
  } catch (error) {
    console.error("Verify email OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: error.message,
    });
  }
};

// Resend email verification OTP
exports.resendEmailVerificationOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address",
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    const recentOTP = await OTP.findOne({
      email,
      purpose: "email_verification",
      createdAt: { $gte: new Date(Date.now() - 60000) },
    });

    if (recentOTP) {
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting a new OTP",
      });
    }

    const otpCode = generateOTP(parseInt(process.env.OTP_LENGTH) || 4);
    const expiresAt = new Date(
      Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000
    );

    await OTP.deleteMany({ email, purpose: "email_verification" });

    const otp = new OTP({
      email,
      otp: otpCode,
      purpose: "email_verification",
      expiresAt,
    });

    await otp.save();

    const emailResult = await emailService.sendOTPEmail(
      email,
      otpCode,
      `${user.firstName || ""} ${user.lastName || ""}`.trim()
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
    console.error("Resend email OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend OTP",
      error: error.message,
    });
  }
};
