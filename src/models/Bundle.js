const mongoose = require("mongoose");

const bundleSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      required: true,
    },
    categoryTypeName: {
      type: String,
      required: true,
    },
    services: [
      {
        name: {
          type: String,
          required: true,
        },
        hourlyRate: {
          type: Number,
          required: true,
        },
        estimatedHours: {
          type: Number,
          default: 1,
        },
      },
    ],
    serviceDate: {
      type: Date,
      required: true,
    },
    serviceTimeStart: {
      type: String,
      required: true,
    },
    serviceTimeEnd: {
      type: String,
      required: true,
    },
    zipCode: {
      type: String,
      required: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      aptSuite: String,
    },
    maxParticipants: {
      type: Number,
      default: 5,
      min: 2,
      max: 10,
    },
    currentParticipants: {
      type: Number,
      default: 1,
    },
    participants: [
      {
        customer: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Customer",
          required: true,
        },
        address: {
          street: String,
          city: String,
          state: String,
          zipCode: String,
          aptSuite: String,
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
        status: {
          type: String,
          enum: ["active", "cancelled"],
          default: "active",
        },
      },
    ],
    // Bundle discount set by admin
    bundleDiscount: {
      type: Number,
      default: 10, // 10% discount
      min: 0,
      max: 50,
    },
    // Status for the bundle itself
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "full",
        "in_progress",
        "completed",
        "cancelled",
        "expired",
      ],
      default: "pending",
    },
    statusHistory: [
      {
        status: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        note: String,
        changedBy: {
          type: String,
          enum: ["customer", "provider", "system"],
          default: "system",
        },
      },
    ],
    pricing: {
      originalPrice: {
        type: Number,
        default: 0,
      },
      discountAmount: {
        type: Number,
        default: 0,
      },
      finalPrice: {
        type: Number,
        default: 0,
      },
      discountPercent: {
        type: Number,
        default: 0,
      },
    },

    // Also store finalPrice at root for easy queries
    finalPrice: {
      type: Number,
      default: 0,
    },

    providerOffers: [
      {
        provider: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ServiceProvider",
        },
        message: String,
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        submittedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    completedAt: {
      type: Date,
    },
    cancelledBy: {
      type: String,
      enum: ["customer", "provider"],
    },
    cancellationReason: String,
    shareToken: {
      type: String,
      unique: true,
      sparse: true,
    },
    reviews: [
      {
        customer: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Customer",
          required: true,
        },
        rating: {
          type: Number,
          min: 1,
          max: 5,
          required: true,
        },
        comment: {
          type: String,
          trim: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Calculate total price for a customer (with discount)
bundleSchema.methods.calculateCustomerPrice = function () {
  const total = this.services.reduce((sum, service) => {
    return sum + service.hourlyRate * service.estimatedHours;
  }, 0);

  const discountAmount = (total * this.bundleDiscount) / 100;
  return {
    originalPrice: total,
    discountAmount: discountAmount,
    finalPrice: total - discountAmount,
    discountPercent: this.bundleDiscount,
  };
};

// Check if bundle has available spots
bundleSchema.methods.hasAvailableSpots = function () {
  return this.currentParticipants < this.maxParticipants;
};

// Check if customer is already in bundle
bundleSchema.methods.isCustomerInBundle = function (customerId) {
  return this.participants.some(
    (participant) =>
      participant.customer.toString() === customerId.toString() &&
      participant.status === "active"
  );
};

bundleSchema.index({ zipCode: 1, status: 1 });
bundleSchema.index({ category: 1, status: 1 });
bundleSchema.index({ "services.name": 1 });
bundleSchema.index({ provider: 1, status: 1 });

module.exports = mongoose.model("Bundle", bundleSchema);
