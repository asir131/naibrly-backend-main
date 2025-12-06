const mongoose = require("mongoose");

const serviceRequestSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    customerName: {
      firstName: { type: String, default: "" },
      lastName: { type: String, default: "" },
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      required: true,
    },
    serviceType: {
      type: String,
      required: true,
      trim: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: false,
    },
    // NEW FIELD: Store all requested services
    requestedServices: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "completed", "cancelled"],
          default: "pending",
        },
        price: {
          type: Number,
          default: 0,
        },
        estimatedHours: {
          type: Number,
          default: 1,
        },
        completedAt: {
          type: Date,
        },
      },
    ],
    locationInfo: {
      customerZipCode: {
        type: String,
        required: true,
      },
      customerAddress: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        aptSuite: String,
      },
    },
    problem: {
      type: String,
      required: [true, "Problem description is required"],
      trim: true,
      minlength: [10, "Problem description should be at least 10 characters"],
      maxlength: [500, "Problem description should not exceed 500 characters"],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [200, "Note should not exceed 200 characters"],
    },
    scheduledDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "completed", "cancelled"],
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
    price: {
      type: Number,
      default: 0,
    },
    estimatedHours: {
      type: Number,
      default: 1,
    },
    // Commission fields
    commission: {
      rate: {
        type: Number,
        default: 5,
      },
      amount: {
        type: Number,
        default: 0,
      },
      providerAmount: {
        type: Number,
        default: 0,
      },
    },
    providerNotes: {
      type: String,
      default: "",
    },
    review: {
      rating: {
        type: Number,
        min: 1,
        max: 5,
      },
      comment: String,
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
    cancelledBy: {
      type: String,
      enum: ["customer", "provider"],
    },
    cancellationReason: String,
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Enhanced pre-save middleware for status tracking
serviceRequestSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    let note = "";
    let changedBy = "system";

    if (this.status === "cancelled") {
      note = this.cancellationReason || "No reason provided";
      changedBy = this.cancelledBy || "system";
    } else if (this.status === "completed") {
      note = "Service completed by provider";
      changedBy = "provider";
      this.completedAt = new Date();
    } else if (this.status === "accepted") {
      note = "Service accepted by provider";
      changedBy = "provider";
    }

    this.statusHistory.push({
      status: this.status,
      note: note,
      changedBy: changedBy,
      timestamp: new Date(),
    });
  }
  next();
});

// Index for better performance
serviceRequestSchema.index({ provider: 1, status: 1 });
serviceRequestSchema.index({ customer: 1, status: 1 });
serviceRequestSchema.index({ scheduledDate: 1 });

module.exports = mongoose.model("ServiceRequest", serviceRequestSchema);
