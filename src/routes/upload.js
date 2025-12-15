const express = require("express");
const { auth } = require("../middleware/auth");
const { adminAuth } = require("../middleware/adminAuth");
const {
  uploadProfileImage,
  uploadBusinessLogo,
} = require("../config/cloudinary");
const {
  uploadCustomerProfileImage,
  uploadProviderProfileImage,
  uploadBusinessLogo: uploadBizLogo,
  deleteProfileImage,
  deleteBusinessLogo,
  uploadAdminProfileImage,
  deleteAdminProfileImage,
} = require("../controllers/uploadController");

const router = express.Router();

router.post(
  "/customer/profile-image",
  auth,
  uploadProfileImage.single("profileImage"),
  uploadCustomerProfileImage
);

router.post(
  "/provider/profile-image",
  auth,
  uploadProfileImage.single("profileImage"),
  uploadProviderProfileImage
);

router.post(
  "/provider/business-logo",
  auth,
  uploadBusinessLogo.single("businessLogo"),
  uploadBizLogo
);

router.delete("/profile-image", auth, deleteProfileImage);

router.delete("/business-logo", auth, deleteBusinessLogo);

// Admin profile image routes
router.post(
  "/admin/profile-image",
  adminAuth,
  uploadProfileImage.single("profileImage"),
  uploadAdminProfileImage
);

router.delete("/admin/profile-image", adminAuth, deleteAdminProfileImage);

module.exports = router;
