const express = require("express");
const multer = require("multer");
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
const { auth } = require("../middleware/auth");

const router = express.Router();

// CUSTOMER UPLOAD - Completely isolated
const customerStorage = multer.memoryStorage();
const customerUpload = multer({
  storage: customerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    console.log("Customer upload - Fieldname:", file.fieldname);
    if (
      file.fieldname === "profileImage" &&
      file.mimetype.startsWith("image/")
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Customer: Only profileImage field with image files are allowed!"
        ),
        false
      );
    }
  },
});

// PROVIDER UPLOAD - Completely isolated with different storage
const providerStorage = multer.memoryStorage();
const providerUpload = multer({
  storage: providerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    console.log("Provider upload - Fieldname:", file.fieldname);
    const allowedFields = ["businessLogo"];
    if (
      allowedFields.includes(file.fieldname) &&
      file.mimetype.startsWith("image/")
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Provider: Only ${allowedFields.join(
            ", "
          )} fields with image files are allowed!`
        ),
        false
      );
    }
  },
});

// Public routes
router.post(
  "/register/customer",
  customerUpload.single("profileImage"),
  registerCustomer
);

router.post(
  "/register/provider",
  providerUpload.fields([
    { name: "businessLogo", maxCount: 1 },
  ]),
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
