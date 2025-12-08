const cloudinary = require("cloudinary").v2;
const CloudinaryStorage = require("multer-storage-cloudinary");
const multer = require("multer");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage configuration specifically for category type images
const categoryTypeStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "naibrly/category-types",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: (req, file) => {
      return `category_type_${Date.now()}`;
    },
    // Ensure we get the full URL
    transformation: [
      { width: 600, height: 400, crop: "limit" },
      { quality: "auto", fetch_format: "auto" },
    ],
  },
});

// Create a clean multer instance
const uploadCategoryTypeImage = multer({
  storage: categoryTypeStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

module.exports = {
  uploadCategoryTypeImage,
};
