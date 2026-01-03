const { Server: SocketIOServer } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const QuickChat = require("../models/QuickChat");
const ServiceRequest = require("../models/ServiceRequest");
const ServiceProvider = require("../models/ServiceProvider");
const Customer = require("../models/Customer");
const Bundle = require("../models/Bundle");
const Notification = require("../models/Notification");

// Store user connections
const userSocketMap = new Map();
let io;

// Build notification payload
const buildNotification = ({
  title,
  body,
  requestId,
  bundleId,
  recipientRole,
  customerId,
}) => {
  // Ignore internal/system markers
  if (body === "__MONEY_REQUEST__") return null;

  if (body === "__TASK_COMPLETED__SERVICE") {
    body = "Service task completed";
  }

  let link = '/conversation';
  const idPart = requestId || bundleId;

  if (recipientRole === 'provider' && idPart && customerId) {
    link = `/provider/signup/message/${idPart}-${customerId}`;
  } else if (requestId) {
    link = `/conversation/request-${requestId}`;
  } else if (bundleId) {
    link = `/conversation/bundle-${bundleId}`;
  }

  return {
    id: new mongoose.Types.ObjectId().toString(),
    title: title || "New message",
    body: body || "",
    link,
    createdAt: new Date().toISOString(),
    isRead: false,
  };
};

// Persist notification for offline access
const persistNotification = async (userId, payload) => {
  if (!payload || !userId) return;
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
    console.error("notification persist error:", err.message);
  }
};

// Improved authentication middleware
const authenticateSocket = async (socket, next) => {
  console.log("🔐 Authentication attempt for socket:", socket.id);

  const token =
    socket.handshake.auth.token ||
    socket.handshake.headers.token ||
    (socket.handshake.headers.authorization &&
      socket.handshake.headers.authorization.toLowerCase().startsWith("bearer ")
      ? socket.handshake.headers.authorization.split(" ")[1]
      : null) ||
    socket.handshake.query.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.userId) {
        socket.userId = decoded.userId.toString();

        // Get user role from database to ensure it's correct
        let user = await Customer.findById(decoded.userId);
        if (user) {
          socket.userRole = "customer"; // Set role based on collection
        } else {
          user = await ServiceProvider.findById(decoded.userId);
          if (user) {
            socket.userRole = "provider"; // Set role based on collection
          } else {
            throw new Error("User not found");
          }
        }

        console.log(
          `✅ User authenticated: ${socket.userId} (${socket.userRole})`
        );
        socket.isAuthenticated = true;
        return next();
      }
    } catch (error) {
      console.log("❌ Token verification failed:", error.message);
    }
  }

  console.log("⚠️  No valid token, allowing unauthenticated connection");
  socket.isAuthenticated = false;
  next();
};

// Handler to get all conversations for a customer
async function handleGetCustomerConversations(socket) {
  try {
    if (!socket.userId || socket.userRole !== "customer") {
      socket.emit("message", {
        type: "error",
        data: { message: "Only customers can use this endpoint" },
      });
      return;
    }

    console.log("📋 Getting all conversations for customer:", socket.userId);

    const conversations = await Conversation.find({
      customerId: socket.userId,
      isActive: true,
    })
      .populate("customerId", "firstName lastName profileImage")
      .populate(
        "providerId",
        "firstName lastName businessNameRegistered profileImage"
      )
      .populate({
        path: "requestId",
        select: "serviceType status scheduledDate scheduledTime avgPrice",
      })
      .populate({
        path: "bundleId",
        select: "title status scheduledDate scheduledTime totalPrice",
      })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean();

    const formattedConversations = conversations.map((conv) => {
      const lastMessage = conv.messages[conv.messages.length - 1];
      
      let status = "unknown";
      let serviceType = "Unknown";
      let price = null;
      let date = null;
      
      if (conv.requestId) {
        status = conv.requestId.status;
        serviceType = conv.requestId.serviceType;
        price = conv.requestId.avgPrice;
        date = conv.requestId.scheduledDate;
      } else if (conv.bundleId) {
        status = conv.bundleId.status;
        serviceType = conv.bundleId.title;
        price = conv.bundleId.totalPrice;
        date = conv.bundleId.scheduledDate;
      }
      
      return {
        _id: conv._id,
        conversationId: conv._id,
        customer: conv.customerId,
        provider: conv.providerId,
        requestId: conv.requestId?._id || null,
        bundleId: conv.bundleId?._id || null,
        serviceType: serviceType,
        status: status,
        avgPrice: price,
        scheduledDate: date,
        lastMessage: conv.lastMessage || "",
        lastMessageAt: conv.lastMessageAt || conv.updatedAt,
        lastMessageSender: lastMessage?.senderRole || null,
        unreadCount: lastMessage?.senderRole === "provider" ? 1 : 0,
        messagesCount: conv.messages.length,
        isActive: conv.isActive,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        conversationType: conv.requestId ? "service_request" : "bundle",
      };
    });

    socket.emit("message", {
      type: "customer_conversations",
      data: {
        conversations: formattedConversations,
        totalCount: formattedConversations.length,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`✅ Sent ${formattedConversations.length} conversations to customer`);
  } catch (error) {
    console.error("❌ Get customer conversations error:", error);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to get conversations: " + error.message },
    });
  }
}

// FIXED: Unified function to get or create conversation
async function getOrCreateConversationV2(socket, { requestId, bundleId, customerIdForBundle }) {
  try {
    console.log("[chat] getOrCreateConversationV2:", {
      requestId,
      bundleId,
      customerIdForBundle,
      socketUser: socket.userId,
      socketRole: socket.userRole,
    });

    if (!requestId && !bundleId) {
      throw new Error("Either requestId or bundleId is required");
    }

    // Service Request Conversation
    if (requestId) {
      const serviceRequest = await ServiceRequest.findById(requestId)
        .populate("customer")
        .populate("provider");

      if (!serviceRequest) {
        // Fallback: if service request is missing, try existing conversation to avoid hard failure
        const existingConv = await Conversation.findOne({ requestId });
        if (existingConv) {
          const canAccess =
            socket.userId === existingConv.customerId?.toString?.() ||
            socket.userId === existingConv.providerId?.toString?.();
          if (!canAccess) throw new Error("Access denied to this conversation");
          return existingConv;
        }
        throw new Error("Service request not found");
      }

      const hasAccess =
        socket.userId === serviceRequest.customer._id.toString() ||
        (serviceRequest.provider &&
          socket.userId === serviceRequest.provider._id.toString());

      if (!hasAccess) throw new Error("Access denied to this conversation");

      let conversation = await Conversation.findOne({ requestId });
      if (!conversation) {
        try {
          conversation = await Conversation.create({
            customerId: serviceRequest.customer._id,
            providerId: serviceRequest.provider._id,
            requestId,
            messages: [],
            isActive: true,
          });
        } catch (err) {
          if (err?.code === 11000) {
            conversation = await Conversation.findOne({ requestId });
          } else {
            throw err;
          }
        }
      }
      return conversation;
    }

    // Bundle Conversation
    const bundle = await Bundle.findById(bundleId)
      .populate("creator")
      .populate("provider")
      .populate("participants.customer");

    if (!bundle) throw new Error("Bundle not found");

    // Determine if user can access this bundle
    const isCreator = bundle.creator && socket.userId === bundle.creator._id.toString();
    const isProvider = bundle.provider && socket.userId === bundle.provider._id.toString();
    const isParticipant = bundle.participants?.some(
      (p) => p.customer && p.customer._id.toString() === socket.userId
    );

    if (!isCreator && !isProvider && !isParticipant) {
      throw new Error("Access denied to this bundle conversation");
    }

    // Determine which customer ID to use for the conversation
    let targetCustomerId;
    if (socket.userRole === "customer") {
      targetCustomerId = socket.userId; // Customer accessing their own conversation
    } else if (customerIdForBundle) {
      // Provider specifying which participant to talk to
      targetCustomerId = customerIdForBundle;
    } else {
      // Provider - try to find a conversation they already have
      // First check if they have any existing conversation with any participant
      const existingConversation = await Conversation.findOne({
        bundleId,
        providerId: socket.userId,
      });
      
      if (existingConversation) {
        return existingConversation;
      }
      
      // If no existing conversation and no customerId specified, use bundle creator
      if (bundle.creator) {
        targetCustomerId = bundle.creator._id.toString();
      } else {
        throw new Error("customerIdForBundle is required for provider to access bundle conversation");
      }
    }

    // Verify the target customer is part of the bundle
    const isValidCustomer =
      targetCustomerId === bundle.creator._id.toString() ||
      bundle.participants?.some(
        (p) => p.customer && p.customer._id.toString() === targetCustomerId
      );

    if (!isValidCustomer) {
      throw new Error("Target customer is not part of this bundle");
    }

    // Find or create conversation
    const desiredProviderId =
      socket.userRole === "provider"
        ? socket.userId
        : bundle.provider
        ? bundle.provider._id
        : null;
    let conversation = await Conversation.findOne({
      bundleId,
      customerId: targetCustomerId,
    });

    if (!conversation) {
      const createPayload = {
        customerId: targetCustomerId,
        providerId: desiredProviderId,
        bundleId,
        messages: [],
        isActive: true,
      };
      try {
        conversation = await Conversation.create(createPayload);
      } catch (err) {
        if (err?.code === 11000) {
          conversation = await Conversation.findOne({
            bundleId,
            customerId: targetCustomerId,
          });
        } else {
          throw err;
        }
      }
    }
    if (conversation && desiredProviderId && !conversation.providerId) {
      conversation.providerId = desiredProviderId;
      await conversation.save();
    }

    return conversation;
  } catch (error) {
    console.error("[chat] getOrCreateConversationV2 error:", error.message);
    throw error;
  }
}

// FIXED: Enhanced handleJoinConversation to handle provider bundle access
async function handleJoinConversation(socket, data) {
  try {
    console.log("👥 Join conversation request:", data);

    if (!socket.userId || !socket.userRole) {
      socket.emit("message", {
        type: "error",
        data: { message: "Authentication required to join conversations" },
      });
      return;
    }

    const { requestId, bundleId, customerId } = data;

    if (!requestId && !bundleId) {
      socket.emit("message", {
        type: "error",
        data: { message: "requestId or bundleId is required" },
      });
      return;
    }

    // Special handling for providers joining bundles without customerId
    if (bundleId && socket.userRole === "provider" && !customerId) {
      await handleProviderJoinBundle(socket, bundleId);
      return;
    }

    const conversation = await getOrCreateConversationV2(socket, {
      requestId,
      bundleId,
      customerIdForBundle: customerId,
    });

    if (conversation) {
      socket.join(`conversation_${conversation._id}`);
      console.log(`✅ User ${socket.userId} joined conversation ${conversation._id}`);

      // Send success response
      socket.emit("message", {
        type: "joined_conversation",
        data: {
          conversationId: conversation._id,
          requestId: requestId,
          bundleId: bundleId,
          customerId: conversation.customerId,
          providerId: conversation.providerId,
          message: "Successfully joined conversation",
          timestamp: new Date().toISOString(),
        },
      });

      // Send conversation history
      const populatedConversation = await Conversation.findById(conversation._id)
        .populate("customerId", "firstName lastName profileImage")
        .populate(
          "providerId",
          "firstName lastName businessNameRegistered profileImage"
        );

      // Populate sender info for each message in history
      const messagesWithSenderInfo = await Promise.all(
        populatedConversation.messages.map(async (msg) => {
          if (msg.senderInfo) {
            // Already has sender info
            return msg;
          }

          // Fetch sender info if not present
          let senderInfo = null;
          if (msg.senderRole === "customer") {
            senderInfo = await Customer.findById(msg.senderId)
              .select("firstName lastName profileImage")
              .lean();
          } else if (msg.senderRole === "provider") {
            senderInfo = await ServiceProvider.findById(msg.senderId)
              .select("firstName lastName businessNameRegistered profileImage")
              .lean();
          }

          return {
            ...msg.toObject ? msg.toObject() : msg,
            senderInfo: senderInfo || undefined
          };
        })
      );

      socket.emit("message", {
        type: "conversation_history",
        data: {
          conversation: {
            _id: populatedConversation._id,
            customer: populatedConversation.customerId,
            provider: populatedConversation.providerId,
            requestId: populatedConversation.requestId,
            bundleId: populatedConversation.bundleId,
            lastMessage: populatedConversation.lastMessage,
            lastMessageAt: populatedConversation.lastMessageAt,
          },
          messages: messagesWithSenderInfo,
        },
      });
    }
  } catch (error) {
    console.error("❌ Join conversation error:", error);
    socket.emit("message", {
      type: "error",
      data: {
        message: error.message,
        requestId: data.requestId,
        bundleId: data.bundleId,
      },
    });
  }
}

// New helper function for providers joining bundles
async function handleProviderJoinBundle(socket, bundleId) {
  try {
    console.log(`👨‍🔧 Provider ${socket.userId} joining bundle ${bundleId}`);
    
    const bundle = await Bundle.findById(bundleId)
      .populate("creator")
      .populate("provider")
      .populate("participants.customer");

    if (!bundle) {
      throw new Error("Bundle not found");
    }

    // Check if provider has access to this bundle
    const isProvider = bundle.provider && socket.userId === bundle.provider._id.toString();
    const isOfferProvider = bundle.providerOffers?.some(
      (offer) => offer.provider && offer.provider.toString() === socket.userId
    );

    if (!isProvider && !isOfferProvider) {
      throw new Error("Provider does not have access to this bundle");
    }

    // Get all conversations this provider has with bundle participants
    const conversations = await Conversation.find({
      bundleId,
      providerId: socket.userId,
    })
      .populate("customerId", "firstName lastName profileImage")
      .populate(
        "providerId",
        "firstName lastName businessNameRegistered profileImage"
    );

    // Join all conversation rooms
    conversations.forEach((conv) => {
      socket.join(`conversation_${conv._id}`);
      console.log(`✅ Provider joined conversation ${conv._id} with customer ${conv.customerId._id}`);
    });

    // If no conversations exist yet, create one with the bundle creator
    if (conversations.length === 0 && bundle.creator) {
      console.log("🆕 Creating conversation with bundle creator");
      const newConversation = await Conversation.create({
        customerId: bundle.creator._id,
        providerId: socket.userId,
        bundleId,
        messages: [],
        isActive: true,
      });
      
      socket.join(`conversation_${newConversation._id}`);
      conversations.push(newConversation);
      
      // Send conversation history for the new conversation
      const populatedConversation = await Conversation.findById(newConversation._id)
        .populate("customerId", "firstName lastName profileImage")
        .populate("providerId", "firstName lastName businessNameRegistered profileImage");

      // Populate sender info for messages (though it should be empty for new conversations)
      const messagesWithSenderInfo = await Promise.all(
        populatedConversation.messages.map(async (msg) => {
          if (msg.senderInfo) {
            return msg;
          }

          let senderInfo = null;
          if (msg.senderRole === "customer") {
            senderInfo = await Customer.findById(msg.senderId)
              .select("firstName lastName profileImage")
              .lean();
          } else if (msg.senderRole === "provider") {
            senderInfo = await ServiceProvider.findById(msg.senderId)
              .select("firstName lastName businessNameRegistered profileImage")
              .lean();
          }

          return {
            ...msg.toObject ? msg.toObject() : msg,
            senderInfo: senderInfo || undefined
          };
        })
      );

      socket.emit("message", {
        type: "conversation_history",
        data: {
          conversation: {
            _id: populatedConversation._id,
            customer: populatedConversation.customerId,
            provider: populatedConversation.providerId,
            bundleId: populatedConversation.bundleId,
          },
          messages: messagesWithSenderInfo,
        },
      });
    }

    // Send list of all conversations
    socket.emit("message", {
      type: "provider_bundle_conversations",
      data: {
        bundleId: bundleId,
        bundleTitle: bundle.title,
        conversations: conversations.map(conv => ({
          conversationId: conv._id,
          customerId: conv.customerId._id || conv.customerId,
          customerName: conv.customerId?.firstName + ' ' + conv.customerId?.lastName,
          providerId: conv.providerId._id || conv.providerId,
          messageCount: conv.messages.length,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
        })),
        message: `Joined ${conversations.length} conversation(s) for bundle ${bundle.title}`,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`✅ Provider joined ${conversations.length} conversation(s) for bundle ${bundleId}`);
    
  } catch (error) {
    console.error("❌ Provider join bundle error:", error);
    throw error;
  }
}

// New function to get bundle participants for provider
async function handleGetBundleParticipants(socket, data) {
  try {
    const { bundleId } = data;
    
    if (!bundleId) {
      socket.emit("message", {
        type: "error",
        data: { message: "bundleId is required" }
      });
      return;
    }

    if (socket.userRole !== "provider") {
      socket.emit("message", {
        type: "error",
        data: { message: "Only providers can use this endpoint" }
      });
      return;
    }

    const bundle = await Bundle.findById(bundleId)
      .populate("creator", "firstName lastName profileImage email phone")
      .populate("participants.customer", "firstName lastName profileImage email phone")
      .populate("providerOffers.provider");

    if (!bundle) {
      socket.emit("message", {
        type: "error",
        data: { message: "Bundle not found" }
      });
      return;
    }

    // Check if provider has access
    const isProvider = bundle.provider && socket.userId === bundle.provider._id.toString();
    const isOfferProvider = bundle.providerOffers?.some(
      (offer) => offer.provider && offer.provider._id.toString() === socket.userId
    );

    if (!isProvider && !isOfferProvider) {
      socket.emit("message", {
        type: "error",
        data: { message: "Access denied to this bundle" }
      });
      return;
    }

    // Get all participants including creator
    const participants = [];
    
    if (bundle.creator) {
      participants.push({
        _id: bundle.creator._id,
        firstName: bundle.creator.firstName,
        lastName: bundle.creator.lastName,
        profileImage: bundle.creator.profileImage,
        email: bundle.creator.email,
        phone: bundle.creator.phone,
        role: "creator",
        joinedAt: bundle.createdAt,
      });
    }

    bundle.participants?.forEach((participant) => {
      if (participant.customer) {
        participants.push({
          _id: participant.customer._id,
          firstName: participant.customer.firstName,
          lastName: participant.customer.lastName,
          profileImage: participant.customer.profileImage,
          email: participant.customer.email,
          phone: participant.customer.phone,
          role: "participant",
          joinedAt: participant.joinedAt,
        });
      }
    });

    // Get existing conversations
    const existingConversations = await Conversation.find({
      bundleId,
      providerId: socket.userId,
    }).select("customerId");

    const existingCustomerIds = existingConversations.map(conv => conv.customerId.toString());

    socket.emit("message", {
      type: "bundle_participants",
      data: {
        bundleId: bundleId,
        bundleTitle: bundle.title,
        participants: participants,
        existingConversations: existingCustomerIds,
        totalParticipants: participants.length,
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error("❌ Get bundle participants error:", error);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to get bundle participants: " + error.message }
    });
  }
}

// Helper function to emit realtime quick messages
const emitRealtimeQuickMessage = async (conversationId, messageData) => {
  try {
    // Emit to everyone in the conversation room
    io.to(`conversation_${conversationId}`).emit("message", {
      type: "new_quick_message",
      data: messageData
    });

    // Also emit a general new_message event for compatibility
    io.to(`conversation_${conversationId}`).emit("message", {
      type: "new_message",
      data: messageData
    });

    console.log(`📤 Realtime quick message emitted to conversation ${conversationId}`);
  } catch (error) {
    console.error("❌ Error emitting realtime message:", error);
  }
};

// Realtime Quick Chat Handler
async function handleSendQuickChat(socket, data) {
  try {
    console.log("💬 Send quick chat request:", data);

    if (!socket.userId || !socket.userRole) {
      socket.emit("message", {
        type: "error",
        data: { message: "Authentication required to send messages" },
      });
      return;
    }

    const { requestId, bundleId, quickChatId, customerId } = data;

    if (!quickChatId) {
      socket.emit("message", {
        type: "error",
        data: { message: "quickChatId is required" },
      });
      return;
    }

    // Get quick chat
    const quickChat = await QuickChat.findOne({
      _id: quickChatId,
      isActive: true,
      $or: [
        { createdBy: socket.userId },
        { createdByRole: "admin" },
        { createdByRole: socket.userRole },
      ],
    });

    if (!quickChat) {
      socket.emit("message", {
        type: "error",
        data: { message: "Quick chat not found or access denied" },
      });
      return;
    }

    // Get or create conversation
    const conversation = await getOrCreateConversationV2(socket, {
      requestId,
      bundleId,
      customerIdForBundle: customerId,
    });

    if (!conversation) {
      socket.emit("message", {
        type: "error",
        data: { message: "Conversation not found" },
      });
      return;
    }

    // Create message with unique ID
    const message = {
      _id: new mongoose.Types.ObjectId(),
      senderId: socket.userId,
      senderRole: socket.userRole,
      content: quickChat.content,
      quickChatId: quickChatId,
      timestamp: new Date(),
      isQuickChat: true,
      quickChatDetails: {
        id: quickChat._id,
        isAdminCreated: quickChat.createdByRole === "admin",
        originalCreator: quickChat.createdBy,
        originalCreatorRole: quickChat.createdByRole,
      },
    };

    // Save message to conversation
    conversation.messages.push(message);
    conversation.lastMessage = quickChat.content;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Increment quick chat usage
    quickChat.usageCount += 1;
    await quickChat.save();

    // Get user info for realtime message
    let senderInfo = {};
    if (socket.userRole === "customer") {
      const customer = await Customer.findById(socket.userId)
        .select("firstName lastName profileImage");
      senderInfo = customer;
    } else {
      const provider = await ServiceProvider.findById(socket.userId)
        .select("firstName lastName businessNameRegistered profileImage");
      senderInfo = provider;
    }

    // Prepare realtime message data
    const realtimeMessageData = {
      conversationId: conversation._id,
      message: {
        ...message,
        senderInfo: senderInfo
      },
      sender: {
        id: socket.userId,
        role: socket.userRole,
        info: senderInfo
      },
      quickChatInfo: {
        id: quickChat._id,
        content: quickChat.content,
        isAdminCreated: quickChat.createdByRole === "admin",
        usageCount: quickChat.usageCount,
      },
      timestamp: new Date().toISOString(),
    };

    // Emit realtime message to conversation room
    emitRealtimeQuickMessage(conversation._id, realtimeMessageData);

    // Notify other participant if they're not in the room
    const otherUserId = socket.userRole === "customer" 
      ? conversation.providerId 
      : conversation.customerId;
    const recipientRole = socket.userRole === "customer" ? "provider" : "customer";
    const notificationCustomerId = conversation.customerId?.toString?.();

    if (otherUserId) {
      // Send conversation update notification
      io.to(`user_${otherUserId}`).emit("message", {
        type: "conversation_updated",
        data: {
          conversationId: conversation._id,
          lastMessage: quickChat.content,
          lastMessageAt: new Date(),
          senderRole: socket.userRole,
          senderId: socket.userId,
          hasNewMessage: true,
          isQuickChat: true,
        },
      });

      // Send notification event
      const notificationPayload = buildNotification({
        title: "New message",
        body: quickChat.content,
        requestId: conversation.requestId,
        bundleId: conversation.bundleId,
        recipientRole,
        customerId: notificationCustomerId,
      });
      if (notificationPayload) {
        persistNotification(otherUserId, notificationPayload);
        emitToUser(otherUserId, "message", {
          type: "notification",
          data: notificationPayload,
        });
      }
    }

    // Send confirmation to sender
    socket.emit("message", {
      type: "quick_chat_sent",
      data: {
        success: true,
        conversationId: conversation._id,
        messageId: message._id,
        message: "Quick chat sent successfully",
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`✅ Quick chat sent in conversation ${conversation._id}`);
  } catch (error) {
    console.error("❌ Send quick chat error:", error);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to send quick chat: " + error.message },
    });
  }
}

async function handleAuthenticate(socket, data) {
  try {
    const token = typeof data === 'object' ? data.token : data;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId.toString();

    // Get user from database
    let user = await Customer.findById(socket.userId);
    if (user) {
      socket.userRole = "customer"; // Set role based on collection
    } else {
      user = await ServiceProvider.findById(socket.userId);
      if (user) {
        socket.userRole = "provider"; // Set role based on collection
      } else {
        throw new Error("User not found");
      }
    }

    socket.isAuthenticated = true;
    userSocketMap.set(socket.userId, socket.id);
    socket.join(`user_${socket.userId}`);

    console.log(`✅ Socket ${socket.id} authenticated as user ${socket.userId} (${socket.userRole})`);

    socket.emit("message", {
      type: "authenticated",
      data: {
        success: true,
        userId: socket.userId,
        userRole: socket.userRole,
        message: "Authentication successful",
      },
    });
  } catch (error) {
    console.log("❌ Authentication failed:", error.message);
    socket.emit("message", {
      type: "error",
      data: { message: "Authentication failed: " + error.message },
    });
  }
}

async function handleGetConversation(socket, data) {
  try {
    const { requestId, bundleId, customerId } = data;

    const conversation = await getOrCreateConversationV2(socket, {
      requestId,
      bundleId,
      customerIdForBundle: customerId,
    });

    if (conversation) {
      const populatedConversation = await Conversation.findById(conversation._id)
        .populate("customerId", "firstName lastName profileImage")
        .populate(
          "providerId",
          "firstName lastName businessNameRegistered profileImage"
        );

      // Populate sender info for each message in history
      const messagesWithSenderInfo = await Promise.all(
        populatedConversation.messages.map(async (msg) => {
          if (msg.senderInfo) {
            return msg;
          }

          let senderInfo = null;
          if (msg.senderRole === "customer") {
            senderInfo = await Customer.findById(msg.senderId)
              .select("firstName lastName profileImage")
              .lean();
          } else if (msg.senderRole === "provider") {
            senderInfo = await ServiceProvider.findById(msg.senderId)
              .select("firstName lastName businessNameRegistered profileImage")
              .lean();
          }

          return {
            ...msg.toObject ? msg.toObject() : msg,
            senderInfo: senderInfo || undefined
          };
        })
      );

      socket.emit("message", {
        type: "conversation_history",
        data: {
          conversation: {
            _id: populatedConversation._id,
            customer: populatedConversation.customerId,
            provider: populatedConversation.providerId,
            requestId: populatedConversation.requestId,
            bundleId: populatedConversation.bundleId,
            lastMessage: populatedConversation.lastMessage,
            lastMessageAt: populatedConversation.lastMessageAt,
          },
          messages: messagesWithSenderInfo,
        },
      });
    } else {
      socket.emit("message", {
        type: "conversation_history",
        data: {
          conversation: null,
          messages: [],
        },
      });
    }
  } catch (error) {
    console.error("❌ Get conversation error:", error);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to get conversation: " + error.message },
    });
  }
}

async function handleListConversations(socket) {
  try {
    if (!socket.userId || !socket.userRole) {
      socket.emit("message", {
        type: "error",
        data: { message: "Authentication required to list conversations" },
      });
      return;
    }

    let conversations;
    
    if (socket.userRole === "customer") {
      conversations = await Conversation.find({
        customerId: socket.userId,
        isActive: true,
      })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .populate("customerId", "firstName lastName profileImage")
        .populate(
          "providerId",
          "firstName lastName businessNameRegistered profileImage"
        )
        .populate({
          path: "requestId",
          select: "serviceType status scheduledDate scheduledTime avgPrice",
        })
        .populate({
          path: "bundleId",
          select: "title status scheduledDate scheduledTime totalPrice",
        });
    } else {
      conversations = await Conversation.find({
        providerId: socket.userId,
      })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .populate("customerId", "firstName lastName profileImage")
        .populate(
          "providerId",
          "firstName lastName businessNameRegistered profileImage"
        );
    }

    socket.emit("message", {
      type: "conversations_list",
      data: {
        conversations: conversations,
        totalCount: conversations.length,
        userRole: socket.userRole,
      },
    });
  } catch (err) {
    console.error("[chat] list conversations error:", err);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to load conversations" },
    });
  }
}

// Function to get available quick chats
async function handleGetAvailableQuickChats(socket) {
  try {
    if (!socket.userId || !socket.userRole) {
      socket.emit("message", {
        type: "error",
        data: { message: "Authentication required" }
      });
      return;
    }

    const quickChats = await QuickChat.find({
      isActive: true,
      $or: [
        { createdBy: socket.userId },
        { createdByRole: "admin" },
        { createdByRole: socket.userRole },
      ]
    }).sort({ usageCount: -1, createdAt: -1 });

    socket.emit("message", {
      type: "available_quick_chats",
      data: {
        quickChats: quickChats,
        count: quickChats.length,
        userRole: socket.userRole,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("❌ Get quick chats error:", error);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to get quick chats: " + error.message }
    });
  }
}

async function handleSendMessage(socket, data) {
  try {
    console.log("[chat] send_message request:", data);

    if (!socket.userId || !socket.userRole) {
      socket.emit("message", {
        type: "error",
        data: { message: "Authentication required to send messages" },
      });
      return;
    }

    const { requestId, bundleId, customerId, content } = data || {};

    if (!content || (!requestId && !bundleId)) {
      socket.emit("message", {
        type: "error",
        data: { message: "Content and requestId or bundleId are required" },
      });
      return;
    }

    const conversation = await getOrCreateConversationV2(socket, {
      requestId,
      bundleId,
      customerIdForBundle: customerId,
    });

    if (!conversation) {
      socket.emit("message", {
        type: "error",
        data: { message: "Conversation not found" },
      });
      return;
    }

    socket.join(`conversation_${conversation._id}`);

    // Get user info for message
    let senderInfo = {};
    if (socket.userRole === "customer") {
      const customer = await Customer.findById(socket.userId)
        .select("firstName lastName profileImage");
      senderInfo = customer;
    } else {
      const provider = await ServiceProvider.findById(socket.userId)
        .select("firstName lastName businessNameRegistered profileImage");
      senderInfo = provider;
    }

    const message = {
      _id: new mongoose.Types.ObjectId(),
      senderId: socket.userId,
      senderRole: socket.userRole,
      senderInfo: senderInfo,
      content,
      timestamp: new Date(),
    };

    conversation.messages.push(message);
    conversation.lastMessage = content;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const messageData = {
      type: "new_message",
      data: {
        conversationId: conversation._id,
        message,
        sender: {
          id: socket.userId,
          role: socket.userRole,
          info: senderInfo
        },
      },
    };

    // Emit to conversation room
    io.to(`conversation_${conversation._id}`).emit("message", messageData);

    // Notify other user
    const otherUserId = socket.userRole === "customer"
      ? conversation.providerId
      : conversation.customerId;
    const recipientRole = socket.userRole === "customer" ? "provider" : "customer";
    const notificationCustomerId = conversation.customerId?.toString?.();

    if (otherUserId) {
      io.to(`user_${otherUserId}`).emit("message", {
        type: "conversation_updated",
        data: {
          conversationId: conversation._id,
          lastMessage: content,
          lastMessageAt: new Date(),
          senderRole: socket.userRole,
          hasNewMessage: true,
        },
      });

      const notificationPayload = buildNotification({
        title: "New message",
        body: content,
        requestId: conversation.requestId,
        bundleId: conversation.bundleId,
        recipientRole,
        customerId: notificationCustomerId,
      });
      if (notificationPayload) {
        persistNotification(otherUserId, notificationPayload);
        emitToUser(otherUserId, "message", {
          type: "notification",
          data: notificationPayload,
        });
      }
    }

    socket.emit("message", {
      type: "message_sent",
      data: {
        success: true,
        conversationId: conversation._id,
        message: "Message sent successfully",
      },
    });
  } catch (error) {
    console.error("[chat] Send message error:", error);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to send message: " + error.message },
    });
  }
}

async function handleJoinAllConversations(socket) {
  try {
    if (!socket.userId || !socket.userRole) {
      socket.emit("message", {
        type: "error",
        data: { message: "Authentication required to join conversations" },
      });
      return;
    }

    let conversations;
    
    if (socket.userRole === "customer") {
      conversations = await Conversation.find({
        customerId: socket.userId,
        isActive: true,
      }).select("_id requestId bundleId customerId providerId");
    } else {
      conversations = await Conversation.find({
        providerId: socket.userId,
      }).select("_id requestId bundleId customerId providerId");
    }

    conversations.forEach((conv) => {
      socket.join(`conversation_${conv._id}`);
    });

    socket.join(`user_${socket.userId}`);

    socket.emit("message", {
      type: "joined_all_conversations",
      data: {
        joined: conversations.map((c) => ({
          conversationId: c._id,
          requestId: c.requestId,
          bundleId: c.bundleId,
          type: c.requestId ? "service_request" : "bundle",
        })),
        count: conversations.length,
        message: "Joined all conversations for realtime updates",
      },
    });

    console.log(`✅ ${socket.userRole} ${socket.userId} joined ${conversations.length} conversation rooms`);
  } catch (err) {
    console.error("[chat] join all conversations error:", err);
    socket.emit("message", {
      type: "error",
      data: { message: "Failed to join conversations" },
    });
  }
}

const initSocket = (server) => {
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CLIENT_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    connectTimeout: 30000,
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const userId = socket.userId;

    if (userId && socket.userRole) {
      console.log(`✅ Client connected: ${socket.id} for user ${userId} (${socket.userRole})`);
      userSocketMap.set(userId, socket.id);
      socket.join(`user_${userId}`);

      socket.emit("message", {
        type: "welcome",
        data: {
          message: "Welcome! You are authenticated.",
          userId: userId,
          userRole: socket.userRole,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      console.log(`✅ Client connected: ${socket.id} (unauthenticated)`);
      socket.isAuthenticated = false;

      socket.emit("message", {
        type: "welcome",
        data: {
          message: "Welcome! Please authenticate to use chat features.",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Handle message events
    socket.on("message", (data) => {
      console.log("📨 Message received:", data);

      if (typeof data === "string") {
        socket.emit("message", {
          type: "pong",
          data: {
            message: "Pong!",
            yourMessage: data,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { type, data: eventData } = data;

      if (!type) {
        socket.emit("message", {
          type: "error",
          data: { message: "Message must have 'type' field" },
        });
        return;
      }

      switch (type) {
        case "join_conversation":
          handleJoinConversation(socket, eventData);
          break;
        case "send_quick_chat":
          handleSendQuickChat(socket, eventData);
          break;
        case "send_message":
          handleSendMessage(socket, eventData);
          break;
        case "authenticate":
          handleAuthenticate(socket, eventData);
          break;
        case "get_conversation":
          handleGetConversation(socket, eventData);
          break;
        case "list_conversations":
          handleListConversations(socket);
          break;
        case "get_customer_conversations":
          handleGetCustomerConversations(socket);
          break;
        case "get_available_quick_chats":
          handleGetAvailableQuickChats(socket);
          break;
        case "get_bundle_participants":
          handleGetBundleParticipants(socket, eventData);
          break;
        case "join_all_conversations":
          handleJoinAllConversations(socket);
          break;
        case "ping":
          socket.emit("message", {
            type: "pong",
            data: {
              message: "Pong from server!",
              timestamp: new Date().toISOString(),
            },
          });
          break;
        default:
          socket.emit("message", {
            type: "error",
            data: { message: "Unknown event type: " + type },
          });
      }
    });

    // Direct event handlers
    socket.on("authenticate", (data) => {
      handleAuthenticate(socket, data);
    });

    socket.on("join_conversation", (data) => {
      handleJoinConversation(socket, data);
    });

    socket.on("send_quick_chat", (data) => {
      handleSendQuickChat(socket, data);
    });

    socket.on("get_conversation", (data) => {
      handleGetConversation(socket, data);
    });

    socket.on("get_customer_conversations", () => {
      handleGetCustomerConversations(socket);
    });

    socket.on("get_available_quick_chats", () => {
      handleGetAvailableQuickChats(socket);
    });

    socket.on("get_bundle_participants", (data) => {
      handleGetBundleParticipants(socket, data);
    });

    socket.on("list_conversations", () => {
      handleListConversations(socket);
    });

    socket.on("send_message", (data) => {
      handleSendMessage(socket, data);
    });

    socket.on("join_all_conversations", () => {
      handleJoinAllConversations(socket);
    });

    // Test events
    socket.on("ping", (data) => {
      socket.emit("pong", {
        message: "Pong! Server is working!",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", (reason) => {
      const userId = socket.userId;
      if (userId) {
        console.log(`❌ Client disconnected: ${socket.id} for user ${userId}`);
        userSocketMap.delete(userId);
      } else {
        console.log(`❌ Client disconnected: ${socket.id}`);
      }
    });
  });

  console.log("✅ Socket.io server initialized with conversation system");
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

const emitToUser = (userId, event, data) => {
  const socketId = userSocketMap.get(userId.toString());
  if (socketId) {
    getIO().to(socketId).emit(event, data);
    return true;
  }
  return false;
};

module.exports = {
  initSocket,
  getIO,
  emitToUser,
};
