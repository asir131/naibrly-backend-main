// Load environment variables FIRST before any other imports
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const http = require("http");
const { initializeBanks } = require("./controllers/bankController");
const connectDB = require("./config/database");
const { initializeAdmin } = require("./controllers/adminController");
const { initializeDefaultData } = require("./controllers/categoryController");
const { uploadProfileImage } = require("./config/cloudinary");
const { initializeBundleSettings } = require("./controllers/bundleController");
const { initSocket } = require("./socket");
const Conversation = require("./models/Conversation");
const {
  initializeCommissionSettings,
} = require("./controllers/commissionController");

// Connect to database
connectDB();

// Ensure conversation indexes support per-participant bundle chats
const ensureConversationIndexes = async () => {
  try {
    await Conversation.collection.dropIndex("bundleId_1");
    console.log("Dropped legacy bundleId_1 index on conversations");
  } catch (err) {
    if (err.codeName !== "IndexNotFound" && err.code !== 27) {
      console.error("Error dropping legacy bundleId_1 index:", err.message);
    }
  }

  try {
    await Conversation.collection.createIndex(
      { bundleId: 1, customerId: 1 },
      { unique: true, sparse: true }
    );
    console.log("Ensured composite index on { bundleId, customerId } for conversations");
  } catch (err) {
    console.error("Error ensuring conversation composite index:", err.message);
  }
};

ensureConversationIndexes();

const app = express();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// ========== MIDDLEWARE SETUP ========== //

// Security middleware
app.use(helmet());

// CORS middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000", // For local development
      "http://localhost:5173", // Vite frontend
      process.env.CLIENT_URL, // For production
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-admin-secret', 'Authorization'],
  })
);

// Logging middleware
app.use(morgan("combined"));

// ========== CRITICAL: WEBHOOK ROUTES FIRST (raw body) ========== //
app.use("/api/webhooks", require("./routes/webhooks"));

// ========== BODY PARSERS (after webhooks) ========== //
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ========== STATIC FILES ========== //
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/payout", require("./routes/payout"));

// ========== INITIALIZE DATA ========== //
initializeAdmin();
initializeDefaultData();
initializeBundleSettings();
initializeCommissionSettings();
initializeBanks();

// ========== API ROUTES ========== //

// Commission routes
app.use("/api/commission", require("./routes/commission"));

// Money requests routes
app.use("/api/money-requests", require("./routes/moneyRequest"));

// Auth routes
app.use("/api/auth", require("./routes/auth"));

// Admin routes
app.use("/api/admin", require("./routes/admin"));

// User routes
app.use("/api/users", require("./routes/users"));

// Zip code routes
app.use("/api/zip", require("./routes/zip"));

// Service request routes
app.use("/api/service-requests", require("./routes/serviceRequests"));

// Password reset routes
app.use("/api/auth/password-reset", require("./routes/passwordReset"));

// Verification routes
app.use("/api/verify-information", require("./routes/verification"));

// Upload routes
app.use("/api/upload", require("./routes/upload"));

// Category routes
app.use("/api/categories", require("./routes/categories"));

// Bundle routes
app.use("/api/bundles", require("./routes/bundles"));

// Bundle settings routes
app.use("/api/bundle-settings", require("./routes/bundleSettings"));

// Provider routes
app.use("/api/providers", require("./routes/providers"));

// Withdrawal routes
app.use("/api/withdrawals", require("./routes/withdrawals"));

// Quick chat routes
app.use("/api/quick-chats", require("./routes/quickChats"));

// Conversation routes
app.use("/api/conversations", require("./routes/conversation"));

// Search routes
app.use("/api/search", require("./routes/search"));

// ========== DEBUG & TEST ROUTES ========== //

// Debug route for testing uploads
app.post(
  "/api/debug/upload-test",
  uploadProfileImage.single("testImage"),
  (req, res) => {
    console.log("Debug upload - File received:", req.file);
    res.json({
      success: true,
      file: req.file,
      message: "Upload test completed",
    });
  }
);

// API listing route at root
app.get("/", (req, res) => {
  const port = process.env.PORT || 5000;
  res.json({
    success: true,
    message: `Naibrly API is running on port ${port}`,
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: "/api/auth",
      admin: "/api/admin",
      users: "/api/users",
      zip: "/api/zip",
      serviceRequests: "/api/service-requests",
      passwordReset: "/api/auth/password-reset",
      verification: "/api/verify-information",
      upload: "/api/upload",
      categories: "/api/categories",
      bundles: "/api/bundles",
      bundleSettings: "/api/bundle-settings",
      providers: "/api/providers",
      quickChats: "/api/quick-chats",
      webhooks: "/api/webhooks",
      moneyRequests: "/api/money-requests",
      commission: "/api/commission",
      conversations: "/api/conversations",
      search: "/api/search",
    },
    health: "/health",
    test: "/api/test",
  });
});

// Health check route
app.get("/health", (_req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 5000,
    environment: process.env.NODE_ENV || "development",
  });
});

// Test routes
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "Naibrly API is working!",
    port: process.env.PORT || 5000,
  });
});

app.get("/api/debug/test", (req, res) => {
  res.json({
    message: "Debug route works!",
    port: process.env.PORT || 5000,
  });
});

app.post("/api/debug/test-post", (req, res) => {
  res.json({
    message: "POST debug route works!",
    body: req.body,
    port: process.env.PORT || 5000,
  });
});

// Email test routes
app.get("/api/test-email", async (req, res) => {
  const result = await testEmailConfig();
  res.json(result);
});

// Check email service status
app.get("/api/email-status", (req, res) => {
  const status = getEmailServiceStatus();
  res.json(status);
});

// ========== ERROR HANDLING ========== //

// 404 handler
app.use((req, res) => {
  console.log("🤔 Route not found:", {
    method: req.method,
    url: req.originalUrl,
  });
  res.status(404).json({
    success: false,
    message: "Route not found",
    requestedUrl: req.originalUrl,
    port: process.env.PORT || 5000,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ An error occurred:", {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
  });
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "production" ? {} : err.message,
  });
});

// ========== SERVER START ========== //

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`👤 Admin username: ${process.env.ADMIN_USERNAME}`);
  console.log(`🔗 API Root: http://localhost:${PORT}/`);
  console.log(`💬 Socket.io running on port ${PORT}`);
  console.log(`🔔 Webhooks: http://localhost:${PORT}/api/webhooks/stripe`);
});
