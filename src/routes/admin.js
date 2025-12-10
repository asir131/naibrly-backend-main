const express = require("express");
const {
  adminLogin,
  getDashboardStats,
  getAllCustomers,
  getAllProviders,
  approveProvider,
  updateUserStatus,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword,
  getEarningsSummary,
  getCustomerDetails,
  getProviderDetails,
  approveProviderVerification,
  rejectProviderVerification,
  getAdminNotifications,
} = require("../controllers/adminController");
const { protect, adminAuth } = require("../middleware/adminAuth");
const { verifyPayoutInformation } = require("../controllers/payoutController");
const {
  getContent,
  updateContent,
} = require("../controllers/contentController");
const {
  getAllFAQs,
  getFAQ,
  createFAQ,
  updateFAQ,
  deleteFAQ,
} = require("../controllers/faqController");
const {
  getAllTickets,
  getTicketById,
  getTicketByTicketId,
  updateTicketStatus,
  updateTicket,
  deleteTicket,
  addReply,
  getTicketStats,
} = require("../controllers/supportTicketController");

const router = express.Router();

// Admin login (public route)
router.post("/login", adminLogin);
router.patch(
  "/payout/:payoutInfoId/verify",
  adminAuth,
  verifyPayoutInformation
);

// Protected admin routes
router.get("/dashboard/stats", adminAuth, getDashboardStats);
router.get("/dashboard/earnings", adminAuth, getEarningsSummary);
router.get("/notifications", adminAuth, getAdminNotifications);
router.get("/customers", adminAuth, getAllCustomers);
router.get("/customers/:customerId", adminAuth, getCustomerDetails);
router.get("/providers", adminAuth, getAllProviders);
router.get("/providers/:providerId", adminAuth, getProviderDetails);
router.patch("/providers/:providerId/approve", adminAuth, approveProvider);
router.patch(
  "/providers/:providerId/verification/approve",
  adminAuth,
  approveProviderVerification
);
router.patch(
  "/providers/:providerId/verification/reject",
  adminAuth,
  rejectProviderVerification
);
router.patch("/users/:userId/:role/status", adminAuth, updateUserStatus);

// Profile routes
router.get("/profile", adminAuth, getAdminProfile);
router.put("/profile", adminAuth, updateAdminProfile);

// Password route
router.put("/change-password", adminAuth, changeAdminPassword);

// Content management routes
router.get("/content/:type", adminAuth, getContent);
router.put("/content/:type", adminAuth, updateContent);

// FAQ routes
router.get("/faq", adminAuth, getAllFAQs);
router.post("/faq", adminAuth, createFAQ);
router.get("/faq/:id", adminAuth, getFAQ);
router.put("/faq/:id", adminAuth, updateFAQ);
router.delete("/faq/:id", adminAuth, deleteFAQ);

// Support Ticket routes
router.get("/tickets", adminAuth, getAllTickets);
router.get("/tickets/stats", adminAuth, getTicketStats);
router.get("/tickets/:ticketId", adminAuth, getTicketById);
router.get("/tickets/ticket/:ticketId", adminAuth, getTicketByTicketId);
router.patch("/tickets/:ticketId/status", adminAuth, updateTicketStatus);
router.put("/tickets/:ticketId", adminAuth, updateTicket);
router.post("/tickets/:ticketId/reply", adminAuth, addReply);
router.delete("/tickets/:ticketId", adminAuth, deleteTicket);

module.exports = router;
