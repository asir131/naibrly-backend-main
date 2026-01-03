const express = require("express");
const router = express.Router();

// Import controllers properly
const {
  createMoneyRequest,
  getProviderMoneyRequests,
  getCustomerMoneyRequests,
  getProviderPaymentHistory,
  getCustomerPaymentHistory,
  getProviderFinanceHistory,
  getAdminTransactions,
  getMoneyRequest,
  acceptMoneyRequest,
  acceptMoneyRequestWithAmount,
  setAmountAndPay,
  cancelMoneyRequest,
  cancelMoneyRequestByProvider,
  deleteAllProviderMoneyRequests,
  processPayment,
  completePayment,
  raiseDispute,
  resolveDispute,
  getMoneyRequestStats,
  handlePaymentSuccess,
  handlePaymentCancel,
  testPaymentWebhook,
  checkPaymentStatus,
} = require("../controllers/moneyRequestController");

const { auth, authorize } = require("../middleware/auth");

// Provider routes
router.post("/create", auth, authorize("provider"), createMoneyRequest);
router.get("/provider", auth, authorize("provider"), getProviderMoneyRequests);
router.get(
  "/provider/history",
  auth,
  authorize("provider"),
  getProviderPaymentHistory
);
router.get(
  "/provider/finance-history",
  auth,
  authorize("provider"),
  getProviderFinanceHistory
);

// Customer routes
router.get("/customer", auth, authorize("customer"), getCustomerMoneyRequests);
router.get(
  "/customer/history",
  auth,
  authorize("customer"),
  getCustomerPaymentHistory
);
router.patch(
  "/:moneyRequestId/accept-with-amount",
  auth,
  authorize("customer"),
  acceptMoneyRequestWithAmount
);
router.post(
  "/:moneyRequestId/set-amount-and-pay",
  auth,
  authorize("customer"),
  setAmountAndPay
);
router.patch(
  "/:moneyRequestId/accept",
  auth,
  authorize("customer"),
  acceptMoneyRequest
);
router.patch(
  "/:moneyRequestId/cancel",
  auth,
  authorize("customer"),
  cancelMoneyRequest
);
router.patch(
  "/:moneyRequestId/cancel-by-provider",
  auth,
  authorize("provider"),
  cancelMoneyRequestByProvider
);
router.delete(
  "/provider/all",
  auth,
  authorize("provider"),
  deleteAllProviderMoneyRequests
);
router.post(
  "/:moneyRequestId/pay",
  auth,
  authorize("customer"),
  processPayment
);
router.post(
  "/:moneyRequestId/complete-payment",
  auth,
  authorize("customer"),
  completePayment
);
router.get("/:moneyRequestId/payment-success", handlePaymentSuccess);
router.get("/:moneyRequestId/payment-canceled", handlePaymentCancel);

// Both provider and customer can get details and raise disputes
router.get("/:moneyRequestId", auth, getMoneyRequest);
router.post(
  "/:moneyRequestId/dispute",
  auth,
  authorize("provider", "customer"),
  raiseDispute
);
router.get("/stats/summary", auth, getMoneyRequestStats);

// Admin routes
router.patch(
  "/:moneyRequestId/resolve-dispute",
  auth,
  authorize("admin"),
  resolveDispute
);
router.get("/admin/transactions", auth, authorize("admin"), getAdminTransactions);

router.get(
  "/:moneyRequestId/status",
  auth,
  authorize("customer", "provider"),
  checkPaymentStatus
);



module.exports = router;
