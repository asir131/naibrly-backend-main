const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const mongoose = require("mongoose");
const MoneyRequest = require("../models/MoneyRequest");
const ServiceRequest = require("../models/ServiceRequest");
const Bundle = require("../models/Bundle");
const ServiceProvider = require("../models/ServiceProvider");
const Customer = require("../models/Customer");
const {
  calculateServiceCommission,
  calculateBundleCommission,
} = require("./commissionController");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const { emitToUser } = require("../socket");
const Notification = require("../models/Notification");

// Build and send realtime notification via Socket.IO
const buildMoneyNotification = ({
  title,
  body,
  serviceRequestId,
  bundleId,
  recipientRole,
  customerId,
}) => {
  let link = "/conversation";
  const idPart = serviceRequestId || bundleId;

  if (recipientRole === "provider" && idPart && customerId) {
    link = `/provider/signup/message/${idPart}-${customerId}`;
  } else if (serviceRequestId) {
    link = `/conversation/request-${serviceRequestId}`;
  } else if (bundleId) {
    link = `/conversation/bundle-${bundleId}`;
  }

  return {
    id: new Date().getTime().toString(),
    title: title || "Money request update",
    body: body || "",
    link,
    createdAt: new Date().toISOString(),
    isRead: false,
  };
};

const sendMoneyNotification = async ({
  userId,
  title,
  body,
  serviceRequestId,
  bundleId,
  recipientRole,
  customerId,
}) => {
  if (!userId) return;
  const payload = buildMoneyNotification({
    title,
    body,
    serviceRequestId,
    bundleId,
    recipientRole,
    customerId,
  });
  emitToUser(userId, "message", { type: "notification", data: payload });
  // persist for offline users
  try {
    await Notification.create({
      user: userId,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      isRead: false,
      createdAt: payload.createdAt || new Date(),
    });
  } catch (err) {
    console.error("persist money notification error:", err.message);
  }
};

const createMoneyRequest = async (req, res) => {
  try {
    const {
      serviceRequestId,
      bundleId,
      amount,
      description,
      dueDate,
      customerId,
    } = req.body;
    const providerId = req.user._id;

    console.log("Creating money request with data:", {
      serviceRequestId,
      bundleId,
      amount,
      providerId,
    });

    // Validate input
    if ((!serviceRequestId && !bundleId) || !amount) {
      return res.status(400).json({
        success: false,
        message: "Either serviceRequestId or bundleId and amount are required",
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    let serviceRequest,
      bundle,
      customerIds = [];
    let finalAmount = amount;

    // Check if it's a service request
    if (serviceRequestId) {
      serviceRequest = await ServiceRequest.findOne({
        _id: serviceRequestId,
        provider: providerId,
        status: "completed",
      }).populate("customer");

      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message:
            "Completed service request not found or you are not the provider",
        });
      }

      customerIds = [serviceRequest.customer._id];

      // Check if money request already exists for this service
      const existingRequest = await MoneyRequest.findOne({
        serviceRequest: serviceRequestId,
        status: { $in: ["pending", "accepted", "paid"] },
      });

      if (existingRequest) {
        return res.status(400).json({
          success: false,
          message: "Money request already exists for this service",
        });
      }
    }

    // Check if it's a bundle
    if (bundleId) {
      bundle = await Bundle.findOne({
        _id: bundleId,
        provider: providerId,
      })
        .populate("participants.customer", "firstName lastName email phone")
        .populate("creator", "firstName lastName email phone");

      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: "Bundle not found or you are not the provider",
        });
      }

      if (["cancelled", "expired"].includes(bundle.status)) {
        return res.status(400).json({
          success: false,
          message: "Bundle is not eligible for payment requests",
        });
      }

      // Get all active participants including the creator
      const activeParticipants = bundle.participants.filter(
        (participant) => participant.status === "active"
      );

      // Add creator to the list if not already included
      if (
        bundle.creator &&
        !activeParticipants.find(
          (p) => p.customer._id.toString() === bundle.creator._id.toString()
        )
      ) {
        customerIds = [
          bundle.creator._id,
          ...activeParticipants.map((p) => p.customer._id),
        ];
      } else {
        customerIds = activeParticipants.map((p) => p.customer._id);
      }

      console.log(
        `Found ${customerIds.length} customers for bundle:`,
        customerIds
      );

      if (customerId) {
        const participantEntry = bundle.participants.find((participant) => {
          const participantId =
            participant.customer?._id || participant.customer;
          return (
            participantId?.toString() === customerId.toString() &&
            participant.status === "active"
          );
        });

        if (!participantEntry) {
          return res.status(400).json({
            success: false,
            message: "Customer is not an active participant in this bundle",
          });
        }

        if (participantEntry.completionStatus !== "completed") {
          return res.status(400).json({
            success: false,
            message: "Participant is not marked completed yet",
          });
        }

        customerIds = [customerId];
      } else if (bundle.status !== "completed") {
        return res.status(400).json({
          success: false,
          message:
            "Bundle is not completed. Provide customerId to request payment for a single participant.",
        });
      }

      // Apply bundle discount to get final amount
      if (bundle.bundleDiscount && bundle.bundleDiscount > 0) {
        finalAmount = amount - (amount * bundle.bundleDiscount) / 100;
        console.log(
          `Applied ${bundle.bundleDiscount}% discount: Original amount: ${amount}, Final amount: ${finalAmount}`
        );
      }

      // Check if money requests already exist for targeted participant(s)
      const existingRequests = await MoneyRequest.find({
        bundle: bundleId,
        customer: { $in: customerIds },
        status: { $in: ["pending", "accepted", "paid"] },
      });

      if (existingRequests.length > 0) {
        const existingCustomerIds = existingRequests.map((req) =>
          req.customer.toString()
        );
        return res.status(400).json({
          success: false,
          message: `Money requests already exist for some participants in this bundle. Customers with existing requests: ${existingCustomerIds.join(
            ", "
          )}`,
          existingCustomers: existingCustomerIds,
        });
      }
    }

    // Calculate commission based on service or bundle using the final amount
    let commission;
    if (serviceRequest) {
      commission = await calculateServiceCommission(finalAmount);
    } else if (bundle) {
      commission = await calculateBundleCommission(finalAmount);
    }

    console.log("Commission calculated:", commission);

    // Create money requests for all customers
    const moneyRequests = [];

    for (const customerId of customerIds) {
      const moneyRequestData = {
        serviceRequest: serviceRequestId,
        bundle: bundleId,
        provider: providerId,
        customer: customerId,
        amount: finalAmount, // Use the final amount after discount
        totalAmount: finalAmount, // Use the final amount after discount
        description:
          description || `Payment for ${serviceRequest ? "service" : "bundle"}`,
        dueDate: dueDate
          ? new Date(dueDate)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        commission: {
          rate: commission.commissionRate,
          amount: commission.commissionAmount,
          providerAmount: commission.providerAmount,
        },
        // Store original amount and discount info for bundles
        ...(bundleId && {
          originalAmount: amount,
          discount: bundle.bundleDiscount || 0,
          discountType: "percentage",
        }),
        // Set status change info
        _statusChangedBy: providerId,
        _statusChangedByRole: "provider",
      };

      // For bundles, add bundle-specific description
      if (bundleId) {
        const discountText = bundle.bundleDiscount
          ? ` with ${bundle.bundleDiscount}% discount applied`
          : "";
        moneyRequestData.description = `Payment for bundle${discountText} (${customerIds.length} participants)`;
      }

      const moneyRequest = new MoneyRequest(moneyRequestData);
      const savedRequest = await moneyRequest.save();

      // Populate the saved request
      await savedRequest.populate([
        { path: "customer", select: "firstName lastName email phone" },
        { path: "provider", select: "businessNameRegistered email phone" },
        { path: "serviceRequest", select: "serviceType scheduledDate" },
        { path: "bundle", select: "title category bundleDiscount" },
      ]);

      // Notify customer about the money request
      sendMoneyNotification({
        userId: customerId,
        recipientRole: "customer",
        serviceRequestId,
        bundleId,
        customerId,
        title: "Payment requested",
        body: `Payment of $${finalAmount} requested`,
      });

      // Realtime socket ping so customer UI refetches money requests
      const systemMessage = {
        _id: new mongoose.Types.ObjectId(),
        senderId: providerId,
        senderRole: "provider",
        content: "__MONEY_REQUEST__",
        timestamp: new Date(),
        meta: {
          moneyRequestId: savedRequest._id,
          amount: finalAmount,
          serviceRequestId,
          bundleId,
        },
      };
      emitToUser(customerId, "message", {
        type: "new_message",
        data: { message: systemMessage },
      });

      // Emit dedicated money request event so UI can react immediately
      emitToUser(customerId, "message", {
        type: "money_request_created",
        data: {
          moneyRequestId: savedRequest._id,
          amount: finalAmount,
          serviceRequestId,
          bundleId,
          providerId,
          status: savedRequest.status,
        },
      });

      moneyRequests.push(savedRequest);
    }

    console.log(`Created ${moneyRequests.length} money requests successfully`);
    console.log(
      `Each customer pays: $${finalAmount}${
        bundleId && bundle.bundleDiscount
          ? ` (after ${bundle.bundleDiscount}% discount from $${amount})`
          : ""
      }`
    );

    res.status(201).json({
      success: true,
      message: `Money requests created successfully for ${moneyRequests.length} customer(s)`,
      data: {
        moneyRequests: moneyRequests,
        totalCreated: moneyRequests.length,
        bundleDiscount: bundleId ? bundle.bundleDiscount : undefined,
        originalAmount: bundleId ? amount : undefined,
        finalAmount: bundleId ? finalAmount : undefined,
      },
    });
  } catch (error) {
    console.error("Create money request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create money requests",
      error: error.message,
    });
  }
};

// Customer accepts money request and adds tip
const acceptMoneyRequest = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const { tipAmount } = req.body;
    const customerId = req.user._id;

    console.log("Accepting money request:", {
      moneyRequestId,
      tipAmount,
      customerId,
    });

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      customer: customerId,
      status: "pending",
    });

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Pending money request not found or you are not the customer",
      });
    }

    if (tipAmount && tipAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Tip amount cannot be negative",
      });
    }

    moneyRequest.tipAmount = tipAmount || 0;
    moneyRequest.totalAmount = moneyRequest.amount + moneyRequest.tipAmount;
    moneyRequest.status = "accepted";

    const commission = await calculateServiceCommission(
      moneyRequest.totalAmount
    );
    moneyRequest.commission.amount = commission.commissionAmount;
    moneyRequest.commission.providerAmount = commission.providerAmount;

    moneyRequest._statusChangedBy = customerId;
    moneyRequest._statusChangedByRole = "customer";

    console.log("Saving accepted money request...");
    await moneyRequest.save();

    await moneyRequest.populate([
      { path: "customer", select: "firstName lastName email" },
      { path: "provider", select: "businessNameRegistered email" },
    ]);

    // Notify provider that the customer accepted the request
    sendMoneyNotification({
      userId: moneyRequest.provider,
      recipientRole: "provider",
      serviceRequestId: moneyRequest.serviceRequest,
      bundleId: moneyRequest.bundle,
      customerId,
      title: "Money request accepted",
      body: `Accepted for $${moneyRequest.totalAmount}`,
    });

    res.json({
      success: true,
      message:
        "Money request accepted successfully" + (tipAmount ? " with tip" : ""),
      data: {
        moneyRequest,
      },
    });
  } catch (error) {
    console.error("Accept money request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept money request",
      error: error.message,
    });
  }
};

// Customer cancels money request
const cancelMoneyRequest = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const customerId = req.user._id;

    console.log("Cancelling money request:", { moneyRequestId, customerId });

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      customer: customerId,
      status: "pending",
    });

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Pending money request not found or you are not the customer",
      });
    }

    // Ensure required fields are set
    moneyRequest.status = "cancelled";
    moneyRequest.totalAmount =
      moneyRequest.amount + (moneyRequest.tipAmount || 0);
    moneyRequest._statusChangedBy = customerId;
    moneyRequest._statusChangedByRole = "customer";

    console.log("Saving cancelled money request...");
    await moneyRequest.save();

    // Notify provider that the customer cancelled the request
    sendMoneyNotification({
      userId: moneyRequest.provider,
      recipientRole: "provider",
      serviceRequestId: moneyRequest.serviceRequest,
      bundleId: moneyRequest.bundle,
      customerId,
      title: "Money request cancelled",
      body: "Customer cancelled the payment request",
    });

    res.json({
      success: true,
      message: "Money request cancelled successfully",
      data: {
        moneyRequest,
      },
    });
  } catch (error) {
    console.error("Cancel money request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel money request",
      error: error.message,
    });
  }
};

// Get money requests for provider
const getProviderMoneyRequests = async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 10,
      serviceRequestId,
      bundleId,
      customerId,
    } = req.query;
    const providerId = req.user._id;

    const filter = { provider: providerId };
    if (status) filter.status = status;
    if (serviceRequestId) filter.serviceRequest = serviceRequestId;
    if (bundleId) filter.bundle = bundleId;
    if (customerId) filter.customer = customerId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [moneyRequests, total] = await Promise.all([
      MoneyRequest.find(filter)
        .populate("customer", "firstName lastName email phone profileImage")
        .populate("serviceRequest", "serviceType scheduledDate")
        .populate("bundle", "title category finalPrice")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MoneyRequest.countDocuments(filter),
    ]);

    console.log(
      `Found ${moneyRequests.length} money requests for provider ${providerId}`
    );

    res.json({
      success: true,
      data: {
        moneyRequests,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get provider money requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch money requests",
      error: error.message,
    });
  }
};

// Get money requests for customer
const getCustomerMoneyRequests = async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 10,
      serviceRequestId,
      bundleId,
    } = req.query;
    const customerId = req.user._id;

    const filter = { customer: customerId };
    if (status) filter.status = status;
    if (serviceRequestId) filter.serviceRequest = serviceRequestId;
    if (bundleId) filter.bundle = bundleId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [moneyRequests, total] = await Promise.all([
      MoneyRequest.find(filter)
        .populate("provider", "businessNameRegistered businessLogo email phone")
        .populate("serviceRequest", "serviceType scheduledDate")
        .populate("bundle", "title category finalPrice")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MoneyRequest.countDocuments(filter),
    ]);

    console.log(
      `Found ${moneyRequests.length} money requests for customer ${customerId}`
    );

    res.json({
      success: true,
      data: {
        moneyRequests,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get customer money requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch money requests",
      error: error.message,
    });
  }
};

// Customer accepts money request (no body needed; sets status to accepted)
const acceptMoneyRequestWithAmount = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const customerId = req.user._id;

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      customer: customerId,
      status: "pending",
    });

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Pending money request not found or you are not the customer",
      });
    }

    // Simply mark as accepted, keep existing amounts
    moneyRequest.status = "accepted";

    // Recalculate commission from existing totalAmount
    const commission = await calculateServiceCommission(
      moneyRequest.totalAmount || moneyRequest.amount
    );
    moneyRequest.commission.amount = commission.commissionAmount;
    moneyRequest.commission.providerAmount = commission.providerAmount;

    moneyRequest._statusChangedBy = customerId;
    moneyRequest._statusChangedByRole = "customer";

    moneyRequest.status = "accepted";

    await moneyRequest.save();

    await moneyRequest.populate([
      { path: "customer", select: "firstName lastName email" },
      { path: "provider", select: "businessNameRegistered email" },
    ]);

    // Notify provider that the customer accepted the request
    sendMoneyNotification({
      userId: moneyRequest.provider,
      recipientRole: "provider",
      serviceRequestId: moneyRequest.serviceRequest,
      bundleId: moneyRequest.bundle,
      customerId,
      title: "Money request accepted",
      body: `Accepted for $${moneyRequest.totalAmount || moneyRequest.amount}`,
    });

    res.json({
      success: true,
      message: "Money request accepted",
      data: {
        moneyRequest,
      },
    });
  } catch (error) {
    console.error("Accept money request with amount error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept money request",
      error: error.message,
    });
  }
};

// Customer sets amount + tip and initiates Stripe checkout
const setAmountAndPay = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const { amount, tipAmount } = req.body;
    const customerId = req.user._id;

    if (amount === undefined || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    if (tipAmount !== undefined && Number(tipAmount) < 0) {
      return res.status(400).json({
        success: false,
        message: "Tip amount cannot be negative",
      });
    }

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      customer: customerId,
      status: { $in: ["pending", "accepted"] },
    }).populate("customer provider");

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message:
          "Pending/accepted money request not found or you are not the customer",
      });
    }

    moneyRequest.amount = Number(amount);
    moneyRequest.tipAmount = tipAmount ? Number(tipAmount) : 0;
    moneyRequest.totalAmount = moneyRequest.amount + moneyRequest.tipAmount;
    moneyRequest.status = "accepted";

    const commission = await calculateServiceCommission(
      moneyRequest.totalAmount
    );
    moneyRequest.commission.amount = commission.commissionAmount;
    moneyRequest.commission.providerAmount = commission.providerAmount;
    moneyRequest._statusChangedBy = customerId;
    moneyRequest._statusChangedByRole = "customer";

    // Build frontend success/cancel URLs so the user returns to the app (conversation page)
    const frontendBase =
      process.env.CLIENT_URL || process.env.FRONTEND_URL || "/success";
    const targetSlug = moneyRequest.serviceRequest
      ? `request-${moneyRequest.serviceRequest}`
      : moneyRequest.bundle
      ? `bundle-${moneyRequest.bundle}`
      : "";

    const successUrl = targetSlug
      ? `${frontendBase}/conversation/${targetSlug}?paymentSuccess=1&moneyRequestId=${moneyRequestId}&session_id={CHECKOUT_SESSION_ID}`
      : `${frontendBase}/payment-success?moneyRequestId=${moneyRequestId}&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl = targetSlug
      ? `${frontendBase}/conversation/${targetSlug}?paymentCancelled=1`
      : `${frontendBase}/payment-cancelled?moneyRequestId=${moneyRequestId}`;

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Payment for ${moneyRequest.description || "Service"}`,
              description: `Payment request from ${moneyRequest.provider.businessNameRegistered}`,
            },
            unit_amount: Math.round(moneyRequest.totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: moneyRequest.customer.email,
      metadata: {
        moneyRequestId: moneyRequestId.toString(),
        customerId: customerId.toString(),
        providerId: moneyRequest.provider._id.toString(),
      },
    });

    moneyRequest.paymentDetails = {
      checkoutSessionId: session.id,
      sessionCreatedAt: new Date(),
      status: "checkout_pending",
    };

    await moneyRequest.save();

    // Notify provider that the customer proceeded to pay/accept with amount
    sendMoneyNotification({
      userId: moneyRequest.provider?._id || moneyRequest.provider,
      recipientRole: "provider",
      serviceRequestId: moneyRequest.serviceRequest,
      bundleId: moneyRequest.bundle,
      customerId,
      title: "Money request accepted",
      body: `Accepted for $${moneyRequest.totalAmount}`,
    });

    res.json({
      success: true,
      message: "Amount set and Stripe Checkout session created",
      data: {
        sessionId: session.id,
        sessionUrl: session.url,
        checkoutUrl: session.url,
        moneyRequest: {
          id: moneyRequest._id,
          amount: moneyRequest.totalAmount,
          description: moneyRequest.description,
        },
      },
    });
  } catch (error) {
    console.error("Set amount and pay error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to set amount and create payment session",
      error: error.message,
    });
  }
};

// Payment history for provider (paid money requests)
const getProviderPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const providerId = req.user._id;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { provider: providerId, status: "paid" };

    const [moneyRequests, totalPaidMoneyRequests, withdrawals] =
      await Promise.all([
        MoneyRequest.find(filter)
          .populate("customer", "firstName lastName email phone profileImage")
          .populate("serviceRequest", "serviceType scheduledDate")
          .populate("bundle", "title category finalPrice")
          .sort({ paidAt: -1, updatedAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        MoneyRequest.countDocuments(filter),
        WithdrawalRequest.find({ provider: providerId })
          .populate("processedBy", "firstName lastName email")
          .sort({ createdAt: -1 })
          .lean(),
      ]);

    const formattedWithdrawals = withdrawals.map((w) => ({
      _id: w._id,
      type: "withdrawal",
      amount: w.amount,
      status: w.status,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      processedAt: w.processedAt,
      payoutReference: w.payoutReference,
      notes: w.notes,
      processedBy: w.processedBy,
    }));

    const formattedPayments = moneyRequests.map((mr) => ({
      ...mr.toObject(),
      type: "payment",
    }));

    // Combine payments and withdrawals for unified history
    const combined = [...formattedPayments, ...formattedWithdrawals].sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt) -
        new Date(a.updatedAt || a.createdAt)
    );

    res.json({
      success: true,
      data: {
        payments: combined,
        pagination: {
          current: parseInt(page),
          total: totalPaidMoneyRequests + withdrawals.length,
          pages: Math.ceil(
            (totalPaidMoneyRequests + withdrawals.length) / parseInt(limit)
          ),
        },
      },
    });
  } catch (error) {
    console.error("Get provider payment history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
      error: error.message,
    });
  }
};

// Payment history for customer (paid money requests)
const getCustomerPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const customerId = req.user._id;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { customer: customerId, status: "paid" };

    const [moneyRequests, total] = await Promise.all([
      MoneyRequest.find(filter)
        .populate("provider", "businessNameRegistered businessLogo email phone")
        .populate("serviceRequest", "serviceType scheduledDate")
        .populate("bundle", "title category finalPrice")
        .sort({ paidAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MoneyRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        payments: moneyRequests,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get customer payment history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
      error: error.message,
    });
  }
};

// Combined finance history for provider: money requests (all statuses) + withdrawals
const getProviderFinanceHistory = async (req, res) => {
  try {
    const providerId = req.user._id;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const moneyFilter = { provider: providerId };

    const [moneyRequests, totalMoney, withdrawals, totalWithdrawals] =
      await Promise.all([
        MoneyRequest.find(moneyFilter)
          .populate("customer", "firstName lastName email phone profileImage")
          .populate("serviceRequest", "serviceType scheduledDate")
          .populate("bundle", "title category finalPrice")
          .sort({ updatedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        MoneyRequest.countDocuments(moneyFilter),
        WithdrawalRequest.find({ provider: providerId })
          .populate("processedBy", "firstName lastName email")
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean(),
        WithdrawalRequest.countDocuments({ provider: providerId }),
      ]);

    const combined = [
      ...moneyRequests.map((mr) => ({
        ...mr.toObject(),
        type: "money_request",
      })),
      ...withdrawals.map((w) => ({
        ...w,
        type: "withdrawal",
      })),
    ].sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt) -
        new Date(a.updatedAt || a.createdAt)
    );

    res.json({
      success: true,
      data: {
        history: combined,
        pagination: {
          current: parseInt(page),
          total: totalMoney + totalWithdrawals,
          pages: Math.ceil((totalMoney + totalWithdrawals) / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get provider finance history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch finance history",
      error: error.message,
    });
  }
};

// Admin: list all transactions (money requests)
const getAdminTransactions = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (status) filter.status = status;

    const [moneyRequests, total] = await Promise.all([
      MoneyRequest.find(filter)
        .populate("provider", "businessNameRegistered email")
        .populate("customer", "firstName lastName email")
        .populate("serviceRequest", "serviceType scheduledDate")
        .populate("bundle", "title category finalPrice")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MoneyRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        transactions: moneyRequests,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get admin transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
};

// Get single money request details
const getMoneyRequest = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;

    const moneyRequest = await MoneyRequest.findById(moneyRequestId)
      .populate(
        "customer",
        "firstName lastName email phone profileImage address"
      )
      .populate(
        "provider",
        "businessNameRegistered businessLogo email phone businessAddress"
      )
      .populate("serviceRequest", "serviceType scheduledDate problem note")
      .populate("bundle", "title description category services finalPrice");

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Money request not found",
      });
    }

    const isAuthorized =
      req.user._id.toString() === moneyRequest.provider._id.toString() ||
      req.user._id.toString() === moneyRequest.customer._id.toString() ||
      req.user.role === "admin";

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this money request",
      });
    }

    res.json({
      success: true,
      data: {
        moneyRequest,
      },
    });
  } catch (error) {
    console.error("Get money request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch money request",
      error: error.message,
    });
  }
};

const processPayment = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const customerId = req.user._id;

    console.log("Creating Stripe Checkout session for money request:", {
      moneyRequestId,
      customerId,
    });

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      customer: customerId,
      status: "accepted",
    }).populate("customer provider");

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Accepted money request not found or you are not the customer",
      });
    }

    // Build frontend success/cancel URLs so the user returns to the app (conversation page)
    const frontendBase =
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      "http://localhost:3000";
    const targetSlug = moneyRequest.serviceRequest
      ? `request-${moneyRequest.serviceRequest}`
      : moneyRequest.bundle
      ? `bundle-${moneyRequest.bundle}`
      : "";

    const successUrl = targetSlug
      ? `${frontendBase}/conversation/${targetSlug}?paymentSuccess=1&moneyRequestId=${moneyRequestId}&session_id={CHECKOUT_SESSION_ID}`
      : `${frontendBase}/payment-success?moneyRequestId=${moneyRequestId}&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl = targetSlug
      ? `${frontendBase}/conversation/${targetSlug}?paymentCancelled=1`
      : `${frontendBase}/payment-cancelled?moneyRequestId=${moneyRequestId}`;

    // Create Stripe Checkout Session with frontend success URL
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Payment for ${moneyRequest.description || "Service"}`,
              description: `Payment request from ${moneyRequest.provider.businessNameRegistered}`,
            },
            unit_amount: Math.round(moneyRequest.totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: moneyRequest.customer.email,
      metadata: {
        moneyRequestId: moneyRequestId.toString(),
        customerId: customerId.toString(),
        providerId: moneyRequest.provider._id.toString(),
      },
    });

    // Save session ID to money request
    moneyRequest.paymentDetails = {
      checkoutSessionId: session.id,
      sessionCreatedAt: new Date(),
      status: "checkout_pending",
    };
    await moneyRequest.save();

    console.log("Stripe Checkout session created:", session.id);

    res.json({
      success: true,
      message: "Stripe Checkout session created successfully",
      data: {
        sessionId: session.id,
        sessionUrl: session.url,
        checkoutUrl: session.url,
        moneyRequest: {
          id: moneyRequest._id,
          amount: moneyRequest.totalAmount,
          description: moneyRequest.description,
        },
        instructions: [
          "1. Click the checkoutUrl to go to Stripe Checkout",
          "2. Complete the payment in Stripe",
          "3. You will be redirected to a backend success endpoint",
          "4. The webhook will update the payment status automatically",
        ],
      },
    });
  } catch (error) {
    console.error("Stripe Checkout error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create payment session",
      error: error.message,
    });
  }
};
// Handle successful payment redirect
const handlePaymentSuccess = async (req, res) => {
  try {
    const { session_id } = req.query;
    const { moneyRequestId } = req.params;

    if (!session_id) {
      return res.status(400).json({
        success: false,
        message: "Missing session_id parameter",
      });
    }

    // Verify the session and payment
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["payment_intent"],
    });

    console.log("Stripe session object:", JSON.stringify(session, null, 2));

    const customerId = session.metadata.customerId;

    console.log("Payment success callback:", {
      session_id,
      moneyRequestId,
      customerId,
    });

    console.log("Stripe session details:", {
      id: session.id,
      payment_status: session.payment_status,
      status: session.status,
      payment_intent: session.payment_intent?.id,
      metadata: session.metadata,
    });

    // Find the money request
    // Be tolerant: look up by id first (metadata customer may be missing)
    const moneyRequest = await MoneyRequest.findById(moneyRequestId).populate(
      "customer provider"
    );

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Money request not found",
      });
    }

    // Check if payment was successful
    const isPaid =
      session.payment_status === "paid" ||
      session.status === "complete" ||
      session.payment_intent?.status === "succeeded";

    if (isPaid) {
      // Force status to paid (Stripe authoritative)
      moneyRequest.status = "paid";
      moneyRequest.paymentDetails = {
        ...moneyRequest.paymentDetails,
        paidAt: new Date(),
        transactionId: session.id,
        paymentIntentId: session.payment_intent?.id,
        stripeCustomerId: session.customer,
        amountReceived: session.amount_total / 100,
        status: "completed",
      };

      if (
        moneyRequest.statusHistory &&
        Array.isArray(moneyRequest.statusHistory)
      ) {
        moneyRequest.statusHistory.push({
          status: "paid",
          timestamp: new Date(),
          note: "Payment completed via Stripe Checkout (success handler)",
          changedBy: customerId || moneyRequest.customer?._id,
          changedByRole: "customer",
        });
      }

      await moneyRequest.save();
      console.log("Money request updated to paid status via success handler");

      // Notify provider that payment was received
      sendMoneyNotification({
        userId: moneyRequest.provider?._id || moneyRequest.provider,
        recipientRole: "provider",
        serviceRequestId: moneyRequest.serviceRequest,
        bundleId: moneyRequest.bundle,
        customerId: moneyRequest.customer?._id || moneyRequest.customer,
        title: "Payment received",
        body: `Payment of $${(session.amount_total / 100).toFixed(2)} received`,
      });

      const wantsJson =
        (req.headers.accept &&
          req.headers.accept.includes("application/json")) ||
        req.query.format === "json";

      if (wantsJson) {
        return res.json({
          success: true,
          message: "Payment successful",
          data: {
            moneyRequestId: moneyRequest._id,
            status: moneyRequest.status,
            amountPaid: session.amount_total / 100,
          },
        });
      }

      return res.send(`
        <html>
          <head>
            <title>Payment Successful</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px 20px; }
              .container { max-width: 600px; margin: 0 auto; background: #f0f8ff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
              h1 { color: #2c3e50; }
              p { color: #34495e; }
              .details { text-align: left; margin-top: 30px; }
              .details strong { display: inline-block; width: 150px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Payment Successful!</h1>
              <p>Your payment has been processed successfully.</p>
              <div class="details">
                <p><strong>Request ID:</strong> ${moneyRequest._id}</p>
                <p><strong>Status:</strong> ${moneyRequest.status}</p>
                <p><strong>Amount Paid:</strong> $${(
                  session.amount_total / 100
                ).toFixed(2)}</p>
                <p><strong>Transaction ID:</strong> ${session.id}</p>
              </div>
            </div>
          </body>
        </html>
      `);
    } else {
      console.log("Payment not completed yet, status:", session.payment_status);

      return res.status(400).json({
        success: false,
        message: `Payment not completed. Current status: ${session.payment_status}`,
        data: {
          session: {
            id: session.id,
            paymentStatus: session.payment_status,
            status: session.status,
          },
          moneyRequest: {
            id: moneyRequest._id,
            status: moneyRequest.status,
          },
        },
      });
    }
  } catch (error) {
    console.error("Payment success handler error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message,
    });
  }
};

// Handle canceled payment
const handlePaymentCancel = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;

    console.log("Payment canceled for money request:", moneyRequestId);

    // Update money request status
    await MoneyRequest.findOneAndUpdate(
      { _id: moneyRequestId },
      {
        "paymentDetails.status": "checkout_canceled",
        "paymentDetails.canceledAt": new Date(),
      }
    );

    res.send(`
      <html>
        <head>
          <title>Payment Canceled</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 40px 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #fff0f0; padding: 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
            h1 { color: #c0392b; }
            p { color: #34495e; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Payment Canceled</h1>
            <p>Your payment was not completed. You can close this window.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Payment cancel handler error:", error);
    res.status(500).json({
      success: false,
      message: "Error handling payment cancellation",
      error: error.message,
    });
  }
};

// Complete payment after 3D Secure authentication
const completePayment = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const customerId = req.user._id;

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      customer: customerId,
      status: "accepted",
    });

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Money request not found",
      });
    }

    res.json({
      success: true,
      message: "Payment completion endpoint - implement Stripe webhook here",
      data: {
        moneyRequestId,
      },
    });
  } catch (error) {
    console.error("Complete payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete payment",
      error: error.message,
    });
  }
};

// Raise dispute
const raiseDispute = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const { reason, description } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (!["customer", "provider"].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Only customers or providers can raise disputes",
      });
    }

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      [userRole]: userId,
      status: { $in: ["pending", "accepted"] },
    });

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Money request not found or access denied",
      });
    }

    moneyRequest.status = "disputed";
    moneyRequest.disputeDetails = {
      reason: reason,
      raisedBy: userRole,
      description: description,
    };
    moneyRequest._statusChangedBy = userId;
    moneyRequest._statusChangedByRole = userRole;

    await moneyRequest.save();

    res.json({
      success: true,
      message: "Dispute raised successfully",
      data: {
        moneyRequest,
      },
    });
  } catch (error) {
    console.error("Raise dispute error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to raise dispute",
      error: error.message,
    });
  }
};

// Resolve dispute
const resolveDispute = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;
    const { resolution, finalAmount, status } = req.body;

    const moneyRequest = await MoneyRequest.findOne({
      _id: moneyRequestId,
      status: "disputed",
    });

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Disputed money request not found",
      });
    }

    moneyRequest.status = status;

    if (finalAmount && finalAmount > 0) {
      moneyRequest.amount = finalAmount;
      moneyRequest.totalAmount = finalAmount + (moneyRequest.tipAmount || 0);
      const commission = await calculateServiceCommission(
        moneyRequest.totalAmount
      );
      moneyRequest.commission.amount = commission.commissionAmount;
      moneyRequest.commission.providerAmount = commission.providerAmount;
    }

    moneyRequest.disputeDetails.resolvedAt = new Date();
    moneyRequest.disputeDetails.resolution = resolution;
    moneyRequest._statusChangedBy = req.user._id;
    moneyRequest._statusChangedByRole = "admin";

    await moneyRequest.save();

    await moneyRequest.populate([
      { path: "customer", select: "firstName lastName email" },
      { path: "provider", select: "businessNameRegistered email" },
    ]);

    res.json({
      success: true,
      message: "Dispute resolved successfully",
      data: {
        moneyRequest,
      },
    });
  } catch (error) {
    console.error("Resolve dispute error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resolve dispute",
      error: error.message,
    });
  }
};

// Get money request statistics
const getMoneyRequestStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    const filter =
      userRole === "provider" ? { provider: userId } : { customer: userId };

    const stats = await MoneyRequest.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const totalStats = await MoneyRequest.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const formattedStats = {
      byStatus: stats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          totalAmount: stat.totalAmount,
        };
        return acc;
      }, {}),
      totals: totalStats[0] || {
        totalRequests: 0,
        totalAmount: 0,
      },
    };

    res.json({
      success: true,
      data: {
        stats: formattedStats,
        userRole,
      },
    });
  } catch (error) {
    console.error("Get money request stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch money request statistics",
      error: error.message,
    });
  }
};

const debugWebhook = async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log("🔍 Webhook Debug for session:", sessionId);

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    // Find money request
    const moneyRequest = await MoneyRequest.findOne({
      "paymentDetails.checkoutSessionId": sessionId,
    });

    // Check for webhook events
    const events = await stripe.events.list({
      type: "checkout.session.completed",
      created: {
        gte: Math.floor(Date.now() / 1000) - 3600, // Last hour
      },
    });

    const relevantEvents = events.data.filter(
      (event) => event.data.object.id === sessionId
    );

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          payment_status: session.payment_status,
          status: session.status,
          payment_intent: session.payment_intent?.id,
          payment_intent_status: session.payment_intent?.status,
          metadata: session.metadata,
          url: session.url,
        },
        moneyRequest: moneyRequest
          ? {
              id: moneyRequest._id,
              status: moneyRequest.status,
              paymentDetails: moneyRequest.paymentDetails,
            }
          : null,
        webhook: {
          eventsCount: relevantEvents.length,
          events: relevantEvents.map((event) => ({
            id: event.id,
            type: event.type,
            created: new Date(event.created * 1000).toISOString(),
          })),
        },
        analysis: {
          isPaid: session.payment_status === "paid",
          isMoneyRequestPaid: moneyRequest?.status === "paid",
          webhookReceived: relevantEvents.length > 0,
          statusMatch: moneyRequest?.status === session.payment_status,
        },
      },
      instructions: [
        "If payment_status is 'paid' but moneyRequest status is not:",
        "1. Check if webhook URL is configured in Stripe Dashboard",
        "2. Verify STRIPE_WEBHOOK_SECRET in environment variables",
        "3. Check webhook logs for errors",
        "4. Test webhook with Stripe CLI",
      ],
    });
  } catch (error) {
    console.error("Webhook debug error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to debug webhook",
      error: error.message,
    });
  }
};

// Add this to your moneyRequestController.js
const checkPaymentStatus = async (req, res) => {
  try {
    const { moneyRequestId } = req.params;

    const moneyRequest = await MoneyRequest.findById(moneyRequestId)
      .populate("customer", "firstName lastName email")
      .populate("provider", "businessNameRegistered email");

    if (!moneyRequest) {
      return res.status(404).json({
        success: false,
        message: "Money request not found",
      });
    }

    res.json({
      success: true,
      data: {
        moneyRequest: {
          id: moneyRequest._id,
          status: moneyRequest.status,
          amount: moneyRequest.totalAmount,
          paymentDetails: moneyRequest.paymentDetails,
          customer: moneyRequest.customer,
          provider: moneyRequest.provider,
        },
      },
    });
  } catch (error) {
    console.error("Check payment status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check payment status",
      error: error.message,
    });
  }
};

// Export all functions
module.exports = {
  createMoneyRequest,
  debugWebhook,
  getProviderMoneyRequests,
  getCustomerMoneyRequests,
  acceptMoneyRequestWithAmount,
  setAmountAndPay,
  getProviderPaymentHistory,
  getCustomerPaymentHistory,
  getProviderFinanceHistory,
  getAdminTransactions,
  getMoneyRequest,
  acceptMoneyRequest,
  cancelMoneyRequest,
  processPayment,
  completePayment,
  raiseDispute,
  resolveDispute,
  getMoneyRequestStats,
  handlePaymentSuccess,
  handlePaymentCancel,
  checkPaymentStatus,
};
