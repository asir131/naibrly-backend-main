const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const serviceProviderSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      default: "",
    },
    lastName: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
    },
    profileImage: {
      url: {
        type: String,
        default: "https://placehold.co/200x200?text=Profile",
      },
      publicId: {
        type: String,
        default: "placeholder_profile",
      },
    },
    businessLogo: {
      url: {
        type: String,
        default: "https://placehold.co/240x240?text=Logo",
      },
      publicId: {
        type: String,
        default: "placeholder_logo",
      },
    },
    businessNameRegistered: {
      type: String,
      required: [true, "Registered business name is required"],
      trim: true,
    },
    businessNameDBA: {
      type: String,
      trim: true,
    },
    providerRole: {
      type: String,
      enum: ["owner", "manager", "employee"],
      required: [true, "Provider role is required"],
    },
    businessAddress: {
      street: {
        type: String,
        default: "",
      },
      city: {
        type: String,
        default: "",
      },
      state: {
        type: String,
        default: "",
      },
      zipCode: {
        type: String,
        default: "",
      },
    },
    hasPayoutSetup: {
      type: Boolean,
      default: false,
    },
    payoutInformation: {
      accountHolderName: {
        type: String,
        default: "",
      },
      bankName: {
        type: String,
        default: "",
      },
      bankCode: {
        type: String,
        default: "",
      },
      accountNumber: {
        type: String,
        default: "",
      },
      routingNumber: {
        type: String,
        default: "",
      },
      accountType: {
        type: String,
        enum: ["checking", "savings", ""],
        default: "",
      },
      lastFourDigits: {
        type: String,
        default: "",
      },
      verificationStatus: {
        type: String,
        default: "pending",
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
      isActive: {
        type: Boolean,
        default: false,
      },
      updatedAt: {
        type: Date,
      },
    },
    // NEW: Multiple service areas
    serviceAreas: [
      {
        zipCode: {
          type: String,
          required: true,
          trim: true,
        },
        city: {
          type: String,
          trim: true,
        },
        state: {
          type: String,
          trim: true,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    website: {
      type: String,
      default: "",
    },
    servicesProvided: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        hourlyRate: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],
    description: {
      type: String,
      maxlength: 500,
    },
    experience: {
      type: Number,
      min: 0,
    },
    maxBundleCapacity: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
      required: true,
    },
    paymentSettings: {
      preferredPaymentMethods: [String],
      bankAccount: {
        accountHolder: String,
        accountNumber: String,
        bankName: String,
        routingNumber: String,
      },
      taxId: String,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    pendingEarnings: {
      type: Number,
      default: 0,
    },
    // Balances for payouts
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    pendingPayout: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    pendingEarnings: {
      type: Number,
      default: 0,
    },
    stripeAccountId: {
      type: String,
      default: "",
    },
    businessServiceDays: {
      start: {
        type: String,
        enum: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
        required: true,
      },
      end: {
        type: String,
        enum: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
        required: true,
      },
    },
    businessHours: {
      start: {
        type: String,
        required: true,
      },
      end: {
        type: String,
        required: true,
      },
    },
    hourlyRate: {
      type: Number,
      min: 0,
      default: 0,
    },
    servicePricing: {
      type: Map,
      of: Number,
      default: {},
    },
    isApproved: {
      type: Boolean,
      default: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    totalJobsCompleted: {
      type: Number,
      default: 0,
    },
    documents: [
      {
        name: String,
        url: String,
        verified: {
          type: Boolean,
          default: false,
        },
      },
    ],
    approvalNotes: {
      type: String,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    role: {
      type: String,
      default: "provider",
      immutable: true,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
serviceProviderSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
serviceProviderSchema.methods.comparePassword = async function (
  candidatePassword
) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Index for service areas search
serviceProviderSchema.index({ "serviceAreas.zipCode": 1 });

module.exports = mongoose.model("ServiceProvider", serviceProviderSchema);
