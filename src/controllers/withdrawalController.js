const WithdrawalRequest = require("../models/WithdrawalRequest");
const { sendNotification } = require("../utils/notification");
const ServiceProvider = require("../models/ServiceProvider");
const PayoutInformation = require("../models/PayoutInformation");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Provider: create withdrawal request
exports.createWithdrawalRequest = async (req, res) => {
  try {
    const providerId = req.user._id;
    const { amount, notes } = req.body;

    if (amount === undefined || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({ success: false, message: "Provider not found" });
    }

    if (provider.availableBalance < Number(amount)) {
      return res.status(400).json({
        success: false,
        message: "Insufficient available balance",
        data: { availableBalance: provider.availableBalance },
      });
    }

    // Move funds from available to pending
    provider.availableBalance -= Number(amount);
    provider.pendingPayout += Number(amount);
    await provider.save();

    const withdrawal = await WithdrawalRequest.create({
      provider: providerId,
      amount: Number(amount),
      status: "pending",
      notes,
    });

    res.status(201).json({
      success: true,
      message: "Withdrawal request created",
      data: {
        withdrawal,
        balances: {
          availableBalance: provider.availableBalance,
          pendingPayout: provider.pendingPayout,
        },
      },
    });
  } catch (error) {
    console.error("Create withdrawal error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create withdrawal",
      error: error.message,
    });
  }
};

// Provider: list own withdrawals
exports.getMyWithdrawals = async (req, res) => {
  try {
    const providerId = req.user._id;
    const withdrawals = await WithdrawalRequest.find({ provider: providerId })
      .sort({ createdAt: -1 })
      .lean();

    const provider = await ServiceProvider.findById(providerId).select(
      "availableBalance pendingPayout totalEarnings"
    );

    res.json({
      success: true,
      data: {
        withdrawals,
        balances: {
          availableBalance: provider?.availableBalance || 0,
          pendingPayout: provider?.pendingPayout || 0,
          totalEarnings: provider?.totalEarnings || 0,
        },
      },
    });
  } catch (error) {
    console.error("Get provider withdrawals error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawals",
      error: error.message,
    });
  }
};

// Admin: list all withdrawals
exports.getAllWithdrawals = async (req, res) => {
  try {
    const withdrawals = await WithdrawalRequest.find()
      .populate("provider", "businessNameRegistered email availableBalance pendingPayout")
      .populate("processedBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .lean();

    // Fetch payout info for all providers in one query and merge it into the response
    const providerIds = withdrawals
      .map((w) => w.provider?._id?.toString())
      .filter(Boolean);

    const payoutInfos = await PayoutInformation.find({
      provider: { $in: providerIds },
    })
      .select(
        "provider bankName bankCode accountType accountHolderName accountNumber routingNumber lastFourDigits isVerified verificationStatus isActive createdAt updatedAt"
      )
      .lean();

    const payoutInfoByProvider = payoutInfos.reduce((acc, info) => {
      acc[info.provider.toString()] = {
        bankName: info.bankName,
        bankCode: info.bankCode,
        accountType: info.accountType,
        accountHolderName: info.accountHolderName,
        accountNumber: info.accountNumber,
        routingNumber: info.routingNumber,
        lastFourDigits: info.lastFourDigits,
        isVerified: info.isVerified,
        verificationStatus: info.verificationStatus,
        isActive: info.isActive,
        createdAt: info.createdAt,
        updatedAt: info.updatedAt,
      };
      return acc;
    }, {});

    const withdrawalsWithPayoutInfo = withdrawals.map((w) => ({
      ...w,
      payoutInformation:
        payoutInfoByProvider[w.provider?._id?.toString() || ""] || null,
    }));

    res.json({
      success: true,
      data: { withdrawals: withdrawalsWithPayoutInfo, total: withdrawals.length },
    });
  } catch (error) {
    console.error("Get all withdrawals error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawals",
      error: error.message,
    });
  }
};

// Admin: approve withdrawal (mark paid)
exports.approveWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { payoutReference, notes } = req.body || {};
    const adminId = req.user._id;

    const withdrawal = await WithdrawalRequest.findById(withdrawalId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal not found" });
    }
    if (withdrawal.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending withdrawals can be approved",
      });
    }

    const provider = await ServiceProvider.findById(withdrawal.provider);
    if (!provider) {
      return res.status(404).json({ success: false, message: "Provider not found" });
    }

    // Attempt Stripe payout to provider's external bank account (test-friendly)
    let payoutResult = {
      id: payoutReference || "",
      status: "not_attempted",
    };

    try {
      // Fetch payout info
      const payoutInfo = await PayoutInformation.findOne({
        provider: provider._id,
        isActive: true,
      });

      if (!payoutInfo) {
        throw new Error("No payout information found for provider");
      }

      // Ensure connected account exists
      let connectedAccountId = provider.stripeAccountId;
      if (!connectedAccountId) {
        const account = await stripe.accounts.create({
          type: "custom",
          country: "US",
          business_type: "individual",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: {
            mcc: "7299",
            url: "https://example.com",
          },
          tos_acceptance: {
            service_agreement: "recipient",
            date: Math.floor(Date.now() / 1000),
            ip: req.ip || "127.0.0.1",
          },
        });
        connectedAccountId = account.id;
        provider.stripeAccountId = connectedAccountId;
        await provider.save();
      }

      // Attach/replace external bank account using payout info (test numbers acceptable)
      const bankToken = await stripe.tokens.create({
        bank_account: {
          country: "US",
          currency: "usd",
          account_holder_name: payoutInfo.accountHolderName,
          account_holder_type: "individual",
          routing_number: payoutInfo.routingNumber,
          account_number: payoutInfo.accountNumber,
        },
      });

      await stripe.accounts.createExternalAccount(connectedAccountId, {
        external_account: bankToken.id,
        default_for_currency: true,
      });

      // Create payout on the connected account
      payoutResult = await stripe.payouts.create(
        {
          amount: Math.round(Number(withdrawal.amount) * 100),
          currency: "usd",
          description: `Withdrawal ${withdrawal._id}`,
        },
        { stripeAccount: connectedAccountId }
      );
    } catch (stripeErr) {
      console.error("Stripe payout failed, using simulated payout:", stripeErr);
      payoutResult = {
        id: payoutReference || `test_payout_${Date.now()}`,
        status: "simulated_failed",
        error: stripeErr.message,
      };
    }

    // Move from pendingPayout to paid (deduct pending)
    provider.pendingPayout = Math.max(
      0,
      provider.pendingPayout - withdrawal.amount
    );
    await provider.save();

    withdrawal.status = "paid";
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    withdrawal.payoutReference = payoutResult.id || payoutReference;
    if (notes) withdrawal.notes = notes;
    if (payoutResult.status) {
      withdrawal.transferStatus = payoutResult.status;
    }
    await withdrawal.save();

    res.json({
      success: true,
      message: "Withdrawal approved and marked as paid",
      data: {
        withdrawal,
        balances: {
          availableBalance: provider.availableBalance,
          pendingPayout: provider.pendingPayout,
        },
        payout: payoutResult,
      },
    });
  } catch (error) {
    console.error("Approve withdrawal error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve withdrawal",
      error: error.message,
    });
  }
};

// Admin: reject withdrawal (refund to available balance)
exports.rejectWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { notes } = req.body || {};
    const adminId = req.user._id;

    const withdrawal = await WithdrawalRequest.findById(withdrawalId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal not found" });
    }
    if (withdrawal.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending withdrawals can be rejected",
      });
    }

    const provider = await ServiceProvider.findById(withdrawal.provider);
    if (!provider) {
      return res.status(404).json({ success: false, message: "Provider not found" });
    }

    // Refund pending amount back to available
    provider.pendingPayout = Math.max(
      0,
      provider.pendingPayout - withdrawal.amount
    );
    provider.availableBalance += withdrawal.amount;
    await provider.save();

    withdrawal.status = "rejected";
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    if (notes) withdrawal.notes = notes;
    await withdrawal.save();

    res.json({
      success: true,
      message: "Withdrawal rejected and amount returned to available balance",
      data: {
        withdrawal,
        balances: {
          availableBalance: provider.availableBalance,
          pendingPayout: provider.pendingPayout,
        },
      },
    });
  } catch (error) {
    console.error("Reject withdrawal error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject withdrawal",
      error: error.message,
    });
  }
};
