const Admin = require("../models/Admin");
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const ServiceRequest = require("../models/ServiceRequest");
const Bundle = require("../models/Bundle");
const MoneyRequest = require("../models/MoneyRequest");
const Verification = require("../models/Verification");
const SupportTicket = require("../models/SupportTicket");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const jwt = require("jsonwebtoken");
const { deleteImageFromCloudinary } = require("../config/cloudinary");

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

    // SECURITY FIX: Only allow login with the exact admin credentials from .env
    if (username !== process.env.ADMIN_USERNAME) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Find admin - should only be the one created during initialization
    const admin = await Admin.findOne({ email: username });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
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

// Helper function to calculate growth percentage
const calculateGrowth = (currentValue, previousValue) => {
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }
  return ((currentValue - previousValue) / previousValue) * 100;
};

// Get dashboard statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date filter for queries
    let dateFilter = {};
    let currentPeriodStart, currentPeriodEnd;
    let previousPeriodStart, previousPeriodEnd;
    let growthPeriodLabel = "last30Days";

    if (startDate && endDate) {
      // Custom date range provided
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0); // Start of day

      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // End of day

      dateFilter = {
        createdAt: { $gte: start, $lte: end },
      };

      // For growth comparison with custom dates:
      // Current period = selected date range
      // Previous period = same duration before the start date
      currentPeriodStart = new Date(start);
      currentPeriodEnd = new Date(end);

      // Calculate the duration in milliseconds
      const duration = end - start;

      // Previous period ends just before current period starts
      previousPeriodEnd = new Date(start);
      previousPeriodEnd.setMilliseconds(-1); // Just before start

      // Previous period starts duration milliseconds before
      previousPeriodStart = new Date(previousPeriodEnd - duration);
      previousPeriodStart.setHours(0, 0, 0, 0);

      // Calculate number of days for label
      const days = Math.ceil(duration / (1000 * 60 * 60 * 24));
      growthPeriodLabel = `selected${days}Days`;
    } else {
      // No custom date range - use default last 30 days
      const now = new Date();
      currentPeriodEnd = new Date(now);
      currentPeriodStart = new Date(now);
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 30);
      currentPeriodStart.setHours(0, 0, 0, 0);

      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(-1);
      previousPeriodStart = new Date(previousPeriodEnd);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 30);
      previousPeriodStart.setHours(0, 0, 0, 0);

      growthPeriodLabel = "last30Days";
    }

    // Count customers (with date filter if provided)
    const totalCustomers = await Customer.countDocuments(dateFilter);
    const totalProviders = await ServiceProvider.countDocuments(dateFilter);

    // Growth calculation: Customers (current period vs previous period)
    const customersCurrentPeriod = await Customer.countDocuments({
      createdAt: { $gte: currentPeriodStart, $lte: currentPeriodEnd },
    });

    const customersPreviousPeriod = await Customer.countDocuments({
      createdAt: { $gte: previousPeriodStart, $lte: previousPeriodEnd },
    });

    const customersGrowth = calculateGrowth(customersCurrentPeriod, customersPreviousPeriod);

    // Growth calculation: Providers (current period vs previous period)
    const providersCurrentPeriod = await ServiceProvider.countDocuments({
      createdAt: { $gte: currentPeriodStart, $lte: currentPeriodEnd },
    });

    const providersPreviousPeriod = await ServiceProvider.countDocuments({
      createdAt: { $gte: previousPeriodStart, $lte: previousPeriodEnd },
    });

    const providersGrowth = calculateGrowth(providersCurrentPeriod, providersPreviousPeriod);

    const pendingApprovals = await ServiceProvider.countDocuments({
      isApproved: false,
      ...dateFilter,
    });

    const activeProviders = await ServiceProvider.countDocuments({
      isApproved: true,
      isActive: true,
      ...dateFilter,
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

    // Calculate revenue from PAID money requests (actual Stripe payments)
    // Apply date filter to payment date if date range is provided
    let revenueFilter = { status: "paid" };

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      revenueFilter["paymentDetails.paidAt"] = { $gte: start, $lte: end };
    }

    const paidMoneyRequests = await MoneyRequest.find(revenueFilter).select(
      "totalAmount commission paymentDetails.paidAt"
    );

    let totalRevenue = 0; // Total amount customers paid through Stripe
    let totalCommissionEarned = 0; // Admin's commission income
    let totalProviderEarnings = 0; // Amount providers receive

    paidMoneyRequests.forEach((request) => {
      const paidAmount = request.totalAmount || 0; // Amount customer paid
      const commissionAmount = request.commission?.amount || 0; // Admin's cut
      const providerAmount = request.commission?.providerAmount || 0; // Provider's cut

      totalRevenue += paidAmount;
      totalCommissionEarned += commissionAmount;
      totalProviderEarnings += providerAmount;
    });

    // Growth calculation: Revenue (current period vs previous period)
    const revenueCurrentPeriod = await MoneyRequest.find({
      status: "paid",
      "paymentDetails.paidAt": { $gte: currentPeriodStart, $lte: currentPeriodEnd },
    }).select("totalAmount commission");

    const revenuePreviousPeriod = await MoneyRequest.find({
      status: "paid",
      "paymentDetails.paidAt": { $gte: previousPeriodStart, $lte: previousPeriodEnd },
    }).select("totalAmount commission");

    let revenueCurrent = 0;
    let commissionCurrent = 0;
    revenueCurrentPeriod.forEach((request) => {
      revenueCurrent += request.totalAmount || 0;
      commissionCurrent += request.commission?.amount || 0;
    });

    let revenuePrevious = 0;
    let commissionPrevious = 0;
    revenuePreviousPeriod.forEach((request) => {
      revenuePrevious += request.totalAmount || 0;
      commissionPrevious += request.commission?.amount || 0;
    });

    const revenueGrowth = calculateGrowth(revenueCurrent, revenuePrevious);
    const balanceGrowth = calculateGrowth(commissionCurrent, commissionPrevious);

    // Total users = Customers + Providers
    const totalUsers = totalCustomers + totalProviders;

    // Pending Actions - counts for admin dashboard
    const pendingVerifications = await Verification.countDocuments({
      status: "pending",
    });

    const newSupportTickets = await SupportTicket.countDocuments({
      status: "Unsolved",
    });

    const pendingWithdrawals = await WithdrawalRequest.countDocuments({
      status: "pending",
    });

    res.json({
      success: true,
      data: {
        dateRange: {
          startDate: startDate || null,
          endDate: endDate || null,
          isFiltered: !!(startDate && endDate),
        },
        stats: {
          totalUsers,
          totalCustomers,
          totalProviders,
          totalRevenue, // Total amount paid by customers via Stripe
          totalCommissionEarned, // Admin's commission income (My Balance)
          totalProviderEarnings, // Total paid to providers
          pendingApprovals,
          activeProviders,
          recentCustomers,
          recentProviders,
        },
        growth: {
          customers: {
            value: parseFloat(customersGrowth.toFixed(2)),
            period: growthPeriodLabel,
            current: customersCurrentPeriod,
            previous: customersPreviousPeriod,
            currentPeriodStart: currentPeriodStart.toISOString().split('T')[0],
            currentPeriodEnd: currentPeriodEnd.toISOString().split('T')[0],
            previousPeriodStart: previousPeriodStart.toISOString().split('T')[0],
            previousPeriodEnd: previousPeriodEnd.toISOString().split('T')[0],
          },
          providers: {
            value: parseFloat(providersGrowth.toFixed(2)),
            period: growthPeriodLabel,
            current: providersCurrentPeriod,
            previous: providersPreviousPeriod,
            currentPeriodStart: currentPeriodStart.toISOString().split('T')[0],
            currentPeriodEnd: currentPeriodEnd.toISOString().split('T')[0],
            previousPeriodStart: previousPeriodStart.toISOString().split('T')[0],
            previousPeriodEnd: previousPeriodEnd.toISOString().split('T')[0],
          },
          revenue: {
            value: parseFloat(revenueGrowth.toFixed(2)),
            period: growthPeriodLabel,
            current: revenueCurrent,
            previous: revenuePrevious,
            currentPeriodStart: currentPeriodStart.toISOString().split('T')[0],
            currentPeriodEnd: currentPeriodEnd.toISOString().split('T')[0],
            previousPeriodStart: previousPeriodStart.toISOString().split('T')[0],
            previousPeriodEnd: previousPeriodEnd.toISOString().split('T')[0],
          },
          balance: {
            value: parseFloat(balanceGrowth.toFixed(2)),
            period: growthPeriodLabel,
            current: commissionCurrent,
            previous: commissionPrevious,
            currentPeriodStart: currentPeriodStart.toISOString().split('T')[0],
            currentPeriodEnd: currentPeriodEnd.toISOString().split('T')[0],
            previousPeriodStart: previousPeriodStart.toISOString().split('T')[0],
            previousPeriodEnd: previousPeriodEnd.toISOString().split('T')[0],
          },
        },
        pendingActions: {
          pendingVerifications, // Providers awaiting verification
          newSupportTickets, // New/unsolved support tickets
          pendingWithdrawals, // Pending withdrawal requests
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

// Update admin profile
exports.updateAdminProfile = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, profileImage } = req.body;

    const admin = await Admin.findById(req.user._id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Check if email is being changed and if it's already taken by another admin
    if (email && email !== admin.email) {
      const existingAdmin = await Admin.findOne({ email });
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: "Email is already in use",
        });
      }
    }

    // Update fields
    if (firstName) admin.firstName = firstName;
    if (lastName) admin.lastName = lastName;
    if (email) admin.email = email;
    if (phone) admin.phone = phone;

    // Handle profileImage update with Cloudinary cleanup
    if (profileImage) {
      // If profileImage is being updated and there's an existing image, delete it from Cloudinary
      if (admin.profileImage && admin.profileImage.publicId) {
        try {
          await deleteImageFromCloudinary(admin.profileImage.publicId);
        } catch (error) {
          console.error("Error deleting old profile image from Cloudinary:", error);
          // Continue with update even if deletion fails
        }
      }

      // Update with new profileImage (expecting object with url and publicId)
      if (typeof profileImage === 'object' && profileImage.url) {
        admin.profileImage = profileImage;
      } else if (typeof profileImage === 'string') {
        // Fallback for string URLs (backward compatibility)
        admin.profileImage = {
          url: profileImage,
          publicId: "",
        };
      }
    }

    await admin.save();

    const updatedAdmin = await Admin.findById(req.user._id).select("-password");

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: { admin: updatedAdmin },
    });
  } catch (error) {
    console.error("Update admin profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update admin profile",
      error: error.message,
    });
  }
};

// Change admin password
exports.changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long",
      });
    }

    const admin = await Admin.findById(req.user._id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Verify current password
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change admin password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to change password",
      error: error.message,
    });
  }
};

// Get earnings summary for chart (monthly breakdown)
exports.getEarningsSummary = async (req, res) => {
  try {
    const { months = 6 } = req.query; // Default to last 6 months
    const monthsToShow = parseInt(months);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsToShow);

    // Get PAID money requests (actual Stripe payments) with dates
    const paidMoneyRequests = await MoneyRequest.find({
      status: "paid",
      "paymentDetails.paidAt": { $gte: startDate, $lte: endDate },
    }).select("totalAmount commission paymentDetails.paidAt serviceRequest bundle");

    // Initialize earnings data structure
    const earningsByMonth = {};

    // Generate array of months
    for (let i = monthsToShow - 1; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleString('en-US', { month: 'short' });

      earningsByMonth[monthKey] = {
        month: monthName,
        year: date.getFullYear(),
        totalRevenue: 0, // Total amount customers paid via Stripe
        commission: 0, // Admin's commission income
        serviceRevenue: 0, // Revenue from service requests
        bundleRevenue: 0, // Revenue from bundles
        providerEarnings: 0, // Amount paid to providers
        transactionCount: 0, // Number of payments
      };
    }

    // Aggregate payments by month
    paidMoneyRequests.forEach((request) => {
      if (request.paymentDetails?.paidAt) {
        const date = new Date(request.paymentDetails.paidAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (earningsByMonth[monthKey]) {
          const paidAmount = request.totalAmount || 0; // Customer paid amount
          const commissionAmount = request.commission?.amount || 0; // Admin's cut
          const providerAmount = request.commission?.providerAmount || 0; // Provider's cut

          earningsByMonth[monthKey].totalRevenue += paidAmount;
          earningsByMonth[monthKey].commission += commissionAmount;
          earningsByMonth[monthKey].providerEarnings += providerAmount;
          earningsByMonth[monthKey].transactionCount += 1;

          // Separate revenue by type (service vs bundle)
          if (request.serviceRequest) {
            earningsByMonth[monthKey].serviceRevenue += paidAmount;
          } else if (request.bundle) {
            earningsByMonth[monthKey].bundleRevenue += paidAmount;
          }
        }
      }
    });

    // Convert to array format for chart
    const earningsData = Object.values(earningsByMonth);

    res.json({
      success: true,
      data: {
        period: `Last ${monthsToShow} months`,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        earnings: earningsData,
        summary: {
          totalRevenue: earningsData.reduce((sum, month) => sum + month.totalRevenue, 0),
          totalCommission: earningsData.reduce((sum, month) => sum + month.commission, 0),
          totalServiceRevenue: earningsData.reduce((sum, month) => sum + month.serviceRevenue, 0),
          totalBundleRevenue: earningsData.reduce((sum, month) => sum + month.bundleRevenue, 0),
          totalProviderEarnings: earningsData.reduce((sum, month) => sum + month.providerEarnings, 0),
          totalTransactions: earningsData.reduce((sum, month) => sum + month.transactionCount, 0),
        },
      },
    });
  } catch (error) {
    console.error("Get earnings summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch earnings summary",
      error: error.message,
    });
  }
};

// Get individual customer details with all activities
exports.getCustomerDetails = async (req, res) => {
  try {
    const { customerId } = req.params;

    // Validate customer ID
    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required",
      });
    }

    // Get customer basic info
    const customer = await Customer.findById(customerId).select("-password");

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get bundles created by customer
    const bundlesCreated = await Bundle.find({ creator: customerId })
      .populate("provider", "firstName lastName businessNameRegistered email phone")
      .sort({ createdAt: -1 })
      .limit(50);

    // Get bundles joined by customer (as participant)
    const bundlesJoined = await Bundle.find({
      "participants.customer": customerId,
      creator: { $ne: customerId }, // Exclude bundles created by this customer
    })
      .populate("creator", "firstName lastName email")
      .populate("provider", "firstName lastName businessNameRegistered email")
      .sort({ createdAt: -1 })
      .limit(50);

    // Get service requests made by customer
    const serviceRequests = await ServiceRequest.find({ customer: customerId })
      .populate("provider", "firstName lastName businessNameRegistered email phone")
      .sort({ createdAt: -1 })
      .limit(50);

    // Get money requests (payment history)
    const moneyRequests = await MoneyRequest.find({ customer: customerId })
      .populate("provider", "firstName lastName businessNameRegistered")
      .populate("serviceRequest", "serviceType problem")
      .populate("bundle", "title category")
      .sort({ createdAt: -1 })
      .limit(50);

    // Calculate statistics
    const totalBundlesCreated = await Bundle.countDocuments({
      creator: customerId,
    });

    const totalBundlesJoined = await Bundle.countDocuments({
      "participants.customer": customerId,
      creator: { $ne: customerId },
    });

    const totalServiceRequests = await ServiceRequest.countDocuments({
      customer: customerId,
    });

    const totalMoneyRequests = await MoneyRequest.countDocuments({
      customer: customerId,
    });

    // Calculate payment statistics
    const paidMoneyRequests = await MoneyRequest.find({
      customer: customerId,
      status: "paid",
    }).select("totalAmount tipAmount");

    const totalAmountPaid = paidMoneyRequests.reduce(
      (sum, req) => sum + (req.totalAmount || 0),
      0
    );

    const totalTipsGiven = paidMoneyRequests.reduce(
      (sum, req) => sum + (req.tipAmount || 0),
      0
    );

    // Get reviews given by customer
    const bundlesWithReviews = await Bundle.find({
      "reviews.customer": customerId,
    }).select("reviews title category provider createdAt");

    const customerReviews = bundlesWithReviews.map((bundle) => {
      const review = bundle.reviews.find(
        (r) => r.customer.toString() === customerId
      );
      return {
        bundleId: bundle._id,
        bundleTitle: bundle.title,
        category: bundle.category,
        rating: review?.rating,
        comment: review?.comment,
        createdAt: review?.createdAt,
      };
    });

    // Get recent activity timeline (last 20 activities)
    const recentActivity = [];

    // Add bundle activities
    bundlesCreated.slice(0, 10).forEach((bundle) => {
      recentActivity.push({
        type: "bundle_created",
        description: `Created bundle: ${bundle.title}`,
        date: bundle.createdAt,
        relatedId: bundle._id,
        status: bundle.status,
      });
    });

    bundlesJoined.slice(0, 10).forEach((bundle) => {
      const participant = bundle.participants.find(
        (p) => p.customer.toString() === customerId
      );
      recentActivity.push({
        type: "bundle_joined",
        description: `Joined bundle: ${bundle.title}`,
        date: participant?.joinedAt || bundle.createdAt,
        relatedId: bundle._id,
        status: participant?.status,
      });
    });

    // Add service request activities
    serviceRequests.slice(0, 10).forEach((request) => {
      recentActivity.push({
        type: "service_request",
        description: `Requested service: ${request.serviceType}`,
        date: request.createdAt,
        relatedId: request._id,
        status: request.status,
      });
    });

    // Add payment activities
    moneyRequests.slice(0, 10).forEach((payment) => {
      recentActivity.push({
        type: "payment",
        description: `Payment ${payment.status}: $${payment.totalAmount}`,
        date: payment.createdAt,
        relatedId: payment._id,
        status: payment.status,
      });
    });

    // Sort activities by date (most recent first)
    recentActivity.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Return comprehensive customer data
    res.json({
      success: true,
      data: {
        customer: {
          id: customer._id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          profileImage: customer.profileImage,
          address: customer.address,
          role: customer.role,
          stripeCustomerId: customer.stripeCustomerId,
          isActive: customer.isActive,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        },
        statistics: {
          totalBundlesCreated,
          totalBundlesJoined,
          totalServiceRequests,
          totalPayments: totalMoneyRequests,
          totalAmountPaid,
          totalTipsGiven,
          totalReviews: customerReviews.length,
        },
        activities: {
          bundlesCreated: bundlesCreated.map((bundle) => ({
            id: bundle._id,
            title: bundle.title,
            description: bundle.description,
            category: bundle.category,
            categoryTypeName: bundle.categoryTypeName,
            services: bundle.services,
            serviceDate: bundle.serviceDate,
            status: bundle.status,
            maxParticipants: bundle.maxParticipants,
            currentParticipants: bundle.currentParticipants,
            finalPrice: bundle.finalPrice,
            provider: bundle.provider,
            createdAt: bundle.createdAt,
          })),
          bundlesJoined: bundlesJoined.map((bundle) => {
            const participant = bundle.participants.find(
              (p) => p.customer.toString() === customerId
            );
            return {
              id: bundle._id,
              title: bundle.title,
              description: bundle.description,
              category: bundle.category,
              categoryTypeName: bundle.categoryTypeName,
              serviceDate: bundle.serviceDate,
              status: bundle.status,
              creator: bundle.creator,
              provider: bundle.provider,
              joinedAt: participant?.joinedAt,
              participantStatus: participant?.status,
              createdAt: bundle.createdAt,
            };
          }),
          serviceRequests: serviceRequests.map((request) => ({
            id: request._id,
            serviceType: request.serviceType,
            problem: request.problem,
            note: request.note,
            scheduledDate: request.scheduledDate,
            status: request.status,
            price: request.price,
            estimatedHours: request.estimatedHours,
            provider: request.provider,
            createdAt: request.createdAt,
            completedAt: request.completedAt,
          })),
          payments: moneyRequests.map((payment) => ({
            id: payment._id,
            amount: payment.amount,
            tipAmount: payment.tipAmount,
            totalAmount: payment.totalAmount,
            description: payment.description,
            status: payment.status,
            provider: payment.provider,
            serviceRequest: payment.serviceRequest,
            bundle: payment.bundle,
            paymentMethod: payment.paymentDetails?.paymentMethod,
            paidAt: payment.paymentDetails?.paidAt,
            createdAt: payment.createdAt,
          })),
          reviews: customerReviews,
        },
        recentActivity: recentActivity.slice(0, 20),
      },
    });
  } catch (error) {
    console.error("Get customer details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer details",
      error: error.message,
    });
  }
};

// Get individual provider details with all activities
exports.getProviderDetails = async (req, res) => {
  try {
    const { providerId } = req.params;

    // Validate provider ID
    if (!providerId) {
      return res.status(400).json({
        success: false,
        message: "Provider ID is required",
      });
    }

    // Get provider basic info
    const provider = await ServiceProvider.findById(providerId).select(
      "-password"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Get verification documents (insurance, ID cards)
    const verification = await Verification.findOne({
      provider: providerId,
    }).sort({ createdAt: -1 });

    // Get bundles assigned to provider
    const bundles = await Bundle.find({ provider: providerId })
      .populate("creator", "firstName lastName email phone")
      .populate("participants.customer", "firstName lastName email")
      .sort({ createdAt: -1 })
      .limit(50);

    // Get service requests assigned to provider
    const serviceRequests = await ServiceRequest.find({ provider: providerId })
      .populate("customer", "firstName lastName email phone")
      .sort({ createdAt: -1 })
      .limit(50);

    // Get money requests (payment history - provider receiving payments)
    const moneyRequests = await MoneyRequest.find({ provider: providerId })
      .populate("customer", "firstName lastName email")
      .populate("serviceRequest", "serviceType problem")
      .populate("bundle", "title category")
      .sort({ createdAt: -1 })
      .limit(50);

    // Calculate statistics
    const totalBundles = await Bundle.countDocuments({
      provider: providerId,
    });

    const totalServiceRequests = await ServiceRequest.countDocuments({
      provider: providerId,
    });

    const completedServiceRequests = await ServiceRequest.countDocuments({
      provider: providerId,
      status: "completed",
    });

    const completedBundles = await Bundle.countDocuments({
      provider: providerId,
      status: "completed",
    });

    const totalMoneyRequests = await MoneyRequest.countDocuments({
      provider: providerId,
    });

    // Calculate earnings statistics
    const paidMoneyRequests = await MoneyRequest.find({
      provider: providerId,
      status: "paid",
    }).select("totalAmount tipAmount commission");

    const totalRevenue = paidMoneyRequests.reduce(
      (sum, req) => sum + (req.totalAmount || 0),
      0
    );

    const totalTipsReceived = paidMoneyRequests.reduce(
      (sum, req) => sum + (req.tipAmount || 0),
      0
    );

    const totalCommissionPaid = paidMoneyRequests.reduce(
      (sum, req) => sum + (req.commission?.amount || 0),
      0
    );

    const totalProviderEarnings = paidMoneyRequests.reduce(
      (sum, req) => sum + (req.commission?.providerAmount || 0),
      0
    );

    // Get reviews received by provider (from bundles)
    const bundlesWithReviews = await Bundle.find({
      provider: providerId,
      "reviews.0": { $exists: true },
    }).select("reviews title category createdAt");

    const providerReviews = [];
    bundlesWithReviews.forEach((bundle) => {
      bundle.reviews.forEach((review) => {
        providerReviews.push({
          bundleId: bundle._id,
          bundleTitle: bundle.title,
          category: bundle.category,
          rating: review.rating,
          comment: review.comment,
          customer: review.customer,
          createdAt: review.createdAt,
        });
      });
    });

    // Calculate average rating
    const averageRating =
      providerReviews.length > 0
        ? providerReviews.reduce((sum, r) => sum + r.rating, 0) /
          providerReviews.length
        : 0;

    // Get recent activity timeline (last 20 activities)
    const recentActivity = [];

    // Add bundle activities
    bundles.slice(0, 10).forEach((bundle) => {
      recentActivity.push({
        type: "bundle_assigned",
        description: `Assigned to bundle: ${bundle.title}`,
        date: bundle.createdAt,
        relatedId: bundle._id,
        status: bundle.status,
      });
    });

    // Add service request activities
    serviceRequests.slice(0, 10).forEach((request) => {
      recentActivity.push({
        type: "service_request",
        description: `Service request: ${request.serviceType}`,
        date: request.createdAt,
        relatedId: request._id,
        status: request.status,
      });
    });

    // Add payment activities
    moneyRequests.slice(0, 10).forEach((payment) => {
      recentActivity.push({
        type: "payment",
        description: `Payment ${payment.status}: $${payment.totalAmount}`,
        date: payment.createdAt,
        relatedId: payment._id,
        status: payment.status,
      });
    });

    // Sort activities by date (most recent first)
    recentActivity.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Return comprehensive provider data
    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          firstName: provider.firstName,
          lastName: provider.lastName,
          email: provider.email,
          phone: provider.phone,
          profileImage: provider.profileImage,
          businessLogo: provider.businessLogo,
          businessNameRegistered: provider.businessNameRegistered,
          businessNameDBA: provider.businessNameDBA,
          providerRole: provider.providerRole,
          businessAddress: provider.businessAddress,
          serviceAreas: provider.serviceAreas,
          website: provider.website,
          servicesProvided: provider.servicesProvided,
          description: provider.description,
          experience: provider.experience,
          maxBundleCapacity: provider.maxBundleCapacity,
          businessServiceDays: provider.businessServiceDays,
          businessHours: provider.businessHours,
          hourlyRate: provider.hourlyRate,
          isApproved: provider.isApproved,
          isAvailable: provider.isAvailable,
          isActive: provider.isActive,
          isVerified: provider.isVerified,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          totalJobsCompleted: provider.totalJobsCompleted,
          totalEarnings: provider.totalEarnings,
          availableBalance: provider.availableBalance,
          pendingPayout: provider.pendingPayout,
          hasPayoutSetup: provider.hasPayoutSetup,
          documents: provider.documents,
          approvalNotes: provider.approvalNotes,
          role: provider.role,
          createdAt: provider.createdAt,
          updatedAt: provider.updatedAt,
        },
        verification: verification
          ? {
              id: verification._id,
              einNumber: verification.einNumber,
              businessRegisteredCountry: verification.businessRegisteredCountry,
              insuranceDocument: verification.insuranceDocument,
              idCardFront: verification.idCardFront,
              idCardBack: verification.idCardBack,
              firstName: verification.firstName,
              lastName: verification.lastName,
              status: verification.status,
              reviewedBy: verification.reviewedBy,
              reviewedAt: verification.reviewedAt,
              rejectionReason: verification.rejectionReason,
              submittedAt: verification.submittedAt,
              createdAt: verification.createdAt,
            }
          : null,
        statistics: {
          totalBundles,
          completedBundles,
          totalServiceRequests,
          completedServiceRequests,
          totalPayments: totalMoneyRequests,
          totalRevenue,
          totalTipsReceived,
          totalCommissionPaid,
          totalProviderEarnings,
          totalReviews: providerReviews.length,
          averageRating: parseFloat(averageRating.toFixed(2)),
        },
        activities: {
          bundles: bundles.map((bundle) => ({
            id: bundle._id,
            title: bundle.title,
            description: bundle.description,
            category: bundle.category,
            categoryTypeName: bundle.categoryTypeName,
            services: bundle.services,
            serviceDate: bundle.serviceDate,
            serviceTimeStart: bundle.serviceTimeStart,
            serviceTimeEnd: bundle.serviceTimeEnd,
            status: bundle.status,
            maxParticipants: bundle.maxParticipants,
            currentParticipants: bundle.currentParticipants,
            finalPrice: bundle.finalPrice,
            creator: bundle.creator,
            participants: bundle.participants,
            createdAt: bundle.createdAt,
            completedAt: bundle.completedAt,
          })),
          serviceRequests: serviceRequests.map((request) => ({
            id: request._id,
            serviceType: request.serviceType,
            problem: request.problem,
            note: request.note,
            scheduledDate: request.scheduledDate,
            status: request.status,
            price: request.price,
            estimatedHours: request.estimatedHours,
            customer: request.customer,
            requestedServices: request.requestedServices,
            createdAt: request.createdAt,
            completedAt: request.completedAt,
          })),
          payments: moneyRequests.map((payment) => ({
            id: payment._id,
            amount: payment.amount,
            tipAmount: payment.tipAmount,
            totalAmount: payment.totalAmount,
            description: payment.description,
            status: payment.status,
            customer: payment.customer,
            serviceRequest: payment.serviceRequest,
            bundle: payment.bundle,
            commission: payment.commission,
            paymentMethod: payment.paymentDetails?.paymentMethod,
            paidAt: payment.paymentDetails?.paidAt,
            createdAt: payment.createdAt,
          })),
          reviews: providerReviews,
        },
        recentActivity: recentActivity.slice(0, 20),
      },
    });
  } catch (error) {
    console.error("Get provider details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider details",
      error: error.message,
    });
  }
};

// Approve provider verification
exports.approveProviderVerification = async (req, res) => {
  try {
    const { providerId } = req.params;

    // Validate provider ID
    if (!providerId) {
      return res.status(400).json({
        success: false,
        message: "Provider ID is required",
      });
    }

    // Find the provider
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find the verification record
    const verification = await Verification.findOne({
      provider: providerId,
    }).sort({ createdAt: -1 });

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification record not found",
      });
    }

    // Check if already approved
    if (verification.status === "approved") {
      return res.status(400).json({
        success: false,
        message: "Provider verification is already approved",
      });
    }

    // Update verification status
    verification.status = "approved";
    verification.reviewedBy = req.user._id;
    verification.reviewedAt = new Date();
    verification.rejectionReason = undefined;
    await verification.save();

    // Update provider verification status
    provider.isVerified = true;
    await provider.save();

    res.json({
      success: true,
      message: "Provider verification approved successfully",
      data: {
        verification: {
          id: verification._id,
          status: verification.status,
          reviewedAt: verification.reviewedAt,
          reviewedBy: verification.reviewedBy,
        },
        provider: {
          id: provider._id,
          isVerified: provider.isVerified,
        },
      },
    });
  } catch (error) {
    console.error("Approve provider verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve provider verification",
      error: error.message,
    });
  }
};

// Reject provider verification
exports.rejectProviderVerification = async (req, res) => {
  try {
    const { providerId } = req.params;
    const { rejectionReason } = req.body;

    // Validate provider ID
    if (!providerId) {
      return res.status(400).json({
        success: false,
        message: "Provider ID is required",
      });
    }

    // Validate rejection reason
    if (!rejectionReason || rejectionReason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    // Find the provider
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find the verification record
    const verification = await Verification.findOne({
      provider: providerId,
    }).sort({ createdAt: -1 });

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification record not found",
      });
    }

    // Update verification status
    verification.status = "rejected";
    verification.reviewedBy = req.user._id;
    verification.reviewedAt = new Date();
    verification.rejectionReason = rejectionReason.trim();
    await verification.save();

    // Update provider verification status
    provider.isVerified = false;
    await provider.save();

    res.json({
      success: true,
      message: "Provider verification rejected successfully",
      data: {
        verification: {
          id: verification._id,
          status: verification.status,
          rejectionReason: verification.rejectionReason,
          reviewedAt: verification.reviewedAt,
          reviewedBy: verification.reviewedBy,
        },
        provider: {
          id: provider._id,
          isVerified: provider.isVerified,
        },
      },
    });
  } catch (error) {
    console.error("Reject provider verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject provider verification",
      error: error.message,
    });
  }
};

// Get admin notifications (unified endpoint)
exports.getAdminNotifications = async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const limitNum = parseInt(limit);

    // 1. Get pending provider verifications
    const pendingVerifications = await Verification.find({ status: "pending" })
      .populate("provider", "firstName lastName email businessNameRegistered")
      .sort({ createdAt: -1 })
      .limit(limitNum);

    // 2. Get new/unsolved support tickets
    const newSupportTickets = await SupportTicket.find({ status: "Unsolved" })
      .populate("user", "firstName lastName email")
      .sort({ createdAt: -1 })
      .limit(limitNum);

    // 3. Get pending withdrawal requests
    const pendingWithdrawals = await WithdrawalRequest.find({
      status: "pending",
    })
      .populate("provider", "firstName lastName email businessNameRegistered")
      .sort({ createdAt: -1 })
      .limit(limitNum);

    // 4. Get recent payments (last 24 hours by default, or recent paid ones)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentPayments = await MoneyRequest.find({
      status: "paid",
      "paymentDetails.paidAt": { $gte: oneDayAgo },
    })
      .populate("customer", "firstName lastName email")
      .populate("provider", "firstName lastName email businessNameRegistered")
      .populate("serviceRequest", "serviceType")
      .populate("bundle", "title")
      .sort({ "paymentDetails.paidAt": -1 })
      .limit(limitNum);

    // Build unified notification array
    const notifications = [];

    // Add verification notifications
    pendingVerifications.forEach((verification) => {
      notifications.push({
        id: verification._id,
        type: "provider_verification",
        title: "New Provider Verification Request",
        message: `${verification.provider?.firstName || ""} ${
          verification.provider?.lastName || ""
        } (${
          verification.provider?.businessNameRegistered || "N/A"
        }) submitted verification documents`,
        data: {
          verificationId: verification._id,
          providerId: verification.provider?._id,
          providerName: `${verification.provider?.firstName || ""} ${
            verification.provider?.lastName || ""
          }`,
          businessName: verification.provider?.businessNameRegistered,
          status: verification.status,
        },
        createdAt: verification.createdAt,
        isRead: false,
        priority: "high",
      });
    });

    // Add support ticket notifications
    newSupportTickets.forEach((ticket) => {
      notifications.push({
        id: ticket._id,
        type: "support_ticket",
        title: "New Support Ticket",
        message: `Ticket #${ticket.ticketId}: ${ticket.subject}`,
        data: {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketId,
          subject: ticket.subject,
          priority: ticket.priority,
          userId: ticket.user?._id,
          userName: `${ticket.user?.firstName || ""} ${
            ticket.user?.lastName || ""
          }`,
          userEmail: ticket.user?.email,
        },
        createdAt: ticket.createdAt,
        isRead: false,
        priority: ticket.priority === "High" ? "high" : "medium",
      });
    });

    // Add withdrawal notifications
    pendingWithdrawals.forEach((withdrawal) => {
      notifications.push({
        id: withdrawal._id,
        type: "withdrawal_request",
        title: "New Withdrawal Request",
        message: `${withdrawal.provider?.firstName || ""} ${
          withdrawal.provider?.lastName || ""
        } requested withdrawal of $${withdrawal.amount.toFixed(2)}`,
        data: {
          withdrawalId: withdrawal._id,
          amount: withdrawal.amount,
          providerId: withdrawal.provider?._id,
          providerName: `${withdrawal.provider?.firstName || ""} ${
            withdrawal.provider?.lastName || ""
          }`,
          businessName: withdrawal.provider?.businessNameRegistered,
          payoutMethod: withdrawal.payoutMethod,
        },
        createdAt: withdrawal.createdAt,
        isRead: false,
        priority: "medium",
      });
    });

    // Add payment notifications
    recentPayments.forEach((payment) => {
      notifications.push({
        id: payment._id,
        type: "new_payment",
        title: "New Payment Received",
        message: `Payment of $${payment.totalAmount.toFixed(2)} from ${
          payment.customer?.firstName || ""
        } ${payment.customer?.lastName || ""} to ${
          payment.provider?.firstName || ""
        } ${payment.provider?.lastName || ""}`,
        data: {
          paymentId: payment._id,
          amount: payment.totalAmount,
          commission: payment.commission?.amount || 0,
          customerId: payment.customer?._id,
          customerName: `${payment.customer?.firstName || ""} ${
            payment.customer?.lastName || ""
          }`,
          providerId: payment.provider?._id,
          providerName: `${payment.provider?.firstName || ""} ${
            payment.provider?.lastName || ""
          }`,
          serviceType: payment.serviceRequest?.serviceType || payment.bundle?.title,
        },
        createdAt: payment.paymentDetails?.paidAt || payment.createdAt,
        isRead: false,
        priority: "low",
      });
    });

    // Sort all notifications by creation date (most recent first)
    notifications.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    // Calculate summary counts
    const summary = {
      totalNotifications: notifications.length,
      pendingVerifications: pendingVerifications.length,
      newSupportTickets: newSupportTickets.length,
      pendingWithdrawals: pendingWithdrawals.length,
      recentPayments: recentPayments.length,
      byPriority: {
        high: notifications.filter((n) => n.priority === "high").length,
        medium: notifications.filter((n) => n.priority === "medium").length,
        low: notifications.filter((n) => n.priority === "low").length,
      },
    };

    res.json({
      success: true,
      data: {
        notifications: notifications.slice(0, limitNum),
        summary,
      },
    });
  } catch (error) {
    console.error("Get admin notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin notifications",
      error: error.message,
    });
  }
};
