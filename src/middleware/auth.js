const jwt = require("jsonwebtoken");
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Admin = require("../models/Admin");

const auth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token, authorization denied",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = await Customer.findById(decoded.userId);
    if (!user) user = await ServiceProvider.findById(decoded.userId);
    if (!user) user = await Admin.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is not valid",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account is deactivated",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({
      success: false,
      message: "Token is not valid",
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`,
      });
    }
    next();
  };
};

// Optional authentication - attaches user if token exists, but doesn't require it
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      // No token provided - continue without user
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = await Customer.findById(decoded.userId);
    if (!user) user = await ServiceProvider.findById(decoded.userId);
    if (!user) user = await Admin.findById(decoded.userId);

    if (user && user.isActive) {
      // User found and active - attach to request
      req.user = user;
    }

    next();
  } catch (error) {
    // Token invalid - continue without user
    console.error("Optional auth error:", error.message);
    next();
  }
};

module.exports = { auth, authorize, optionalAuth };
