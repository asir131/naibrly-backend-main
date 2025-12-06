const express = require("express");
const { auth } = require("../middleware/auth");
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

module.exports = router;
