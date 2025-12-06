const Admin = require("../models/Admin");
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const jwt = require("jsonwebtoken");

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "24h" });
};

// Initialize admin user on server start
exports.initializeAdmin = async () => {
  try {
    const existingAdmin = await Admin.findOne({
      email: process.env.ADMIN_USERNAME,
    });

    if (!existingAdmin) {
      console.log("🔄 Creating admin user...");

      const admin = new Admin({
        firstName: process.env.ADMIN_FIRST_NAME,
        lastName: process.env.ADMIN_LAST_NAME,
        email: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
        phone: process.env.ADMIN_PHONE,
        role: "admin",
      });

      await admin.save();
      console.log("✅ Admin user created successfully");
    } else {
      console.log("✅ Admin user already exists");
    }
  } catch (error) {
    console.error("❌ Error creating admin user:", error.message);
  }
};

// Admin login
exports.adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    const secretKey =
      req.headers["x-admin-secret"] || req.headers["admin-secret"];

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    // Verify secret key from header
    if (!secretKey || secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin secret key",
      });
    }

    // Find or create admin
    let admin = await Admin.findOne({ email: username });

    if (!admin) {
      admin = new Admin({
        firstName: process.env.ADMIN_FIRST_NAME,
        lastName: process.env.ADMIN_LAST_NAME,
        email: username,
        password: password,
        phone: process.env.ADMIN_PHONE,
        role: "admin",
      });
      await admin.save();
    }

    // Check credentials
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Generate token
    const token = generateToken(admin._id);

    // Update last login
    admin.lastLogin = new Date();
    admin.loginHistory.push({
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get("User-Agent") || "Unknown",
    });

    if (admin.loginHistory.length > 10) {
      admin.loginHistory = admin.loginHistory.slice(-10);
    }

    await admin.save();

    res.json({
      success: true,
      message: "Admin login successful",
      data: {
        token,
        admin: {
          id: admin._id,
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          role: admin.role,
          adminRole: admin.adminRole,
          permissions: admin.permissions,
          lastLogin: admin.lastLogin,
        },
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({
      success: false,
      message: "Admin login failed",
      error: error.message,
    });
  }
};

// Get dashboard statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const totalProviders = await ServiceProvider.countDocuments();
    const pendingApprovals = await ServiceProvider.countDocuments({
      isApproved: false,
    });
    const activeProviders = await ServiceProvider.countDocuments({
      isApproved: true,
      isActive: true,
    });

    // Recent registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCustomers = await Customer.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    const recentProviders = await ServiceProvider.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    res.json({
      success: true,
      data: {
        stats: {
          totalCustomers,
          totalProviders,
          pendingApprovals,
          activeProviders,
          recentCustomers,
          recentProviders,
        },
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
      error: error.message,
    });
  }
};

// Get all customers
exports.getAllCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * limit;

    const filter = {};
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const customers = await Customer.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Customer.countDocuments(filter);

    res.json({
      success: true,
      data: {
        customers,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get all customers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
      error: error.message,
    });
  }
};

// Get all providers
exports.getAllProviders = async (req, res) => {
  try {
    const { page = 1, limit = 10, approved, search } = req.query;
    const skip = (page - 1) * limit;

    const filter = {};
    if (approved !== undefined) filter.isApproved = approved === "true";
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { businessNameRegistered: { $regex: search, $options: "i" } },
      ];
    }

    const providers = await ServiceProvider.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ServiceProvider.countDocuments(filter);

    res.json({
      success: true,
      data: {
        providers,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get all providers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
      error: error.message,
    });
  }
};

// Approve/Reject provider
exports.approveProvider = async (req, res) => {
  try {
    const { providerId } = req.params;
    const { approved, reason } = req.body;

    const provider = await ServiceProvider.findById(providerId);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Service provider not found",
      });
    }

    provider.isApproved = approved;
    if (reason) {
      provider.approvalNotes = reason;
    }

    await provider.save();

    res.json({
      success: true,
      message: `Service provider ${
        approved ? "approved" : "rejected"
      } successfully`,
      data: { provider },
    });
  } catch (error) {
    console.error("Approve provider error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update provider status",
      error: error.message,
    });
  }
};

// Update user status
exports.updateUserStatus = async (req, res) => {
  try {
    const { userId, role } = req.params;
    const { isActive } = req.body;

    let user;
    if (role === "customer") {
      user = await Customer.findByIdAndUpdate(
        userId,
        { isActive },
        { new: true }
      ).select("-password");
    } else if (role === "provider") {
      user = await ServiceProvider.findByIdAndUpdate(
        userId,
        { isActive },
        { new: true }
      ).select("-password");
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: `User ${isActive ? "activated" : "deactivated"} successfully`,
      data: { user },
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user status",
      error: error.message,
    });
  }
};

// Get admin profile
exports.getAdminProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user._id).select("-password");

    res.json({
      success: true,
      data: { admin },
    });
  } catch (error) {
    console.error("Get admin profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin profile",
      error: error.message,
    });
  }
};
