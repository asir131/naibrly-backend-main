const mongoose = require("mongoose");

const moneyRequestSchema = new mongoose.Schema(
  {
    // Reference to either service request or bundle
    serviceRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
    },
    bundle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bundle",
    },

    // Provider who is requesting money
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      required: true,
    },

    // Customer who needs to pay
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    // Amount requested
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Tip amount (added by customer)
    tipAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total amount (amount + tip)
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Description of the request
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Status of the money request
    status: {
      type: String,
      enum: ["pending", "accepted", "paid", "cancelled", "disputed", "failed"],
      default: "pending",
    },

    // Payment details (filled when paid)
    paymentDetails: {
      paymentMethod: {
        type: String,
        enum: ["card", "cash", "bank_transfer"],
        default: "card",
      },
      stripePaymentIntentId: String,
      stripeCustomerId: String,
      cardLast4: String,
      cardBrand: String,
      paidAt: Date,
      transactionId: String,
      notes: String,
    },

    // Dispute details
    disputeDetails: {
      reason: String,
      raisedBy: {
        type: String,
        enum: ["customer", "provider"],
      },
      description: String,
      resolvedAt: Date,
      resolution: String,
    },

    // Commission details
    commission: {
      amount: {
        type: Number,
        default: 0,
      },
      providerAmount: {
        type: Number,
        default: 0,
      },
    },

    // Timestamps for status changes
    statusHistory: [
      {
        status: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        note: String,
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: "statusHistory.changedByRole",
        },
        changedByRole: {
          type: String,
          enum: ["customer", "provider", "admin"],
        },
      },
    ],

    // Due date for payment
    dueDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
moneyRequestSchema.index({ provider: 1, status: 1 });
moneyRequestSchema.index({ customer: 1, status: 1 });
moneyRequestSchema.index({ serviceRequest: 1 });
moneyRequestSchema.index({ bundle: 1 });
moneyRequestSchema.index({ dueDate: 1 });
moneyRequestSchema.index({ createdAt: 1 });

module.exports = mongoose.model("MoneyRequest", moneyRequestSchema);
