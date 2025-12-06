// routes/users.js - Add these new routes
const express = require("express");
const {
  getUserProfile,
  updateProfile,
  updatePassword,
  deleteProfileImage,
  deleteBusinessLogo,
  // New service provider methods
  updateServiceProviderProfile,
  getProviderServices,
  addServiceToProvider,
  removeServiceFromProvider,
} = require("../controllers/userController");
const { auth, authorize } = require("../middleware/auth");
const {
  uploadProfileImage,
  uploadBusinessLogo,
} = require("../config/cloudinary");

const router = express.Router();

// Get user profile
router.get("/profile", auth, getUserProfile);

// Universal update profile - handles all user types with images in one API
router.put(
  "/update-profile",
  auth,
  uploadProfileImage.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "businessLogo", maxCount: 1 },
  ]),
  updateProfile
);

// SERVICE PROVIDER SPECIFIC ROUTES
// Advanced service provider profile update with service management
router.put(
  "/provider/update-profile",
  auth,
  authorize("provider"),
  uploadProfileImage.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "businessLogo", maxCount: 1 },
  ]),
  updateServiceProviderProfile
);

// Get provider services
router.get(
  "/provider/services",
  auth,
  authorize("provider"),
  getProviderServices
);

// Add single service to provider
router.post(
  "/provider/services/add",
  auth,
  authorize("provider"),
  addServiceToProvider
);

// Remove single service from provider
router.delete(
  "/provider/services/remove",
  auth,
  authorize("provider"),
  removeServiceFromProvider
);

// Update password
router.put("/password", auth, updatePassword);

// Delete images
router.delete("/profile-image", auth, deleteProfileImage);
router.delete("/business-logo", auth, deleteBusinessLogo);

module.exports = router;
