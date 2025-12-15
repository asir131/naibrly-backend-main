// Use full cloudinary lib so CloudinaryStorage can access .v2
const cloudinary = require("cloudinary");
const cloudinaryMulter = require("multer-storage-cloudinary");
const CloudinaryStorage =
  cloudinaryMulter.CloudinaryStorage || cloudinaryMulter;
const multer = require("multer");

// Detect if cloudinary creds are set
const hasCloudinaryConfig =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

// Configure Cloudinary only when creds present
if (hasCloudinaryConfig) {
  cloudinary.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Aggressive sanitization - only allows alphanumeric and underscore
const sanitizePublicId = (str) => {
  if (!str) return "file";

  const sanitized = str
    .toString()
    .replace(/[^\w-]/g, "") // Remove everything except word chars and hyphens
    .replace(/^[\d_-]+/, "") // Remove leading numbers, underscores, hyphens
    .substring(0, 100); // Limit length

  return sanitized || "file"; // Fallback if empty
};

// Universal storage configuration for all images
const createCloudinaryStorage = (folder) => {
  if (!hasCloudinaryConfig) {
    // fallback to memory storage when cloudinary is not configured
    return multer.memoryStorage();
  }

  return new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: `naibrly/${folder}`,
      resource_type: "auto", // let Cloudinary detect file type (avoids format errors)
      // Let Cloudinary generate public_id automatically
    },
  });
};

// Create storage configurations
const profileImageStorage = createCloudinaryStorage("profiles");
const businessLogoStorage = createCloudinaryStorage("business-logos");
const insuranceDocumentStorage = createCloudinaryStorage("insurance-documents");
const documentStorage = createCloudinaryStorage("documents");

// Create universal image upload middleware (accepts any field name)
const createImageUpload = (storage) => {
  return multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith("image/")) {
        cb(null, true);
      } else {
        cb(new Error("Only image files are allowed!"), false);
      }
    },
  });
};

// Create document upload middleware
const createDocumentUpload = (storage) => {
  return multer({
    storage: storage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit for documents
    },
    fileFilter: (req, file, cb) => {
      if (
        file.mimetype.startsWith("image/") ||
        file.mimetype === "application/pdf"
      ) {
        cb(null, true);
      } else {
        cb(new Error("Only image and PDF files are allowed!"), false);
      }
    },
  });
};

// Export upload middlewares
const uploadProfileImage = createImageUpload(profileImageStorage);
const uploadBusinessLogo = createImageUpload(businessLogoStorage);
const uploadInsuranceDocument = createDocumentUpload(insuranceDocumentStorage);
const uploadDocument = createDocumentUpload(documentStorage);

// Universal upload middleware that accepts any field name for images
const uploadAnyImage = createImageUpload(createCloudinaryStorage("uploads"));

// Function to delete image from Cloudinary
const deleteImageFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.v2.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    throw error;
  }
};

// Function to delete document from Cloudinary
const deleteDocumentFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.v2.uploader.destroy(publicId, {
      resource_type: "raw",
    });
    return result;
  } catch (error) {
    console.error("Error deleting document from Cloudinary:", error);
    throw error;
  }
};

// Verification Storage Configuration with enhanced sanitization
const verificationStorage = hasCloudinaryConfig
  ? new CloudinaryStorage({
      cloudinary: cloudinary,
      params: {
        folder: "naibrly/verifications",
        resource_type: "auto", // allow pdf/images without specifying format
        // Let Cloudinary generate public_id automatically
      },
    })
  : multer.memoryStorage();

// Create upload middleware for verification documents
const uploadVerificationDocuments = multer({
  storage: verificationStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
  },
  fileFilter: (req, file, cb) => {
    const allowedFields = ["insuranceDocument", "idCardFront", "idCardBack"];
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    console.log("📁 File upload check:", {
      fieldname: file.fieldname,
      mimetype: file.mimetype,
      isAllowedField: allowedFields.includes(file.fieldname),
      isAllowedMimeType: allowedMimeTypes.includes(file.mimetype),
    });

    if (
      allowedFields.includes(file.fieldname) &&
      allowedMimeTypes.includes(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type or field name. Field: ${file.fieldname}, Type: ${
            file.mimetype
          }. Allowed fields: ${allowedFields.join(
            ", "
          )}. Allowed types: ${allowedMimeTypes.join(", ")}`
        ),
        false
      );
    }
  },
});

// Enhanced error handling for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large. Maximum size is 5MB per file.",
      });
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Unexpected file field. Please check field names.",
      });
    }
  }

  if (error.message) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  next(error);
};

module.exports = {
  cloudinary,
  hasCloudinaryConfig,
  uploadProfileImage,
  uploadBusinessLogo,
  uploadInsuranceDocument,
  uploadDocument,
  uploadAnyImage,
  deleteImageFromCloudinary,
  deleteDocumentFromCloudinary,
  uploadVerificationDocuments,
  handleMulterError,
  sanitizePublicId, // Export for testing if needed
};
