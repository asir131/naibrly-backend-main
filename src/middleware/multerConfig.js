const multer = require("multer");

// Simple memory storage
const storage = multer.memoryStorage();

// Create a fresh multer instance for each use
const createMulter = () => {
  return multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
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

module.exports = createMulter;
