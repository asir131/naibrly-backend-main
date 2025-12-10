const mongoose = require("mongoose");

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["Unsolved", "Open", "Resolved"],
      default: "Unsolved",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },
    category: {
      type: String,
      enum: [
        "Technical Issue",
        "Account",
        "Payment",
        "Service Request",
        "General Inquiry",
        "Bug Report",
        "Feature Request",
        "Other",
      ],
      default: "General Inquiry",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "userModel",
    },
    userModel: {
      type: String,
      enum: ["Customer", "ServiceProvider"],
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    solvedDate: {
      type: Date,
    },
    attachments: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    replies: [
      {
        message: {
          type: String,
          required: true,
        },
        repliedBy: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: "replies.repliedByModel",
        },
        repliedByModel: {
          type: String,
          enum: ["Admin", "Customer", "ServiceProvider"],
        },
        repliedByName: String,
        repliedByEmail: String,
        isAdmin: {
          type: Boolean,
          default: false,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    tags: [String],
    notes: {
      type: String,
      trim: true,
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
  }
);

// Generate unique ticket ID before saving
supportTicketSchema.pre("save", async function (next) {
  if (!this.ticketId) {
    // Generate ticket ID like ADG39, ADG40, etc.
    const prefix = "ADG";

    // Find the last ticket to get the next number
    const lastTicket = await this.constructor
      .findOne({}, { ticketId: 1 })
      .sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastTicket && lastTicket.ticketId) {
      const lastNumber = parseInt(lastTicket.ticketId.replace(prefix, ""));
      nextNumber = lastNumber + 1;
    }

    this.ticketId = `${prefix}${nextNumber}`;
  }
  next();
});

// Update solvedDate when status changes to Resolved
supportTicketSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "Resolved") {
    this.solvedDate = new Date();
  }
  next();
});

// Indexes for better query performance
supportTicketSchema.index({ ticketId: 1 });
supportTicketSchema.index({ email: 1 });
supportTicketSchema.index({ status: 1 });
supportTicketSchema.index({ createdAt: -1 });
supportTicketSchema.index({ user: 1 });

const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);

module.exports = SupportTicket;
