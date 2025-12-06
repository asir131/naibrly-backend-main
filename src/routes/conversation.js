const express = require("express");
const Conversation = require("../models/Conversation");
const QuickChat = require("../models/QuickChat");
const ServiceRequest = require("../models/ServiceRequest");
const { auth } = require("../middleware/auth");

const router = express.Router();

// Get conversation by request ID
router.get("/request/:requestId", auth, async (req, res) => {
  try {
    const { requestId } = req.params;

    const conversation = await Conversation.findOne({ requestId })
      .populate("customerId", "firstName lastName profileImage")
      .populate(
        "providerId",
        "firstName lastName businessNameRegistered profileImage"
      )
      .sort({ "messages.timestamp": 1 });

    if (!conversation) {
      return res.json({
        success: true,
        data: {
          conversation: null,
          messages: [],
        },
      });
    }

    res.json({
      success: true,
      data: {
        conversation: {
          _id: conversation._id,
          customer: conversation.customerId,
          provider: conversation.providerId,
          requestId: conversation.requestId,
        },
        messages: conversation.messages,
      },
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get conversation",
      error: error.message,
    });
  }
});

// Send message via REST API
router.post("/send-message", auth, async (req, res) => {
  try {
    const { requestId, quickChatId, message } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "requestId is required",
      });
    }

    // Get service request to verify access
    const serviceRequest = await ServiceRequest.findById(requestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    // Check if user has access to the conversation
    const hasAccess =
      req.user._id.toString() === serviceRequest.customer.toString() ||
      req.user._id.toString() === serviceRequest.provider.toString();

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
    }

    let content = message;
    let quickChatUsed = null;

    if (quickChatId) {
      const quickChat = await QuickChat.findById(quickChatId);

      if (quickChat) {
        // Check if user has permission to use this quick chat
        const canUseQuickChat =
          // User can use their own quick chats
          quickChat.createdBy.toString() === req.user._id.toString() ||
          // User can use admin-created quick chats
          quickChat.createdByRole === "admin" ||
          // User can use quick chats from the same role
          quickChat.createdByRole === req.user.role;

        if (!canUseQuickChat) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to use this quick chat",
          });
        }

        content = quickChat.content;
        quickChatUsed = quickChat._id;

        // Increment usage count
        quickChat.usageCount += 1;
        await quickChat.save();
      } else {
        return res.status(404).json({
          success: false,
          message: "Quick chat not found",
        });
      }
    }

    // Find or create conversation
    let conversation = await Conversation.findOne({ requestId });

    if (!conversation) {
      conversation = new Conversation({
        customerId: serviceRequest.customer,
        providerId: serviceRequest.provider,
        requestId: requestId,
        messages: [],
        isActive: true,
      });
    }

    // Add message
    const newMessage = {
      senderId: req.user._id,
      senderRole: req.user.role,
      content: content,
      quickChatId: quickChatUsed,
      timestamp: new Date(),
    };

    conversation.messages.push(newMessage);
    conversation.lastMessage = content;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Emit via socket.io if needed
    const { getIO } = require("../socket");
    const io = getIO();
    io.to(`conversation_${conversation._id}`).emit("message", {
      type: "new_message",
      data: {
        conversationId: conversation._id,
        message: newMessage,
      },
    });

    res.json({
      success: true,
      message: "Message sent successfully",
      data: {
        conversationId: conversation._id,
        message: newMessage,
      },
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
});

// Debug endpoint to check conversation data
router.get("/debug/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId)
      .populate("customerId", "firstName lastName email")
      .populate("providerId", "firstName lastName businessNameRegistered email")
      .populate("requestId", "serviceType problem status")
      .populate("bundleId", "title services");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    res.json({
      success: true,
      data: {
        conversation: {
          _id: conversation._id,
          customer: conversation.customerId,
          provider: conversation.providerId,
          requestId: conversation.requestId,
          bundleId: conversation.bundleId,
          lastMessage: conversation.lastMessage,
          lastMessageAt: conversation.lastMessageAt,
          messageCount: conversation.messages.length,
          isActive: conversation.isActive,
        },
        messages: conversation.messages,
      },
    });
  } catch (error) {
    console.error("Debug conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get conversation debug info",
      error: error.message,
    });
  }
});

// Debug endpoint to check if service request and bundle exist
router.get("/debug/check-ids", async (req, res) => {
  try {
    const { requestId, bundleId } = req.query;

    let serviceRequest = null;
    let bundle = null;

    if (requestId) {
      serviceRequest = await ServiceRequest.findById(requestId)
        .populate("customer", "firstName lastName")
        .populate("provider", "firstName lastName businessNameRegistered");
    }

    if (bundleId) {
      bundle = await Bundle.findById(bundleId)
        .populate("creator", "firstName lastName")
        .populate("provider", "firstName lastName businessNameRegistered");
    }

    res.json({
      success: true,
      data: {
        serviceRequest,
        bundle,
      },
    });
  } catch (error) {
    console.error("Debug check IDs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check IDs",
      error: error.message,
    });
  }
});

// Get user's conversations
router.get("/my-conversations", auth, async (req, res) => {
  try {
    let query = { isActive: true };

    if (req.user.role === "customer") {
      query.customerId = req.user._id;
    } else if (req.user.role === "provider") {
      query.providerId = req.user._id;
    }

    const conversations = await Conversation.find(query)
      .populate("customerId", "firstName lastName profileImage")
      .populate(
        "providerId",
        "firstName lastName businessNameRegistered profileImage"
      )
      .populate("requestId", "serviceType problem status")
      .sort({ lastMessageAt: -1 });

    res.json({
      success: true,
      data: {
        conversations,
      },
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get conversations",
      error: error.message,
    });
  }
});

module.exports = router;
