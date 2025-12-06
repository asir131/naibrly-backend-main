const express = require("express");
const {
  getQuickChats,
  createQuickChat,
  deleteQuickChat,
  updateQuickChat,
  getAdminQuickChats,
  createAdminQuickChat,
  updateAdminQuickChat,
  deleteAdminQuickChat,
} = require("../controllers/quickChatController");
const { auth, authorize } = require("../middleware/auth");
const { adminAuth } = require("../middleware/adminAuth");

const router = express.Router();

// ==========================================
// USER QUICK CHAT ROUTES
// ==========================================

// Get all quick chats for current user (including admin-created ones)
router.get("/", auth, getQuickChats);

// Create new quick chat
router.post("/", auth, createQuickChat);

// Delete user's own quick chat
router.delete("/:quickChatId", auth, deleteQuickChat);

// Update user's own quick chat
router.put("/:quickChatId", auth, updateQuickChat);

// ==========================================
// ADMIN QUICK CHAT ROUTES
// ==========================================

// Option 1: Using adminAuth middleware (if you want separate admin authentication)
router.get("/admin/all", adminAuth, getAdminQuickChats);
router.post("/admin/create", adminAuth, createAdminQuickChat);
router.put("/admin/update/:quickChatId", adminAuth, updateAdminQuickChat);
router.delete("/admin/delete/:quickChatId", adminAuth, deleteAdminQuickChat);

// Option 2: Using auth + authorize middleware (if you want to use the same auth but check role)
// router.get("/admin/all", auth, authorize('admin'), getAdminQuickChats);
// router.post("/admin/create", auth, authorize('admin'), createAdminQuickChat);
// router.put("/admin/update/:quickChatId", auth, authorize('admin'), updateAdminQuickChat);
// router.delete("/admin/delete/:quickChatId", auth, authorize('admin'), deleteAdminQuickChat);

module.exports = router;
