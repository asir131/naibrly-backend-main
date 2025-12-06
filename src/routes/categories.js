const express = require("express");
const {
  getAllCategories,
  createCategoryTypeWithServices,
  getAllServices,
  searchServices,
  searchCategories,
  initializeDefaultData,
  addServiceToCategoryType,
} = require("../controllers/categoryController");
const { uploadCategoryTypeImage } = require("../config/categoryCloudinary");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Initialize categories on server start

// Public routes
router.get("/services", getAllServices);
router.get("/services/search", searchServices);
router.get("/search", searchCategories);

// Admin routes
router.get("/", auth, authorize("admin"), getAllCategories);

// Add new service to existing category type
router.post("/add-service", auth, authorize("admin"), addServiceToCategoryType);

// SIMPLE AND CLEAN - This will work
router.post(
  "/create",
  auth,
  authorize("admin"),
  uploadCategoryTypeImage.single("image"), // Field name is 'image'
  createCategoryTypeWithServices
);

module.exports = router;
