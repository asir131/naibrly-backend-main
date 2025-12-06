const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const { deleteImageFromCloudinary } = require("../config/cloudinary");

exports.uploadCustomerProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    const customer = await Customer.findById(req.user._id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (customer.profileImage.publicId) {
      await deleteImageFromCloudinary(customer.profileImage.publicId);
    }

    customer.profileImage = {
      url: req.file.path,
      publicId: req.file.filename,
    };

    await customer.save();

    res.json({
      success: true,
      message: "Profile image uploaded successfully",
      data: {
        profileImage: customer.profileImage,
      },
    });
  } catch (error) {
    console.error("Upload profile image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload profile image",
      error: error.message,
    });
  }
};

exports.uploadProviderProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    if (provider.profileImage.publicId) {
      await deleteImageFromCloudinary(provider.profileImage.publicId);
    }

    provider.profileImage = {
      url: req.file.path,
      publicId: req.file.filename,
    };

    await provider.save();

    res.json({
      success: true,
      message: "Profile image uploaded successfully",
      data: {
        profileImage: provider.profileImage,
      },
    });
  } catch (error) {
    console.error("Upload provider profile image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload profile image",
      error: error.message,
    });
  }
};

exports.uploadBusinessLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    if (provider.businessLogo.publicId) {
      await deleteImageFromCloudinary(provider.businessLogo.publicId);
    }

    provider.businessLogo = {
      url: req.file.path,
      publicId: req.file.filename,
    };

    await provider.save();

    res.json({
      success: true,
      message: "Business logo uploaded successfully",
      data: {
        businessLogo: provider.businessLogo,
      },
    });
  } catch (error) {
    console.error("Upload business logo error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload business logo",
      error: error.message,
    });
  }
};

exports.deleteProfileImage = async (req, res) => {
  try {
    let user;

    if (req.user.role === "customer") {
      user = await Customer.findById(req.user._id);
    } else if (req.user.role === "provider") {
      user = await ServiceProvider.findById(req.user._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.profileImage.publicId) {
      await deleteImageFromCloudinary(user.profileImage.publicId);
    }

    user.profileImage = {
      url: "",
      publicId: "",
    };

    await user.save();

    res.json({
      success: true,
      message: "Profile image deleted successfully",
    });
  } catch (error) {
    console.error("Delete profile image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete profile image",
      error: error.message,
    });
  }
};

exports.deleteBusinessLogo = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    if (provider.businessLogo.publicId) {
      await deleteImageFromCloudinary(provider.businessLogo.publicId);
    }

    provider.businessLogo = {
      url: "",
      publicId: "",
    };

    await provider.save();

    res.json({
      success: true,
      message: "Business logo deleted successfully",
    });
  } catch (error) {
    console.error("Delete business logo error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete business logo",
      error: error.message,
    });
  }
};
