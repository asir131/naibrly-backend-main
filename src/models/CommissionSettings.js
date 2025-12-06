const mongoose = require("mongoose");

const commissionSettingsSchema = new mongoose.Schema(
  {
    serviceCommission: {
      type: Number,
      default: 5,
      min: 0,
      max: 50,
      required: true,
    },
    bundleCommission: {
      type: Number,
      default: 5,
      min: 0,
      max: 50,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("CommissionSettings", commissionSettingsSchema);
