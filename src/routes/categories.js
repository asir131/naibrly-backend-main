const express = require("express");
const {
  getAllCategories,
  createCategoryTypeWithServices,
  getAllServices,
  searchServices,
  searchCategories,
  initializeDefaultData,
  addServiceToCategoryType,
  updateCategoryType,
  deleteCategoryType,
  updateService,
  deleteService,
} = require("../controllers/categoryController");
const { uploadCategoryTypeImage } = require("../config/categoryCloudinary");
const { auth, authorize, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// Public route with optional auth
router.get("/services", optionalAuth, getAllServices);
router.get("/services/search", searchServices);
router.get("/search", searchCategories);

// Admin routes - Category Management
router.get("/", auth, authorize("admin"), getAllCategories);

// Category Type CRUD
router.post(
  "/create",
  auth,
  authorize("admin"),
  uploadCategoryTypeImage.single("image"),
  createCategoryTypeWithServices
);

router.put(
  "/type/:id",
  auth,
  authorize("admin"),
  uploadCategoryTypeImage.single("image"),
  updateCategoryType
);

router.delete("/type/:id", auth, authorize("admin"), deleteCategoryType);

// Service CRUD
router.post("/add-service", auth, authorize("admin"), addServiceToCategoryType);

router.put(
  "/service/:id",
  auth,
  authorize("admin"),
  uploadCategoryTypeImage.single("image"),
  updateService
);

router.delete("/service/:id", auth, authorize("admin"), deleteService);

module.exports = router;
