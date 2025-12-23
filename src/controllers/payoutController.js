const PayoutInformation = require("../models/PayoutInformation");
const ServiceProvider = require("../models/ServiceProvider");
const Bank = require("../models/Bank");
const Verification = require("../models/Verification");

// Save or update payout information
exports.savePayoutInformation = async (req, res) => {
  try {
    const {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountType,
    } = req.body;

    const providerId = req.user._id;

    // Validation
    if (
      !accountHolderName ||
      !bankName ||
      !accountNumber ||
      !routingNumber
    ) {
      return res.status(400).json({
        success: false,
        message:
          "accountHolderName, bankName, accountNumber, and routingNumber are required",
      });
    }
    const resolvedAccountType =
      accountType && ["checking", "savings"].includes(accountType)
        ? accountType
        : "checking";

    // Validate account number (basic validation)
    if (accountNumber.length < 4) {
      return res.status(400).json({
        success: false,
      message: "Account number must be at least 4 digits",
    });
  }

    // Get provider
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Mask account number for storage (store last 4 digits)
    const lastFourDigits = accountNumber.slice(-4);

    // Create or update payout information
    const payoutInfo = await PayoutInformation.findOneAndUpdate(
      { provider: providerId },
      {
        accountHolderName: accountHolderName.trim(),
        bankName: bankName.trim(),
        bankCode: req.body.bankCode || "",
      accountNumber: accountNumber, // In production, encrypt this field
      routingNumber: routingNumber,
        accountType: resolvedAccountType,
        lastFourDigits: lastFourDigits,
        isVerified: false,
        verificationStatus: "pending",
        isActive: true,
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    // Update provider's payout setup status and mirror payout info on provider
    provider.hasPayoutSetup = true;
    provider.payoutInformation = {
      accountHolderName: accountHolderName.trim(),
      bankName: bankName.trim(),
      bankCode: req.body.bankCode || "",
      accountNumber: accountNumber,
      routingNumber: routingNumber,
      accountType: resolvedAccountType,
      lastFourDigits: lastFourDigits,
      verificationStatus: "pending",
      isVerified: false,
      isActive: true,
      updatedAt: new Date(),
    };
    await provider.save();

    // Return response with masked account number
    const responseData = {
      ...payoutInfo.toObject(),
      accountNumber: payoutInfo.getMaskedAccountNumber(),
    };

    res.status(200).json({
      success: true,
      message: "Payout information saved successfully",
      data: {
        payoutInformation: responseData,
      },
    });
  } catch (error) {
    console.error("Save payout information error:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to save payout information",
      error: error.message,
    });
  }
};

// Update payout information (requires provider verification complete)
exports.updatePayoutInformation = async (req, res) => {
  try {
    const {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountType,
    } = req.body;

    const providerId = req.user._id;

    // Ensure provider is verified before allowing edits
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    const requiredMissing = [];
    if (!accountHolderName) requiredMissing.push("accountHolderName");
    if (!bankName) requiredMissing.push("bankName");
    if (!accountNumber) requiredMissing.push("accountNumber");
    if (!routingNumber) requiredMissing.push("routingNumber");
    if (requiredMissing.length) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        missing: requiredMissing,
      });
    }

    if (accountNumber.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Account number must be at least 4 digits",
      });
    }

    const payoutInfo = await PayoutInformation.findOne({
      provider: providerId,
      isActive: true,
    });

    if (!payoutInfo) {
      return res.status(404).json({
        success: false,
        message: "No payout information found to update",
      });
    }

    const lastFourDigits = accountNumber.slice(-4);
    const resolvedAccountType =
      accountType && ["checking", "savings"].includes(accountType)
        ? accountType
        : payoutInfo.accountType || "checking";

    payoutInfo.accountHolderName = accountHolderName.trim();
    payoutInfo.bankName = bankName.trim();
    payoutInfo.bankCode = req.body.bankCode || payoutInfo.bankCode || "";
    payoutInfo.accountNumber = accountNumber;
    payoutInfo.routingNumber = routingNumber;
    payoutInfo.accountType = resolvedAccountType;
    payoutInfo.lastFourDigits = lastFourDigits;

    // Any update requires re-verification
    payoutInfo.verificationStatus = "pending";
    payoutInfo.isVerified = false;
    payoutInfo.verificationNotes =
      "Updated by provider; requires admin re-verification";

    // Mark provider as needing verification again
    provider.isVerified = false;

    // Reset latest verification request to pending so it shows to admin
    const latestVerification = await Verification.findOne({
      provider: providerId,
    }).sort({ createdAt: -1 });

    if (latestVerification) {
      latestVerification.status = "pending";
      latestVerification.reviewedBy = undefined;
      latestVerification.reviewedAt = undefined;
      latestVerification.rejectionReason = undefined;
      await latestVerification.save();
    }

    provider.payoutInformation = {
      accountHolderName: payoutInfo.accountHolderName,
      bankName: payoutInfo.bankName,
      bankCode: payoutInfo.bankCode,
      accountNumber: payoutInfo.accountNumber,
      routingNumber: payoutInfo.routingNumber,
      accountType: payoutInfo.accountType,
      lastFourDigits: payoutInfo.lastFourDigits,
      verificationStatus: payoutInfo.verificationStatus,
      isVerified: payoutInfo.isVerified,
      isActive: payoutInfo.isActive,
      updatedAt: new Date(),
    };

    await provider.save();
    await payoutInfo.save();

    res.json({
      success: true,
      message: "Payout information updated successfully",
      data: {
        payoutInformation: {
          ...payoutInfo.toObject(),
          accountNumber: payoutInfo.getMaskedAccountNumber(),
        },
      },
    });
  } catch (error) {
    console.error("Update payout information error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payout information",
      error: error.message,
    });
  }
};

// Get payout information
exports.getPayoutInformation = async (req, res) => {
  try {
    const providerId = req.user._id;

    const payoutInfo = await PayoutInformation.findOne({
      provider: providerId,
      isActive: true,
    });

    if (!payoutInfo) {
      return res.status(404).json({
        success: false,
        message: "No payout information found",
      });
    }

    // Return masked account number for security
    const responseData = {
      ...payoutInfo.toObject(),
      accountNumber: payoutInfo.getMaskedAccountNumber(),
    };

    res.json({
      success: true,
      data: {
        payoutInformation: responseData,
      },
    });
  } catch (error) {
    console.error("Get payout information error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payout information",
      error: error.message,
    });
  }
};

// Delete payout information
exports.deletePayoutInformation = async (req, res) => {
  try {
    const providerId = req.user._id;

    const payoutInfo = await PayoutInformation.findOneAndUpdate(
      { provider: providerId },
      {
        isActive: false,
        verificationStatus: "pending",
        isVerified: false,
      },
      { new: true }
    );

    if (!payoutInfo) {
      return res.status(404).json({
        success: false,
        message: "No payout information found to delete",
      });
    }

    // Update provider's payout setup status and clear mirrored payout info
    await ServiceProvider.findByIdAndUpdate(providerId, {
      hasPayoutSetup: false,
      payoutInformation: null,
    });

    res.json({
      success: true,
      message: "Payout information deleted successfully",
    });
  } catch (error) {
    console.error("Delete payout information error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete payout information",
      error: error.message,
    });
  }
};

// Verify payout information (Admin only)
exports.verifyPayoutInformation = async (req, res) => {
  try {
    const { payoutInfoId } = req.params;
    const { status, notes } = req.body;

    if (!["verified", "failed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "verified" or "failed"',
      });
    }

    const payoutInfo = await PayoutInformation.findByIdAndUpdate(
      payoutInfoId,
      {
        verificationStatus: status,
        isVerified: status === "verified",
        verificationNotes: notes,
        verifiedAt: new Date(),
        verifiedBy: req.user._id,
      },
      { new: true }
    ).populate("provider", "businessNameRegistered email");

    if (!payoutInfo) {
      return res.status(404).json({
        success: false,
        message: "Payout information not found",
      });
    }

    res.json({
      success: true,
      message: `Payout information ${status} successfully`,
      data: {
        payoutInformation: payoutInfo,
      },
    });
  } catch (error) {
    console.error("Verify payout information error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payout information",
      error: error.message,
    });
  }
};

// Get payout information status
exports.getPayoutStatus = async (req, res) => {
  try {
    const providerId = req.user._id;

    const payoutInfo = await PayoutInformation.findOne({
      provider: providerId,
    }).select("verificationStatus isVerified isActive");

    const provider = await ServiceProvider.findById(providerId).select(
      "hasPayoutSetup"
    );

    res.json({
      success: true,
      data: {
        hasPayoutSetup: provider?.hasPayoutSetup || false,
        payoutStatus: payoutInfo
          ? {
              verificationStatus: payoutInfo.verificationStatus,
              isVerified: payoutInfo.isVerified,
              isActive: payoutInfo.isActive,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Get payout status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payout status",
      error: error.message,
    });
  }
};
