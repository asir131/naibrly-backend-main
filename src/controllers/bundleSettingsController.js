const BundleSettings = require("../models/BundleSettings");

// Get bundle settings
exports.getBundleSettings = async (req, res) => {
  try {
    const settings = await BundleSettings.findOne();

    res.json({
      success: true,
      data: { settings },
    });
  } catch (error) {
    console.error("Get bundle settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bundle settings",
      error: error.message,
    });
  }
};

// Update bundle discount (Admin only)
exports.updateBundleDiscount = async (req, res) => {
  try {
    const { bundleDiscount } = req.body;

    if (bundleDiscount === undefined) {
      return res.status(400).json({
        success: false,
        message: "Bundle discount is required",
      });
    }

    if (bundleDiscount < 0 || bundleDiscount > 50) {
      return res.status(400).json({
        success: false,
        message: "Bundle discount must be between 0% and 50%",
      });
    }

    let settings = await BundleSettings.findOne();

    if (!settings) {
      settings = new BundleSettings();
    }

    settings.bundleDiscount = bundleDiscount;
    settings.updatedBy = req.user._id;

    await settings.save();

    res.json({
      success: true,
      message: `Global bundlee discount updated to ${bundleDiscount}% successfully`,
      data: { settings },
    });
  } catch (error) {
    console.error("Update bundle discount error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update bundle discount",
      error: error.message,
    });
  }
};
