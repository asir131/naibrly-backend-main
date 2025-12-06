const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create a flexible storage that handles multiple fields
const createFlexibleStorage = () => {
  return new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
      // Determine folder based on field name
      let folder = "naibrly/uploads";
      if (file.fieldname === "profileImage") {
        folder = "naibrly/profiles";
      } else if (file.fieldname === "businessLogo") {
        folder = "naibrly/business-logos";
      }

      return {
        folder: folder,
        format: async (req, file) => {
          if (file.mimetype === "image/jpeg") return "jpg";
          if (file.mimetype === "image/png") return "png";
          if (file.mimetype === "image/webp") return "webp";
          return "png";
        },
        public_id: (req, file) => {
          const timestamp = Date.now();
          const randomString = Math.random().toString(36).substring(2, 15);
          return `${file.fieldname}_${timestamp}_${randomString}`;
        },
      };
    },
  });
};

// Create the upload middleware for provider registration
const uploadProviderRegistration = multer({
  storage: createFlexibleStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
  },
  fileFilter: (req, file, cb) => {
    // Only allow businessLogo field now
    const allowedFields = ["businessLogo"]; // Removed "profileImage"
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
// For customer registration (single file)
const uploadCustomerRegistration = multer({
  storage: createFlexibleStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

module.exports = {
  uploadProviderRegistration,
  uploadCustomerRegistration,
};
