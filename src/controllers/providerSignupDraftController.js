const ProviderSignupDraft = require("../models/ProviderSignupDraft");

const normalizeEmail = (email) =>
  (email || "").toString().trim().toLowerCase();

exports.saveProviderSignupDraft = async (req, res) => {
  try {
    const { email, data } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required to save draft",
      });
    }

    const updated = await ProviderSignupDraft.findOneAndUpdate(
      { email: normalizedEmail },
      { data: data || {} },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({
      success: true,
      message: "Draft saved",
      data: {
        email: updated.email,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Save provider signup draft error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save draft",
      error: error.message,
    });
  }
};

exports.getProviderSignupDraft = async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required to fetch draft",
      });
    }

    const draft = await ProviderSignupDraft.findOne({ email }).lean();
    if (!draft) {
      return res.status(404).json({
        success: false,
        message: "Draft not found",
      });
    }

    return res.json({
      success: true,
      data: {
        email: draft.email,
        data: draft.data || {},
        updatedAt: draft.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get provider signup draft error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch draft",
      error: error.message,
    });
  }
};

exports.clearProviderSignupDraft = async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required to clear draft",
      });
    }

    await ProviderSignupDraft.deleteOne({ email });
    return res.json({
      success: true,
      message: "Draft cleared",
    });
  } catch (error) {
    console.error("Clear provider signup draft error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear draft",
      error: error.message,
    });
  }
};
