const QuickChat = require("../models/QuickChat");

// Get all quick chats for the current user (including admin-created)
exports.getQuickChats = async (req, res) => {
  try {
    const userQuickChats = {
      createdBy: req.user._id,
      createdByRole: req.user.role,
      isActive: true,
    };
    const adminQuickChats = {
      createdByRole: 'admin',
      isActive: true,
    };

    const quickChats = await QuickChat.find({
      $or: [userQuickChats, adminQuickChats],
    }).sort({ createdByRole: 1, usageCount: -1, createdAt: -1 });

    res.json({
      success: true,
      data: { quickChats },
    });
  } catch (error) {
    console.error("Get quick chats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch quick chats",
      error: error.message,
    });
  }
};

// Create new quick chat (no category required)
exports.createQuickChat = async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Quick chat content is required",
      });
    }

    // Check if similar quick chat already exists for this user
    const existingQuickChat = await QuickChat.findOne({
      createdBy: req.user._id,
      createdByRole: req.user.role,
      content: content.trim(),
      isActive: true,
    });

    if (existingQuickChat) {
      return res.status(400).json({
        success: false,
        message: "You already have a quick chat with similar content",
      });
    }

    const quickChat = new QuickChat({
      content: content.trim(),
      createdBy: req.user._id,
      createdByRole: req.user.role,
    });

    await quickChat.save();

    res.status(201).json({
      success: true,
      message: "Quick chat created successfully",
      data: { quickChat },
    });
  } catch (error) {
    console.error("Create quick chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create quick chat",
      error: error.message,
    });
  }
};

// Delete quick chat (user can only delete their own)
exports.deleteQuickChat = async (req, res) => {
  try {
    const { quickChatId } = req.params;

    const quickChat = await QuickChat.findOneAndDelete({
      _id: quickChatId,
      createdBy: req.user._id, // Users can only delete their own quick chats
      createdByRole: req.user.role,
    });

    if (!quickChat) {
      return res.status(404).json({
        success: false,
        message: "Quick chat not found or access denied",
      });
    }

    res.json({
      success: true,
      message: "Quick chat deleted successfully",
    });
  } catch (error) {
    console.error("Delete quick chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete quick chat",
      error: error.message,
    });
  }
};

// Update quick chat content
exports.updateQuickChat = async (req, res) => {
  try {
    const { quickChatId } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Quick chat content is required",
      });
    }

    const quickChat = await QuickChat.findOneAndUpdate(
      {
        _id: quickChatId,
        createdBy: req.user._id, // Users can only update their own quick chats
        createdByRole: req.user.role,
      },
      {
        content: content.trim(),
      },
      { new: true, runValidators: true }
    );

    if (!quickChat) {
      return res.status(404).json({
        success: false,
        message: "Quick chat not found or access denied",
      });
    }

    res.json({
      success: true,
      message: "Quick chat updated successfully",
      data: { quickChat },
    });
  } catch (error) {
    console.error("Update quick chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update quick chat",
      error: error.message,
    });
  }
};

// Get all admin-created quick chats
exports.getAdminQuickChats = async (req, res) => {
  try {
    const quickChats = await QuickChat.find({
      createdByRole: 'admin',
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { quickChats },
    });
  } catch (error) {
    console.error("Get admin quick chats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin quick chats",
      error: error.message,
    });
  }
};

// Create a new quick chat as an admin
exports.createAdminQuickChat = async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Quick chat content is required",
      });
    }

    const quickChat = new QuickChat({
      content: content.trim(),
      createdBy: req.user._id,
      createdByRole: 'admin',
    });

    await quickChat.save();

    res.status(201).json({
      success: true,
      message: "Admin quick chat created successfully",
      data: { quickChat },
    });
  } catch (error) {
    console.error("Create admin quick chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create admin quick chat",
      error: error.message,
    });
  }
};

// Update an admin-created quick chat
exports.updateAdminQuickChat = async (req, res) => {
  try {
    const { quickChatId } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Quick chat content is required",
      });
    }

    const quickChat = await QuickChat.findOneAndUpdate(
      {
        _id: quickChatId,
        createdByRole: 'admin',
      },
      {
        content: content.trim(),
      },
      { new: true, runValidators: true }
    );

    if (!quickChat) {
      return res.status(404).json({
        success: false,
        message: "Admin quick chat not found",
      });
    }

    res.json({
      success: true,
      message: "Admin quick chat updated successfully",
      data: { quickChat },
    });
  } catch (error) {
    console.error("Update admin quick chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update admin quick chat",
      error: error.message,
    });
  }
};

// Delete an admin-created quick chat
exports.deleteAdminQuickChat = async (req, res) => {
  try {
    const { quickChatId } = req.params;

    const quickChat = await QuickChat.findOneAndDelete({
      _id: quickChatId,
      createdByRole: 'admin',
    });

    if (!quickChat) {
      return res.status(404).json({
        success: false,
        message: "Admin quick chat not found",
      });
    }

    res.json({
      success: true,
      message: "Admin quick chat deleted successfully",
    });
  } catch (error) {
    console.error("Delete admin quick chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete admin quick chat",
      error: error.message,
    });
  }
};
