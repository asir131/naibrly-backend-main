const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const customerSchema = new mongoose.Schema(
  {
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
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    googleId: {
      type: String,
      default: "",
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    password: {
      type: String,
      required: function () {
        return this.authProvider !== "google";
      },
      minlength: [6, "Password must be at least 6 characters"],
    },
    phone: {
      type: String,
      required: function () {
        return this.authProvider !== "google";
      },
      trim: true,
      default: "",
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
    address: {
      street: {
        type: String,
        required: function () {
          return this.authProvider !== "google";
        },
        default: "",
      },
      city: {
        type: String,
        required: function () {
          return this.authProvider !== "google";
        },
        default: "",
      },
      state: {
        type: String,
        required: function () {
          return this.authProvider !== "google";
        },
        default: "",
      },
      zipCode: {
        type: String,
        required: function () {
          return this.authProvider !== "google";
        },
        default: "",
      },
      aptSuite: {
        type: String,
        default: "",
      },
    },
    role: {
      type: String,
      default: "customer",
    },
    paymentMethods: [
      {
        type: {
          type: String,
          enum: ["cash", "card", "bank_transfer", "digital_wallet"],
        },
        details: mongoose.Schema.Types.Mixed,
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
    stripeCustomerId: {
      type: String,
      default: "",
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

// Hash password before saving
customerSchema.pre("save", async function (next) {
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
customerSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Customer", customerSchema);
