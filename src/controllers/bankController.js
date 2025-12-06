const Bank = require("../models/Bank");
const popularUSBanks = require("../config/banksData");

// Initialize banks data
exports.initializeBanks = async () => {
  try {
    console.log("🔄 Initializing US banks data...");

    for (const bankData of popularUSBanks) {
      await Bank.findOneAndUpdate({ code: bankData.code }, bankData, {
        upsert: true,
        new: true,
      });
    }

    console.log("✅ US banks data initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing banks data:", error);
  }
};

// Get all active banks
exports.getAllBanks = async (req, res) => {
  try {
    const banks = await Bank.find({ isActive: true })
      .select("name code routingNumber")
      .sort({ name: 1 });

    res.json({
      success: true,
      data: { banks },
      total: banks.length,
    });
  } catch (error) {
    console.error("Get banks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch banks",
      error: error.message,
    });
  }
};

// Search banks by name
exports.searchBanks = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: { banks: [] },
      });
    }

    const banks = await Bank.find({
      name: { $regex: query, $options: "i" },
      isActive: true,
    })
      .select("name code routingNumber")
      .limit(10)
      .sort({ name: 1 });

    res.json({
      success: true,
      data: { banks },
    });
  } catch (error) {
    console.error("Search banks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search banks",
      error: error.message,
    });
  }
};
