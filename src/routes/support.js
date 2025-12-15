const express = require("express");
const {
  createTicket,
  getAllTickets,
  getTicketById,
  getTicketByTicketId,
  updateTicketStatus,
  updateTicket,
  addReply,
  deleteTicket,
  getMyTickets,
  getTicketStats,
} = require("../controllers/supportTicketController");
const { auth: protect, optionalAuth } = require("../middleware/auth");
const { adminAuth } = require("../middleware/adminAuth");

const router = express.Router();

// Public routes (optionalAuth allows authenticated users to auto-fill their info)
router.post("/tickets", optionalAuth, createTicket); // Anyone can create a ticket

// Protected user routes (customers/providers)
router.get("/tickets/my-tickets", protect, getMyTickets); // Get user's own tickets
router.get("/tickets/:ticketId", protect, getTicketById); // Get single ticket detail (user must own it)

// Admin routes
router.get("/admin/tickets", adminAuth, getAllTickets); // Get all tickets
router.get("/admin/tickets/stats", adminAuth, getTicketStats); // Get ticket statistics
router.get("/admin/tickets/:ticketId", adminAuth, getTicketById); // Get ticket by MongoDB ID
router.get("/admin/tickets/ticket/:ticketId", adminAuth, getTicketByTicketId); // Get ticket by ticket ID (e.g., ADG39)
router.patch("/admin/tickets/:ticketId/status", adminAuth, updateTicketStatus); // Update ticket status
router.put("/admin/tickets/:ticketId", adminAuth, updateTicket); // Update ticket (priority, category, etc.)
router.delete("/admin/tickets/:ticketId", adminAuth, deleteTicket); // Delete ticket

// Reply routes (both admin and users can reply)
router.post("/tickets/:ticketId/reply", protect, addReply); // Add reply to ticket (protected - requires auth)
router.post("/admin/tickets/:ticketId/reply", adminAuth, addReply); // Admin add reply

module.exports = router;
