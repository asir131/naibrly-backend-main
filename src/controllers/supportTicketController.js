const SupportTicket = require("../models/SupportTicket");
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Admin = require("../models/Admin");
const { sendNotification, sendNotificationToUsers } = require("../utils/notification");

// Create a new support ticket (Public - anyone can create)
exports.createTicket = async (req, res) => {
  try {
    let { name, email, subject, description, category, priority, attachments } = req.body;

    // Check if the user is authenticated
    let user = null;
    let userModel = null;

    if (req.user) {
      // User is authenticated - auto-fill name and email from their profile
      user = req.user._id;
      userModel = req.user.role === "customer" ? "Customer" : "ServiceProvider";

      // Auto-fill name and email if not provided
      if (!name) {
        name = `${req.user.firstName} ${req.user.lastName}`;
      }
      if (!email) {
        email = req.user.email;
      }
    }

    // Set default category if not provided
    const ticketCategory = category || "General Inquiry";

    // If subject is not provided, use the category as the subject
    // This is useful when customers only select a category from dropdown
    if (!subject || subject.trim().length === 0) {
      subject = ticketCategory;
    }

    // Validation
    if (!name || !email || !description) {
      return res.status(400).json({
        success: false,
        message: "Description is required",
      });
    }

    // Create the ticket
    const ticket = new SupportTicket({
      name,
      email,
      subject,
      description,
      category: ticketCategory,
      priority: priority || "Medium",
      user,
      userModel,
      attachments: attachments || [],
    });

    await ticket.save();

    const admins = await Admin.find().select("_id");
    await sendNotificationToUsers({
      userIds: admins.map((a) => a._id),
      title: "New support ticket",
      body: subject || ticketCategory || "Support request",
      link: "/admin/support",
    });

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: { ticket },
    });
  } catch (error) {
    console.error("Create ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create support ticket",
      error: error.message,
    });
  }
};

// Get all tickets (Admin only)
exports.getAllTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      priority,
      category,
      search,
      sortBy = "createdAt",
      order = "desc",
    } = req.query;

    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { ticketId: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
      ];
    }

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = order === "asc" ? 1 : -1;

    const tickets = await SupportTicket.find(filter)
      .populate("user", "firstName lastName email phone")
      .populate("assignedTo", "firstName lastName email")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SupportTicket.countDocuments(filter);

    // Get statistics
    const stats = {
      total: await SupportTicket.countDocuments(),
      unsolved: await SupportTicket.countDocuments({ status: "Unsolved" }),
      open: await SupportTicket.countDocuments({ status: "Open" }),
      resolved: await SupportTicket.countDocuments({ status: "Resolved" }),
    };

    res.json({
      success: true,
      data: {
        tickets,
        stats,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get all tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
      error: error.message,
    });
  }
};

// Get single ticket by ID
exports.getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findById(ticketId)
      .populate("user", "firstName lastName email phone profileImage")
      .populate("assignedTo", "firstName lastName email")
      .populate("lastUpdatedBy", "firstName lastName email")
      .populate({
        path: "replies.repliedBy",
        select: "firstName lastName email profileImage",
      });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Security check: If not admin, user can only view their own tickets
    if (req.user && req.user.role !== "admin") {
      const isOwner =
        (ticket.user && ticket.user._id.toString() === req.user._id.toString()) ||
        ticket.email === req.user.email;

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this ticket",
        });
      }
    }

    res.json({
      success: true,
      data: { ticket },
    });
  } catch (error) {
    console.error("Get ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ticket",
      error: error.message,
    });
  }
};

// Get ticket by ticket ID string (e.g., "ADG39")
exports.getTicketByTicketId = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findOne({ ticketId })
      .populate("user", "firstName lastName email phone profileImage")
      .populate("assignedTo", "firstName lastName email")
      .populate("lastUpdatedBy", "firstName lastName email")
      .populate({
        path: "replies.repliedBy",
        select: "firstName lastName email profileImage",
      });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.json({
      success: true,
      data: { ticket },
    });
  } catch (error) {
    console.error("Get ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ticket",
      error: error.message,
    });
  }
};

// Update ticket status (Admin only)
exports.updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    ticket.status = status;
    if (notes) ticket.notes = notes;
    ticket.lastUpdatedBy = req.user._id;

    await ticket.save();

    if (ticket.user) {
      await sendNotification({
        userId: ticket.user,
        title: "Support ticket status updated",
        body: `Your ticket status is now ${status}`,
        link: "/contact",
      });
    }

    res.json({
      success: true,
      message: "Ticket status updated successfully",
      data: { ticket },
    });
  } catch (error) {
    console.error("Update ticket status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update ticket status",
      error: error.message,
    });
  }
};

// Update ticket (Admin only)
exports.updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, priority, category, assignedTo, notes, tags } = req.body;

    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Update fields if provided
    if (status) ticket.status = status;
    if (priority) ticket.priority = priority;
    if (category) ticket.category = category;
    if (assignedTo) ticket.assignedTo = assignedTo;
    if (notes !== undefined) ticket.notes = notes;
    if (tags) ticket.tags = tags;

    ticket.lastUpdatedBy = req.user._id;

    await ticket.save();

    if (isAdmin && ticket.user) {
      await sendNotification({
        userId: ticket.user,
        title: "Support reply",
        body: "An admin replied to your support ticket",
        link: "/contact",
      });
    } else {
      const admins = await Admin.find().select("_id");
      await sendNotificationToUsers({
        userIds: admins.map((a) => a._id),
        title: "Support ticket reply",
        body: `New reply on ticket ${ticket.ticketId || ticket._id}`,
        link: "/admin/support",
      });
    }

    const updatedTicket = await SupportTicket.findById(ticketId)
      .populate("user", "firstName lastName email phone")
      .populate("assignedTo", "firstName lastName email")
      .populate("lastUpdatedBy", "firstName lastName email");

    if (ticket.user) {
      await sendNotification({
        userId: ticket.user,
        title: "Support ticket updated",
        body: "Your support ticket was updated",
        link: "/contact",
      });
    }

    res.json({
      success: true,
      message: "Ticket updated successfully",
      data: { ticket: updatedTicket },
    });
  } catch (error) {
    console.error("Update ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update ticket",
      error: error.message,
    });
  }
};

// Add reply to ticket
exports.addReply = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Reply message is required",
      });
    }

    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Security check: If not admin, user can only reply to their own tickets
    if (req.user && req.user.role !== "admin") {
      const isOwner =
        (ticket.user && ticket.user._id.toString() === req.user._id.toString()) ||
        ticket.email === req.user.email;

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to reply to this ticket",
        });
      }
    }

    // Determine who is replying
    let repliedBy = null;
    let repliedByModel = null;
    let repliedByName = "";
    let repliedByEmail = "";
    let isAdmin = false;

    if (req.user) {
      repliedBy = req.user._id;
      repliedByName = `${req.user.firstName} ${req.user.lastName}`;
      repliedByEmail = req.user.email;

      if (req.user.role === "admin") {
        repliedByModel = "Admin";
        isAdmin = true;
      } else if (req.user.role === "customer") {
        repliedByModel = "Customer";
      } else if (req.user.role === "provider") {
        repliedByModel = "ServiceProvider";
      }
    }

    // Add reply
    ticket.replies.push({
      message: message.trim(),
      repliedBy,
      repliedByModel,
      repliedByName,
      repliedByEmail,
      isAdmin,
    });

    // Update ticket status to "Open" if it was "Unsolved" and admin is replying
    if (isAdmin && ticket.status === "Unsolved") {
      ticket.status = "Open";
    }

    ticket.lastUpdatedBy = req.user?._id;

    await ticket.save();

    if (isAdmin && ticket.user) {
      await sendNotification({
        userId: ticket.user,
        title: "Support reply",
        body: "An admin replied to your support ticket",
        link: "/contact",
      });
    } else {
      const admins = await Admin.find().select("_id");
      await sendNotificationToUsers({
        userIds: admins.map((a) => a._id),
        title: "Support ticket reply",
        body: `New reply on ticket ${ticket.ticketId || ticket._id}`,
        link: "/admin/support",
      });
    }

    const updatedTicket = await SupportTicket.findById(ticketId)
      .populate("user", "firstName lastName email phone")
      .populate("assignedTo", "firstName lastName email")
      .populate({
        path: "replies.repliedBy",
        select: "firstName lastName email profileImage",
      });

    res.json({
      success: true,
      message: "Reply added successfully",
      data: { ticket: updatedTicket },
    });
  } catch (error) {
    console.error("Add reply error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add reply",
      error: error.message,
    });
  }
};

// Delete ticket (Admin only)
exports.deleteTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findByIdAndDelete(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.json({
      success: true,
      message: "Ticket deleted successfully",
    });
  } catch (error) {
    console.error("Delete ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete ticket",
      error: error.message,
    });
  }
};

// Get user's own tickets (for authenticated customers/providers)
exports.getMyTickets = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {
      $or: [
        { user: req.user._id },
        { email: req.user.email },
      ],
    };

    if (status) filter.status = status;

    const tickets = await SupportTicket.find(filter)
      .populate("assignedTo", "firstName lastName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SupportTicket.countDocuments(filter);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get my tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your tickets",
      error: error.message,
    });
  }
};

// Get ticket statistics (Admin only)
exports.getTicketStats = async (req, res) => {
  try {
    const total = await SupportTicket.countDocuments();
    const unsolved = await SupportTicket.countDocuments({ status: "Unsolved" });
    const open = await SupportTicket.countDocuments({ status: "Open" });
    const resolved = await SupportTicket.countDocuments({ status: "Resolved" });

    // Get statistics by category
    const byCategory = await SupportTicket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get statistics by priority
    const byPriority = await SupportTicket.aggregate([
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 },
        },
      },
    ]);

    // Recent tickets (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentTickets = await SupportTicket.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    // Average resolution time (for resolved tickets)
    const resolvedTickets = await SupportTicket.find({
      status: "Resolved",
      solvedDate: { $exists: true },
    }).select("createdAt solvedDate");

    let totalResolutionTime = 0;
    resolvedTickets.forEach((ticket) => {
      const resolutionTime = ticket.solvedDate - ticket.createdAt;
      totalResolutionTime += resolutionTime;
    });

    const averageResolutionTime =
      resolvedTickets.length > 0
        ? totalResolutionTime / resolvedTickets.length
        : 0;

    // Convert to hours
    const averageResolutionHours = (averageResolutionTime / (1000 * 60 * 60)).toFixed(2);

    res.json({
      success: true,
      data: {
        total,
        unsolved,
        open,
        resolved,
        recentTickets,
        averageResolutionHours,
        byCategory,
        byPriority,
      },
    });
  } catch (error) {
    console.error("Get ticket stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ticket statistics",
      error: error.message,
    });
  }
};
