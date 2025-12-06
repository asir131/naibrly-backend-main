const mongoose = require("mongoose");

const providerServiceFeedbackSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    serviceName: {
      type: String,
      required: true,
      trim: true,
      index: true,
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
      default: "",
    },
  },
  { timestamps: true }
);

providerServiceFeedbackSchema.index({ provider: 1, serviceName: 1, createdAt: -1 });

module.exports = mongoose.model(
  "ProviderServiceFeedback",
  providerServiceFeedbackSchema
);
