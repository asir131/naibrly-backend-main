const mongoose = require("mongoose");

const verificationSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      required: true,
    },
    einNumber: {
      type: String,
      required: [true, "EIN Number is required"],
      trim: true,
    },
    businessRegisteredCountry: {
      type: String,
      required: [true, "Business registered country is required"],
      trim: true,
    },
    insuranceDocument: {
      url: {
        type: String,
        required: false,
      },
      publicId: {
        type: String,
        required: false,
      },
    },
    // 🆕 NEW: ID Card Front Image
    idCardFront: {
      url: {
        type: String,
        required: false,
      },
      publicId: {
        type: String,
        required: false,
      },
    },
    // 🆕 NEW: ID Card Back Image
    idCardBack: {
      url: {
        type: String,
        required: false,
      },
      publicId: {
        type: String,
        required: false,
      },
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Verification", verificationSchema);
