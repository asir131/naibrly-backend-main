const mongoose = require("mongoose");

const payoutInformationSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      required: true,
      unique: true,
    },
    accountHolderName: {
      type: String,
      required: [true, "Account holder name is required"],
      trim: true,
    },
    bankName: {
      type: String,
      required: [true, "Bank name is required"],
      trim: true,
    },
    bankCode: {
      type: String,
      required: [true, "Bank code is required"],
    },
    accountNumber: {
      type: String,
      required: [true, "Account number is required"],
      trim: true,
    },
    routingNumber: {
      type: String,
      required: [true, "Routing number is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^\d{9}$/.test(v); // US routing numbers are 9 digits
        },
        message: "Routing number must be 9 digits",
      },
    },
    accountType: {
      type: String,
      enum: ["checking", "savings"],
      required: [true, "Account type is required"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending",
    },
    lastFourDigits: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Mask account number for security
payoutInformationSchema.methods.getMaskedAccountNumber = function () {
  if (this.accountNumber && this.accountNumber.length > 4) {
    return "****" + this.accountNumber.slice(-4);
  }
  return this.accountNumber;
};

module.exports = mongoose.model("PayoutInformation", payoutInformationSchema);
