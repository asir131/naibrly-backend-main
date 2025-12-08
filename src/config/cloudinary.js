const cloudinary = require("cloudinary").v2;
const CloudinaryStorage = require("multer-storage-cloudinary");
const multer = require("multer");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Universal storage configuration for all images
const createCloudinaryStorage = (folder) => {
  return new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: `naibrly/${folder}`,
      format: async (req, file) => {
        // Support multiple image formats
        if (file.mimetype === "image/jpeg") return "jpg";
        if (file.mimetype === "image/png") return "png";
        if (file.mimetype === "image/webp") return "webp";
        return "png"; // default
      },
      public_id: (req, file) => {
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        return `${folder}_${timestamp}_${randomString}`;
      },
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
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    throw error;
  }
};

// Function to delete document from Cloudinary
const deleteDocumentFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "raw",
    });
    return result;
  } catch (error) {
    console.error("Error deleting document from Cloudinary:", error);
    throw error;
  }
};

// 🆕 FIXED: Verification Storage Configuration
const verificationStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "naibrly/verifications",
    format: async (req, file) => {
      // Support both images and PDFs for verification documents
      if (file.mimetype === "image/jpeg") return "jpg";
      if (file.mimetype === "image/png") return "png";
      if (file.mimetype === "image/webp") return "webp";
      if (file.mimetype === "application/pdf") return "pdf";
      return "png"; // default
    },
    public_id: (req, file) => {
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);

      // Use fieldname to organize files better
      let prefix = "verification";
      if (file.fieldname === "insuranceDocument") {
        prefix = "insurance";
      } else if (file.fieldname === "idCardFront") {
        prefix = "id_front";
      } else if (file.fieldname === "idCardBack") {
        prefix = "id_back";
      }

      return `${prefix}_${timestamp}_${randomString}`;
    },
  },
});

// 🆕 FIXED: Create upload middleware for verification documents
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

// 🆕 NEW: Enhanced error handling for multer
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
  uploadProfileImage,
  uploadBusinessLogo,
  uploadInsuranceDocument,
  uploadDocument,
  uploadAnyImage,
  deleteImageFromCloudinary,
  deleteDocumentFromCloudinary,
  uploadVerificationDocuments,
  handleMulterError, // 🆕 Export error handler
};
