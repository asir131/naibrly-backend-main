const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      unique: true,
    },
    categoryType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CategoryType",
      required: [true, "Category type is required"],
    },
    description: {
      type: String,
      default: "",
    },
    defaultHourlyRate: {
      type: Number,
      default: 50, // Default hourly rate for this service
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Service", serviceSchema);
