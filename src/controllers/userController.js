// controllers/userController.js
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Admin = require("../models/Admin");
const Service = require("../models/Service");
const PayoutInformation = require("../models/PayoutInformation");
const Verification = require("../models/Verification");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const mongoose = require("mongoose");
const { cloudinary, deleteImageFromCloudinary } = require("../config/cloudinary");
const { Readable } = require("stream");

const uploadBufferToCloudinary = (buffer, folder, publicIdPrefix) => {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const publicId = `${publicIdPrefix}_${timestamp}_${randomString}`;

    const uploadStream = cloudinary.v2.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

// Get user profile
exports.getUserProfile = async (req, res) => {
  try {
    let user;

    if (req.user.role === "customer") {
      user = await Customer.findById(req.user._id).select("-password");
    } else if (req.user.role === "provider") {
      const provider = await ServiceProvider.findById(req.user._id)
        .select("-password")
        .lean();

      if (provider) {
        const providerObjectId = new mongoose.Types.ObjectId(req.user._id);

        // Aggregate total payout from paid withdrawals
        const totalPayoutAgg = await WithdrawalRequest.aggregate([
          { $match: { provider: providerObjectId, status: "paid" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const totalPayout =
          totalPayoutAgg.length > 0 ? totalPayoutAgg[0].total : 0;

        const isVerified = !!provider.isVerified;

        let payoutInformation = null;
        let documents = null;

        if (isVerified) {
          const payoutInfo = await PayoutInformation.findOne({
            provider: providerObjectId,
            isActive: true,
          });

          payoutInformation = payoutInfo
            ? {
                id: payoutInfo._id,
                accountHolderName: payoutInfo.accountHolderName,
                bankName: payoutInfo.bankName,
                bankCode: payoutInfo.bankCode,
                routingNumber: payoutInfo.routingNumber,
                accountType: payoutInfo.accountType,
                lastFourDigits: payoutInfo.lastFourDigits,
                accountNumber: payoutInfo.getMaskedAccountNumber(),
                verificationStatus: payoutInfo.verificationStatus,
                isVerified: payoutInfo.isVerified,
                isActive: payoutInfo.isActive,
                createdAt: payoutInfo.createdAt,
                updatedAt: payoutInfo.updatedAt,
              }
            : null;

          const approvedVerification = await Verification.findOne({
            provider: providerObjectId,
            status: "approved",
          }).sort({ createdAt: -1 });

          // Prefer documents saved on provider; fallback to latest approved verification
          if (provider.documents && provider.documents.length) {
            documents = provider.documents;
          } else if (approvedVerification) {
            documents = {
              verificationId: approvedVerification._id,
              insuranceDocument: approvedVerification.insuranceDocument,
              idCardFront: approvedVerification.idCardFront,
              idCardBack: approvedVerification.idCardBack,
              reviewedAt: approvedVerification.reviewedAt,
            };
          }
        }

        user = {
          ...provider,
          balances: isVerified
            ? {
                availableBalance: provider.availableBalance || 0,
                pendingPayout: provider.pendingPayout || 0,
                totalEarnings: provider.totalEarnings || 0,
                totalPayout,
              }
            : null,
          payoutInformation: isVerified ? payoutInformation : null,
          documents: isVerified ? documents : null,
        };

        // Remove sensitive/duplicate balance fields from the top level
        delete user.availableBalance;
        delete user.pendingPayout;
        delete user.totalEarnings;
        delete user.pendingEarnings;
        delete user.stripeAccountId;
      }
    } else if (req.user.role === "admin") {
      user = await Admin.findById(req.user._id).select("-password");
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Universal update profile - handles all user types with images
exports.updateProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      // Customer fields
      street,
      city,
      state,
      zipCode,
      aptSuite,
      // Provider fields
      businessNameRegistered,
      businessNameDBA,
      providerRole,
      businessAddressStreet,
      businessAddressCity,
      businessAddressState,
      businessAddressZipCode,
      website,
      servicesProvided,
      description,
      experience,
      businessServiceStart,
      businessServiceEnd,
      businessHoursStart,
      businessHoursEnd,
      maxBundleCapacity,
      // Admin fields
      adminRole,
      permissions,
    } = req.body;

    let user;

    // Find user based on role
    if (req.user.role === "customer") {
      user = await Customer.findById(req.user._id);
    } else if (req.user.role === "provider") {
      user = await ServiceProvider.findById(req.user._id);
    } else if (req.user.role === "admin") {
      user = await Admin.findById(req.user._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update basic info for all user types
    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (phone) user.phone = phone.trim();

    // Handle profile image upload for ALL user types (Customer, Provider, Admin)
    if (req.files && req.files["profileImage"]) {
      const profileImage = req.files["profileImage"][0];

      // Delete old image from Cloudinary if exists
      if (user.profileImage && user.profileImage.publicId) {
        await deleteImageFromCloudinary(user.profileImage.publicId);
      }

      let profileImageData = null;

      if (profileImage.path || profileImage.secure_url) {
        profileImageData = {
          url: profileImage.path || profileImage.secure_url,
          publicId: profileImage.filename || profileImage.public_id || "",
        };
      } else if (profileImage.buffer) {
        try {
          const result = await uploadBufferToCloudinary(
            profileImage.buffer,
            "naibrly/profiles",
            "profile"
          );
          profileImageData = {
            url: result.secure_url,
            publicId: result.public_id,
          };
        } catch (uploadError) {
          console.error("Profile image upload failed:", uploadError);
        }
      }

      if (profileImageData) {
        user.profileImage = profileImageData;
        user.markModified("profileImage");
      }
    }

    // Role-specific updates
    if (req.user.role === "customer") {
      // Update customer address
      if (street || city || state || zipCode || aptSuite) {
        user.address = {
          street: street ? street.trim() : user.address.street,
          city: city ? city.trim() : user.address.city,
          state: state ? state.trim() : user.address.state,
          zipCode: zipCode ? zipCode.trim() : user.address.zipCode,
          aptSuite: aptSuite ? aptSuite.trim() : user.address.aptSuite,
        };
      }
    } else if (req.user.role === "provider") {
      // Update business info
      if (businessNameRegistered)
        user.businessNameRegistered = businessNameRegistered.trim();
      if (businessNameDBA) user.businessNameDBA = businessNameDBA.trim();
      if (providerRole) user.providerRole = providerRole;
      if (website) user.website = website.trim();
      if (description) user.description = description.trim();
      if (experience) user.experience = parseInt(experience);
      if (maxBundleCapacity)
        user.maxBundleCapacity = parseInt(maxBundleCapacity);

      // Update business address
      if (
        businessAddressStreet ||
        businessAddressCity ||
        businessAddressState ||
        businessAddressZipCode
      ) {
        user.businessAddress = {
          street: businessAddressStreet
            ? businessAddressStreet.trim()
            : user.businessAddress.street,
          city: businessAddressCity
            ? businessAddressCity.trim()
            : user.businessAddress.city,
          state: businessAddressState
            ? businessAddressState.trim()
            : user.businessAddress.state,
          zipCode: businessAddressZipCode
            ? businessAddressZipCode.trim()
            : user.businessAddress.zipCode,
        };
      }

      // Update business hours and service days
      if (businessServiceStart)
        user.businessServiceDays.start = businessServiceStart;
      if (businessServiceEnd) user.businessServiceDays.end = businessServiceEnd;
      if (businessHoursStart) user.businessHours.start = businessHoursStart;
      if (businessHoursEnd) user.businessHours.end = businessHoursEnd;

      // Handle business logo upload for providers only
      if (req.files && req.files["businessLogo"]) {
        const businessLogo = req.files["businessLogo"][0];

        // Delete old logo from Cloudinary if exists
        if (user.businessLogo && user.businessLogo.publicId) {
          await deleteImageFromCloudinary(user.businessLogo.publicId);
        }

        let businessLogoData = null;

        if (businessLogo.path || businessLogo.secure_url) {
          businessLogoData = {
            url: businessLogo.path || businessLogo.secure_url,
            publicId: businessLogo.filename || businessLogo.public_id || "",
          };
        } else if (businessLogo.buffer) {
          try {
            const result = await uploadBufferToCloudinary(
              businessLogo.buffer,
              "naibrly/business-logos",
              "business_logo"
            );
            businessLogoData = {
              url: result.secure_url,
              publicId: result.public_id,
            };
          } catch (uploadError) {
            console.error("Business logo upload failed:", uploadError);
          }
        }

        if (businessLogoData) {
          user.businessLogo = businessLogoData;
          user.markModified("businessLogo");
        }
      }

      // Update services with hourly rates
      if (servicesProvided) {
        let servicesArray = [];

        // Parse services from different formats
        if (typeof servicesProvided === "string") {
          try {
            const parsedServices = JSON.parse(servicesProvided);
            if (Array.isArray(parsedServices)) {
              servicesArray = parsedServices;
            }
          } catch (error) {
            console.log("JSON parse failed for services");
          }
        } else if (Array.isArray(servicesProvided)) {
          servicesArray = servicesProvided;
        }

        // Validate and process services
        if (servicesArray.length > 0) {
          const serviceNames = servicesArray.map((s) => s.name);
          const validServices = await Service.find({
            name: { $in: serviceNames },
            isActive: true,
          });

          if (validServices.length !== serviceNames.length) {
            const validServiceNames = validServices.map((s) => s.name);
            const missingServices = serviceNames.filter(
              (name) => !validServiceNames.includes(name)
            );

            return res.status(400).json({
              success: false,
              message: `Invalid services: ${missingServices.join(", ")}`,
            });
          }

          user.servicesProvided = servicesArray.map((service) => ({
            name: service.name.trim(),
            hourlyRate: service.hourlyRate ? parseFloat(service.hourlyRate) : 0,
          }));

          // Update average hourly rate
          user.hourlyRate =
            servicesArray.length > 0
              ? servicesArray.reduce(
                  (sum, service) => sum + (service.hourlyRate || 0),
                  0
                ) / servicesArray.length
              : 0;
        }
      }
    } else if (req.user.role === "admin") {
      // Update admin-specific fields
      if (adminRole) user.adminRole = adminRole;
      if (permissions) {
        if (typeof permissions === "string") {
          try {
            user.permissions = JSON.parse(permissions);
          } catch (error) {
            return res.status(400).json({
              success: false,
              message: "Invalid permissions format",
            });
          }
        } else if (typeof permissions === "object") {
          user.permissions = { ...user.permissions, ...permissions };
        }
      }
    }

    await user.save();

    // Return updated user without password
    const updatedUser = await user.constructor
      .findById(req.user._id)
      .select("-password");

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: { user: updatedUser },
    });
  } catch (error) {
    console.error("Update profile error:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: error.message,
    });
  }
};

// controllers/userController.js - Add these new methods

// Update service provider profile with advanced service management
// controllers/userController.js - Fix the updateServiceProviderProfile method

// Update service provider profile with advanced service management
exports.updateServiceProviderProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      businessNameRegistered,
      businessNameDBA,
      providerRole,
      businessAddressStreet,
      businessAddressCity,
      businessAddressState,
      businessAddressZipCode,
      website,
      servicesProvided, // Array of objects with name and hourlyRate
      description,
      experience,
      businessServiceStart,
      businessServiceEnd,
      businessHoursStart,
      businessHoursEnd,
      maxBundleCapacity,
      // New fields for service management
      servicesToRemove, // Array of service names to remove
      servicesToUpdate, // Array of objects with name and new hourlyRate
      servicesToAdd, // Array of objects with name and hourlyRate to add
    } = req.body;

    // Find provider
    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Service provider not found",
      });
    }

    // Update basic info
    if (firstName) provider.firstName = firstName.trim();
    if (lastName) provider.lastName = lastName.trim();
    if (phone) provider.phone = phone.trim();

    // Update business info
    if (businessNameRegistered)
      provider.businessNameRegistered = businessNameRegistered.trim();
    if (businessNameDBA) provider.businessNameDBA = businessNameDBA.trim();
    if (providerRole) provider.providerRole = providerRole;
    if (website) provider.website = website.trim();
    if (description) provider.description = description.trim();
    if (experience) provider.experience = parseInt(experience);
    if (maxBundleCapacity)
      provider.maxBundleCapacity = parseInt(maxBundleCapacity);

    // Update business address
    if (
      businessAddressStreet ||
      businessAddressCity ||
      businessAddressState ||
      businessAddressZipCode
    ) {
      provider.businessAddress = {
        street: businessAddressStreet
          ? businessAddressStreet.trim()
          : provider.businessAddress.street,
        city: businessAddressCity
          ? businessAddressCity.trim()
          : provider.businessAddress.city,
        state: businessAddressState
          ? businessAddressState.trim()
          : provider.businessAddress.state,
        zipCode: businessAddressZipCode
          ? businessAddressZipCode.trim()
          : provider.businessAddress.zipCode,
      };
    }

    // Update business hours and service days
    if (businessServiceStart)
      provider.businessServiceDays.start = businessServiceStart;
    if (businessServiceEnd)
      provider.businessServiceDays.end = businessServiceEnd;
    if (businessHoursStart) provider.businessHours.start = businessHoursStart;
    if (businessHoursEnd) provider.businessHours.end = businessHoursEnd;

    // Handle profile image upload
    if (req.files && req.files["profileImage"]) {
      const profileImage = req.files["profileImage"][0];

      // Delete old image from Cloudinary if exists
      if (provider.profileImage && provider.profileImage.publicId) {
        await deleteImageFromCloudinary(provider.profileImage.publicId);
      }

      let profileImageData = null;

      if (profileImage.path || profileImage.secure_url) {
        profileImageData = {
          url: profileImage.path || profileImage.secure_url,
          publicId: profileImage.filename || profileImage.public_id || "",
        };
      } else if (profileImage.buffer) {
        try {
          const result = await uploadBufferToCloudinary(
            profileImage.buffer,
            "naibrly/profiles",
            "profile"
          );
          profileImageData = {
            url: result.secure_url,
            publicId: result.public_id,
          };
        } catch (uploadError) {
          console.error("Profile image upload failed:", uploadError);
        }
      }

      if (profileImageData) {
        provider.profileImage = profileImageData;
        provider.markModified("profileImage");
      }
    }

    // Handle business logo upload
    if (req.files && req.files["businessLogo"]) {
      const businessLogo = req.files["businessLogo"][0];

      // Delete old logo from Cloudinary if exists
      if (provider.businessLogo && provider.businessLogo.publicId) {
        await deleteImageFromCloudinary(provider.businessLogo.publicId);
      }

      let businessLogoData = null;

      if (businessLogo.path || businessLogo.secure_url) {
        businessLogoData = {
          url: businessLogo.path || businessLogo.secure_url,
          publicId: businessLogo.filename || businessLogo.public_id || "",
        };
      } else if (businessLogo.buffer) {
        try {
          const result = await uploadBufferToCloudinary(
            businessLogo.buffer,
            "naibrly/business-logos",
            "business_logo"
          );
          businessLogoData = {
            url: result.secure_url,
            publicId: result.public_id,
          };
        } catch (uploadError) {
          console.error("Business logo upload failed:", uploadError);
        }
      }

      if (businessLogoData) {
        provider.businessLogo = businessLogoData;
        provider.markModified("businessLogo");
      }
    }

    // ADVANCED SERVICE MANAGEMENT
    let finalServices = [...provider.servicesProvided];

    // Step 1: Remove services
    if (servicesToRemove && servicesToRemove.length > 0) {
      let servicesToRemoveArray = [];

      if (typeof servicesToRemove === "string") {
        try {
          servicesToRemoveArray = JSON.parse(servicesToRemove);
        } catch (error) {
          servicesToRemoveArray = servicesToRemove
            .split(",")
            .map((s) => s.trim());
        }
      } else if (Array.isArray(servicesToRemove)) {
        servicesToRemoveArray = servicesToRemove;
      }

      finalServices = finalServices.filter(
        (service) => !servicesToRemoveArray.includes(service.name)
      );
    }

    // Step 2: Update existing services
    if (servicesToUpdate && servicesToUpdate.length > 0) {
      let servicesToUpdateArray = [];

      if (typeof servicesToUpdate === "string") {
        try {
          servicesToUpdateArray = JSON.parse(servicesToUpdate);
        } catch (error) {
          console.log("JSON parse failed for servicesToUpdate");
        }
      } else if (Array.isArray(servicesToUpdate)) {
        servicesToUpdateArray = servicesToUpdate;
      }

      finalServices = finalServices.map((service) => {
        const updateService = servicesToUpdateArray.find(
          (s) => s.name === service.name
        );
        if (updateService) {
          return {
            name: service.name,
            hourlyRate: updateService.hourlyRate
              ? parseFloat(updateService.hourlyRate)
              : service.hourlyRate,
          };
        }
        return service;
      });
    }

    // Step 3: Add new services
    if (servicesToAdd && servicesToAdd.length > 0) {
      let servicesToAddArray = [];

      if (typeof servicesToAdd === "string") {
        try {
          servicesToAddArray = JSON.parse(servicesToAdd);
        } catch (error) {
          console.log("JSON parse failed for servicesToAdd");
        }
      } else if (Array.isArray(servicesToAdd)) {
        servicesToAddArray = servicesToAdd;
      }

      // Validate new services exist in the system
      const newServiceNames = servicesToAddArray
        .map((s) => s.name)
        .filter((name) => name && name.trim());
      const validServices = await Service.find({
        name: { $in: newServiceNames },
        isActive: true,
      });

      if (validServices.length !== newServiceNames.length) {
        const validServiceNames = validServices.map((s) => s.name);
        const missingServices = newServiceNames.filter(
          (name) => !validServiceNames.includes(name)
        );

        return res.status(400).json({
          success: false,
          message: `Invalid services: ${missingServices.join(
            ", "
          )}. Please provide valid service names.`,
        });
      }

      // Add new services (avoid duplicates)
      servicesToAddArray.forEach((newService) => {
        // FIX: Validate that service has a name before adding
        if (newService.name && newService.name.trim()) {
          const exists = finalServices.find(
            (s) => s.name === newService.name.trim()
          );
          if (!exists) {
            finalServices.push({
              name: newService.name.trim(),
              hourlyRate: newService.hourlyRate
                ? parseFloat(newService.hourlyRate)
                : 0,
            });
          }
        }
      });
    }

    // Step 4: Complete replacement if servicesProvided is provided
    if (servicesProvided) {
      let servicesArray = [];

      if (typeof servicesProvided === "string") {
        try {
          const parsedServices = JSON.parse(servicesProvided);
          if (Array.isArray(parsedServices)) {
            servicesArray = parsedServices;
          }
        } catch (error) {
          console.log("JSON parse failed for servicesProvided");
        }
      } else if (Array.isArray(servicesProvided)) {
        servicesArray = servicesProvided;
      }

      // FIX: Filter out services without names and validate only valid services
      const validServicesArray = servicesArray.filter(
        (service) =>
          service.name &&
          service.name.trim() &&
          typeof service.name === "string"
      );

      // Validate services exist in the system
      if (validServicesArray.length > 0) {
        const serviceNames = validServicesArray.map((s) => s.name.trim());
        const validServices = await Service.find({
          name: { $in: serviceNames },
          isActive: true,
        });

        if (validServices.length !== serviceNames.length) {
          const validServiceNames = validServices.map((s) => s.name);
          const missingServices = serviceNames.filter(
            (name) => !validServiceNames.includes(name)
          );

          return res.status(400).json({
            success: false,
            message: `Invalid services: ${missingServices.join(", ")}`,
          });
        }

        finalServices = validServicesArray.map((service) => ({
          name: service.name.trim(),
          hourlyRate: service.hourlyRate ? parseFloat(service.hourlyRate) : 0,
        }));
      } else {
        // If servicesProvided is provided but empty or invalid, clear services
        finalServices = [];
      }
    }

    // FIX: Final validation - ensure all services have valid names
    finalServices = finalServices.filter(
      (service) =>
        service.name && service.name.trim() && typeof service.name === "string"
    );

    // Remove duplicates by name
    const uniqueServices = [];
    const serviceNames = new Set();

    finalServices.forEach((service) => {
      if (!serviceNames.has(service.name)) {
        serviceNames.add(service.name);
        uniqueServices.push(service);
      }
    });

    // Update provider services with validated and cleaned array
    provider.servicesProvided = uniqueServices;

    // Update average hourly rate
    provider.hourlyRate =
      uniqueServices.length > 0
        ? uniqueServices.reduce(
            (sum, service) => sum + (service.hourlyRate || 0),
            0
          ) / uniqueServices.length
        : 0;

    await provider.save();

    // Return updated provider without password
    const updatedProvider = await ServiceProvider.findById(req.user._id).select(
      "-password"
    );

    res.json({
      success: true,
      message: "Service provider profile updated successfully",
      data: {
        user: updatedProvider,
        serviceChanges: {
          totalServices: uniqueServices.length,
          services: uniqueServices,
        },
      },
    });
  } catch (error) {
    console.error("Update service provider profile error:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: error.message,
    });
  }
};

// Mobile app: update provider profile using registration-style fields
exports.updateProviderProfileApp = async (req, res) => {
  try {
    const {
      phone,
      firstName,
      lastName,
      businessNameRegistered,
      businessServiceStart,
      businessServiceEnd,
      businessHoursStart,
      businessHoursEnd,
      servicesProvidedName,
      servicesProvidedHourlyRate,
      removeService,
    } = req.body;

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Service provider not found",
      });
    }

    // Basic info
    if (firstName) provider.firstName = firstName.trim();
    if (lastName) provider.lastName = lastName.trim();
    if (phone) provider.phone = phone.trim();

    // Business info
    if (businessNameRegistered)
      provider.businessNameRegistered = businessNameRegistered.trim();

    // Business service days and hours
    if (businessServiceStart)
      provider.businessServiceDays.start = businessServiceStart;
    if (businessServiceEnd)
      provider.businessServiceDays.end = businessServiceEnd;
    if (businessHoursStart) provider.businessHours.start = businessHoursStart;
    if (businessHoursEnd) provider.businessHours.end = businessHoursEnd;

    // Optional profile image upload
    if (req.files && req.files["profileImage"]) {
      const profileImage = req.files["profileImage"][0];

      if (provider.profileImage && provider.profileImage.publicId) {
        await deleteImageFromCloudinary(provider.profileImage.publicId);
      }

      let profileImageData = null;

      if (profileImage.path || profileImage.secure_url) {
        profileImageData = {
          url: profileImage.path || profileImage.secure_url,
          publicId: profileImage.filename || profileImage.public_id || "",
        };
      } else if (profileImage.buffer) {
        try {
          const result = await uploadBufferToCloudinary(
            profileImage.buffer,
            "naibrly/profiles",
            "profile"
          );
          profileImageData = {
            url: result.secure_url,
            publicId: result.public_id,
          };
        } catch (uploadError) {
          console.error("Profile image upload failed:", uploadError);
        }
      }

      if (profileImageData) {
        provider.profileImage = profileImageData;
        provider.markModified("profileImage");
      }
    }

    // Optional business logo upload
    if (req.files && req.files["businessLogo"]) {
      const businessLogo = req.files["businessLogo"][0];

      if (provider.businessLogo && provider.businessLogo.publicId) {
        await deleteImageFromCloudinary(provider.businessLogo.publicId);
      }

      let businessLogoData = null;

      if (businessLogo.path || businessLogo.secure_url) {
        businessLogoData = {
          url: businessLogo.path || businessLogo.secure_url,
          publicId: businessLogo.filename || businessLogo.public_id || "",
        };
      } else if (businessLogo.buffer) {
        try {
          const result = await uploadBufferToCloudinary(
            businessLogo.buffer,
            "naibrly/business-logos",
            "business_logo"
          );
          businessLogoData = {
            url: result.secure_url,
            publicId: result.public_id,
          };
        } catch (uploadError) {
          console.error("Business logo upload failed:", uploadError);
        }
      }

      if (businessLogoData) {
        provider.businessLogo = businessLogoData;
        provider.markModified("businessLogo");
      }
    }

    // Normalize current services
    let updatedServices = Array.isArray(provider.servicesProvided)
      ? [...provider.servicesProvided]
      : [];

    // Remove services (single string, CSV, or array)
    if (removeService) {
      let removeList = [];
      if (Array.isArray(removeService)) {
        removeList = removeService;
      } else if (typeof removeService === "string") {
        try {
          const parsed = JSON.parse(removeService);
          removeList = Array.isArray(parsed)
            ? parsed
            : removeService.split(",").map((s) => s.trim());
        } catch (error) {
          removeList = removeService.split(",").map((s) => s.trim());
        }
      }

      const removeSet = new Set(
        removeList.filter((name) => name && name.trim())
      );
      updatedServices = updatedServices.filter(
        (service) => !removeSet.has(service.name)
      );
    }

    // Parse incoming services (registration-style fields)
    let serviceNames = [];
    let serviceRates = [];

    if (servicesProvidedName) {
      serviceNames = Array.isArray(servicesProvidedName)
        ? servicesProvidedName
        : [servicesProvidedName];
    }

    if (servicesProvidedHourlyRate) {
      serviceRates = Array.isArray(servicesProvidedHourlyRate)
        ? servicesProvidedHourlyRate
        : [servicesProvidedHourlyRate];
    }

    const servicesToAdd = [];
    for (let i = 0; i < serviceNames.length; i++) {
      let serviceName = serviceNames[i];
      let hourlyRate = serviceRates[i] ? parseFloat(serviceRates[i]) : 0;

      if (Array.isArray(serviceName)) {
        serviceName = serviceName[0];
      }

      if (
        serviceName &&
        typeof serviceName === "string" &&
        serviceName.trim().length > 0
      ) {
        servicesToAdd.push({
          name: serviceName.trim(),
          hourlyRate,
        });
      }
    }

    if (servicesToAdd.length > 0) {
      const addNames = servicesToAdd.map((s) => s.name);
      const validServices = await Service.find({
        name: { $in: addNames },
        isActive: true,
      });

      if (validServices.length !== addNames.length) {
        const validServiceNames = validServices.map((s) => s.name);
        const missingServices = addNames.filter(
          (name) => !validServiceNames.includes(name)
        );

        return res.status(400).json({
          success: false,
          message: `Invalid services: ${missingServices.join(
            ", "
          )}. Please provide valid service names.`,
        });
      }

      const serviceMap = new Map(
        updatedServices.map((service) => [service.name, service])
      );

      servicesToAdd.forEach((service) => {
        serviceMap.set(service.name, {
          name: service.name,
          hourlyRate: service.hourlyRate || 0,
        });
      });

      updatedServices = Array.from(serviceMap.values());
    }

    provider.servicesProvided = updatedServices;
    provider.hourlyRate =
      updatedServices.length > 0
        ? updatedServices.reduce(
            (sum, service) => sum + (service.hourlyRate || 0),
            0
          ) / updatedServices.length
        : 0;

    await provider.save();

    const updatedProvider = await ServiceProvider.findById(req.user._id).select(
      "-password"
    );

    res.json({
      success: true,
      message: "Provider profile updated successfully",
      data: {
        user: updatedProvider,
      },
    });
  } catch (error) {
    console.error("Update provider profile (app) error:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: error.message,
    });
  }
};

// Get service provider services (for frontend management)
exports.getProviderServices = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id).select(
      "servicesProvided businessNameRegistered"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          services: provider.servicesProvided,
        },
      },
    });
  } catch (error) {
    console.error("Get provider services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider services",
      error: error.message,
    });
  }
};

// Fix the addServiceToProvider method as well
exports.addServiceToProvider = async (req, res) => {
  try {
    const { serviceName, hourlyRate } = req.body;

    if (!serviceName || !serviceName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Service name is required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    const trimmedServiceName = serviceName.trim();

    // Validate service exists
    const validService = await Service.findOne({
      name: trimmedServiceName,
      isActive: true,
    });

    if (!validService) {
      return res.status(400).json({
        success: false,
        message: `Invalid service: ${trimmedServiceName}. Please provide a valid service name.`,
      });
    }

    // Check if service already exists
    const existingService = provider.servicesProvided.find(
      (service) => service.name === trimmedServiceName
    );

    if (existingService) {
      return res.status(400).json({
        success: false,
        message: `Service "${trimmedServiceName}" already exists in your profile`,
      });
    }

    // Add new service
    provider.servicesProvided.push({
      name: trimmedServiceName,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : 0,
    });

    // Update average hourly rate
    provider.hourlyRate =
      provider.servicesProvided.length > 0
        ? provider.servicesProvided.reduce(
            (sum, service) => sum + (service.hourlyRate || 0),
            0
          ) / provider.servicesProvided.length
        : 0;

    await provider.save();

    res.json({
      success: true,
      message: `Service "${trimmedServiceName}" added successfully`,
      data: {
        service: {
          name: trimmedServiceName,
          hourlyRate: hourlyRate ? parseFloat(hourlyRate) : 0,
        },
        totalServices: provider.servicesProvided.length,
      },
    });
  } catch (error) {
    console.error("Add service to provider error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add service",
      error: error.message,
    });
  }
};

// Remove single service from provider
exports.removeServiceFromProvider = async (req, res) => {
  try {
    const { serviceName } = req.body;

    if (!serviceName) {
      return res.status(400).json({
        success: false,
        message: "Service name is required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Check if service exists
    const serviceIndex = provider.servicesProvided.findIndex(
      (service) => service.name === serviceName.trim()
    );

    if (serviceIndex === -1) {
      return res.status(404).json({
        success: false,
        message: `Service "${serviceName}" not found in your profile`,
      });
    }

    // Remove service
    const removedService = provider.servicesProvided.splice(serviceIndex, 1)[0];

    // Update average hourly rate
    provider.hourlyRate =
      provider.servicesProvided.length > 0
        ? provider.servicesProvided.reduce(
            (sum, service) => sum + (service.hourlyRate || 0),
            0
          ) / provider.servicesProvided.length
        : 0;

    await provider.save();

    res.json({
      success: true,
      message: `Service "${serviceName}" removed successfully`,
      data: {
        removedService,
        totalServices: provider.servicesProvided.length,
      },
    });
  } catch (error) {
    console.error("Remove service from provider error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove service",
      error: error.message,
    });
  }
};
// Update password for all user types
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password, new password, and confirm password are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirm password do not match",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    let user;
    if (req.user.role === "customer") {
      user = await Customer.findById(req.user._id);
    } else if (req.user.role === "provider") {
      user = await ServiceProvider.findById(req.user._id);
    } else if (req.user.role === "admin") {
      user = await Admin.findById(req.user._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update password error:", error);
    res.status(500).json({
      success: false,
      message: "Password update failed",
      error: error.message,
    });
  }
};

// Delete profile image for all user types (Customer, Provider, Admin)
exports.deleteProfileImage = async (req, res) => {
  try {
    let user;

    if (req.user.role === "customer") {
      user = await Customer.findById(req.user._id);
    } else if (req.user.role === "provider") {
      user = await ServiceProvider.findById(req.user._id);
    } else if (req.user.role === "admin") {
      user = await Admin.findById(req.user._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.profileImage && user.profileImage.publicId) {
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

// Delete business logo (Provider only)
exports.deleteBusinessLogo = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    if (provider.businessLogo && provider.businessLogo.publicId) {
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
