const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:3000";

const isSafeRedirect = (value) => typeof value === "string" && value.startsWith("/");
const {
  registerCustomer,
  registerProvider,
  login,
  googleMobileLogin,
  getMe,
  approveProvider,
  checkProviderStatus,
  getAllProviders,
  logout,
  deleteAccount,
  getAllCustomers,
} = require("../controllers/authController");
const {
  uploadProfileImage,
  uploadBusinessLogo,
  handleMulterError,
} = require("../config/cloudinary");
const { auth } = require("../middleware/auth");

const router = express.Router();

// Public routes
router.post(
  "/register/customer",
  uploadProfileImage.single("profileImage"),
  handleMulterError,
  registerCustomer
);

router.post(
  "/register/provider",
  uploadBusinessLogo.single("businessLogo"),
  handleMulterError,
  registerProvider
);


// Google OAuth (customer-only)
router.get("/google", (req, res, next) => {
  const redirect = isSafeRedirect(req.query.redirect) ? req.query.redirect : "/";
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    state: redirect,
  })(req, res, next);
});

router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user, info) => {
    if (err) {
      console.error("Google auth error:", err);
      return res.redirect(`${FRONTEND_URL}/Login?type=user&error=google_login_failed`);
    }

    if (!user) {
      const reason =
        info && info.message === "No customer account found for this email."
          ? "google_no_account"
          : "google_login_failed";
      return res.redirect(`${FRONTEND_URL}/Login?type=user&error=${reason}`);
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    const redirect = isSafeRedirect(req.query.state) ? req.query.state : "/";
    return res.redirect(
      `${FRONTEND_URL}/google-callback?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirect)}`
    );
  })(req, res, next);
});

router.post("/login", login);
router.post("/google/mobile", googleMobileLogin);

// Protected routes
router.get("/me", auth, getMe);
router.get("/provider/status", auth, checkProviderStatus);
router.get("/providers", getAllProviders);
router.get("/customers", getAllCustomers);
router.patch("/provider/approve/:providerId", auth, approveProvider);
router.post("/logout", auth, logout);
router.delete("/delete-account", auth, deleteAccount);

module.exports = router;
