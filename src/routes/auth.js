const express = require("express");
const {
  registerCustomer,
  registerProvider,
  login,
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

router.post("/login", login);

// Protected routes
router.get("/me", auth, getMe);
router.get("/provider/status", auth, checkProviderStatus);
router.get("/providers", getAllProviders);
router.get("/customers", getAllCustomers);
router.patch("/provider/approve/:providerId", auth, approveProvider);
router.post("/logout", auth, logout);
router.delete("/delete-account", auth, deleteAccount);

module.exports = router;
