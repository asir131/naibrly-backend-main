const CommissionSettings = require("../models/CommissionSettings");
const ServiceRequest = require("../models/ServiceRequest");
const Bundle = require("../models/Bundle");

// Initialize default commission settings
const initializeCommissionSettings = async () => {
  try {
    const existingSettings = await CommissionSettings.findOne();
    if (!existingSettings) {
      const settings = new CommissionSettings();
      await settings.save();
      console.log("✅ Commission settings initialized with 5% default");
    }
  } catch (error) {
    console.error("❌ Commission settings initialization error:", error);
  }
};

// Get commission settings
exports.getCommissionSettings = async (req, res) => {
  try {
    const settings = await CommissionSettings.findOne();

    res.json({
      success: true,
      data: { settings },
    });
  } catch (error) {
    console.error("Get commission settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch commission settings",
      error: error.message,
    });
  }
};

// Update commission settings (Admin only)
exports.updateCommissionSettings = async (req, res) => {
  try {
    const { serviceCommission, bundleCommission } = req.body;

    // Validate input
    if (serviceCommission === undefined && bundleCommission === undefined) {
      return res.status(400).json({
        success: false,
        message: "At least one commission value is required",
      });
    }

    if (
      serviceCommission !== undefined &&
      (serviceCommission < 0 || serviceCommission > 50)
    ) {
      return res.status(400).json({
        success: false,
        message: "Service commission must be between 0% and 50%",
      });
    }

    if (
      bundleCommission !== undefined &&
      (bundleCommission < 0 || bundleCommission > 50)
    ) {
      return res.status(400).json({
        success: false,
        message: "Bundle commission must be between 0% and 50%",
      });
    }

    let settings = await CommissionSettings.findOne();

    if (!settings) {
      settings = new CommissionSettings();
    }

    // Update only provided fields
    if (serviceCommission !== undefined) {
      settings.serviceCommission = serviceCommission;
    }
    if (bundleCommission !== undefined) {
      settings.bundleCommission = bundleCommission;
    }

    settings.updatedBy = req.user._id;
    await settings.save();

    res.json({
      success: true,
      message: "Commission settings updated successfully",
      data: { settings },
    });
  } catch (error) {
    console.error("Update commission settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update commission settings",
      error: error.message,
    });
  }
};

// Calculate commission for a service request
exports.calculateServiceCommission = async (totalAmount) => {
  try {
    const settings = await CommissionSettings.findOne();
    const commissionRate = settings?.serviceCommission || 5;

    const commissionAmount = (totalAmount * commissionRate) / 100;
    const providerAmount = totalAmount - commissionAmount;

    return {
      commissionRate,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      providerAmount: Math.round(providerAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  } catch (error) {
    console.error("Calculate service commission error:", error);
    // Return default 5% if calculation fails
    const commissionAmount = (totalAmount * 5) / 100;
    const providerAmount = totalAmount - commissionAmount;

    return {
      commissionRate: 5,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      providerAmount: Math.round(providerAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }
};

// Calculate commission for a bundle
exports.calculateBundleCommission = async (totalAmount) => {
  try {
    const settings = await CommissionSettings.findOne();
    const commissionRate = settings?.bundleCommission || 5;

    const commissionAmount = (totalAmount * commissionRate) / 100;
    const providerAmount = totalAmount - commissionAmount;

    return {
      commissionRate,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      providerAmount: Math.round(providerAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  } catch (error) {
    console.error("Calculate bundle commission error:", error);
    // Return default 5% if calculation fails
    const commissionAmount = (totalAmount * 5) / 100;
    const providerAmount = totalAmount - commissionAmount;

    return {
      commissionRate: 5,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      providerAmount: Math.round(providerAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }
};

// Get commission earnings report (Admin only)
exports.getCommissionEarnings = async (req, res) => {
  try {
    const { startDate, endDate, type } = req.query;

    let filter = { status: "completed" };

    // Date range filter
    if (startDate || endDate) {
      filter.completedAt = {};
      if (startDate) filter.completedAt.$gte = new Date(startDate);
      if (endDate) filter.completedAt.$lte = new Date(endDate);
    }

    let serviceEarnings = 0;
    let bundleEarnings = 0;
    let totalEarnings = 0;

    // Calculate service commissions
    if (!type || type === "service") {
      const completedServices = await ServiceRequest.find({
        ...filter,
        status: "completed",
      }).select("price completedAt");

      for (const service of completedServices) {
        const commission = await exports.calculateServiceCommission(
          service.price
        );
        serviceEarnings += commission.commissionAmount;
      }
    }

    // Calculate bundle commissions
    if (!type || type === "bundle") {
      const completedBundles = await Bundle.find({
        ...filter,
        status: "completed",
      }).select("finalPrice completedAt");

      for (const bundle of completedBundles) {
        const commission = await exports.calculateBundleCommission(
          bundle.finalPrice
        );
        bundleEarnings += commission.commissionAmount;
      }
    }

    totalEarnings = serviceEarnings + bundleEarnings;

    const settings = await CommissionSettings.findOne();

    res.json({
      success: true,
      data: {
        earnings: {
          serviceEarnings: Math.round(serviceEarnings * 100) / 100,
          bundleEarnings: Math.round(bundleEarnings * 100) / 100,
          totalEarnings: Math.round(totalEarnings * 100) / 100,
        },
        currentRates: {
          serviceCommission: settings?.serviceCommission || 5,
          bundleCommission: settings?.bundleCommission || 5,
        },
        dateRange: {
          startDate: startDate || "All time",
          endDate: endDate || "All time",
        },
      },
    });
  } catch (error) {
    console.error("Get commission earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch commission earnings",
      error: error.message,
    });
  }
};

exports.initializeCommissionSettings = initializeCommissionSettings;
