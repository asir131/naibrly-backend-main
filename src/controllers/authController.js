const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Service = require("../models/Service");
const Admin = require("../models/Admin");
const PayoutInformation = require("../models/PayoutInformation");
const Verification = require("../models/Verification");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const MoneyRequest = require("../models/MoneyRequest");
const ServiceRequest = require("../models/ServiceRequest");
const { cloudinary } = require("../config/cloudinary");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// Upload buffer to Cloudinary with a hard timeout so requests don't hang forever
const uploadToCloudinary = async (buffer, folder, filename, timeoutMs = 20000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Cloudinary upload timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: filename,
        resource_type: "image",
      },
      (error, result) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      }
    );

    const { Readable } = require("stream");
    Readable.from(buffer).pipe(uploadStream);
  });
};

// Enhanced customer registration with proper image handling
const registerCustomer = async (req, res) => {
  console.log("=== CUSTOMER REGISTRATION STARTED ===");
  console.log("Request file:", req.file);
  console.log("Request body:", req.body);

  try {
    const {
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      phone,
      street,
      city,
      state,
      zipCode,
      aptSuite,
    } = req.body;

    // Validate required fields
    if (
      !firstName ||
      !lastName ||
      !email ||
      !password ||
      !phone ||
      !street ||
      !city ||
      !state ||
      !zipCode
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const existingCustomer = await Customer.findOne({ email });
    let existingProvider = null;

    try {
      if (ServiceProvider && typeof ServiceProvider.findOne === "function") {
        existingProvider = await ServiceProvider.findOne({ email });
      }
    } catch (error) {
      console.warn("ServiceProvider check failed:", error.message);
    }

    if (existingCustomer || existingProvider) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    // Handle image upload (supports direct Cloudinary storage or memory buffer)
    let profileImageData = { url: "", publicId: "" };
    if (req.file) {
      // If using Cloudinary storage middleware, the file already has path/filename
      if (req.file.path || req.file.secure_url) {
        profileImageData = {
          url: req.file.path || req.file.secure_url,
          publicId: req.file.filename || req.file.public_id || "",
        };
        console.log("Profile image received from Cloudinary storage:", profileImageData);
      } else if (req.file.buffer) {
        console.log("Processing uploaded file for customer from memory buffer");
        try {
          const timestamp = Date.now();
          const randomString = Math.random().toString(36).substring(2, 15);
          const publicId = `customer_profile_${timestamp}_${randomString}`;

          const result = await uploadToCloudinary(
            req.file.buffer,
            "naibrly/profiles",
            publicId
          );

          profileImageData = {
            url: result.secure_url,
            publicId: result.public_id,
          };
          console.log("Profile image uploaded to Cloudinary:", profileImageData);
        } catch (uploadError) {
          console.error(
            "Cloudinary upload error for customer profile:",
            uploadError
          );
          // Continue without image if upload fails
        }
      }
    }

    const customer = new Customer({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      profileImage: profileImageData,
      address: {
        street: street.trim(),
        city: city.trim(),
        state: state.trim(),
        zipCode: zipCode.trim(),
        aptSuite: aptSuite ? aptSuite.trim() : "",
      },
    });

    console.log("Customer object before save:", customer);

    await customer.save();

    // Verify what was actually saved
    const savedCustomer = await Customer.findById(customer._id);
    console.log(
      "Customer after save - profileImage:",
      savedCustomer.profileImage
    );

    const token = generateToken(customer._id);

    console.log("=== CUSTOMER REGISTRATION SUCCESS ===");

    res.status(201).json({
      success: true,
      message: "Customer registered successfully",
      data: {
        token,
        user: {
          id: customer._id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          role: customer.role,
          profileImage: customer.profileImage,
          address: customer.address,
        },
      },
    });
  } catch (error) {
    console.error("Customer registration error:", error);

    // Handle specific error types
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Customer registration failed",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

// Enhanced provider registration with proper image handling

const registerProvider = async (req, res) => {
  try {
    const {
      email,
      password,
      phone,
      businessNameRegistered,
      businessNameDBA,
      providerRole,
      businessAddressStreet,
      businessAddressCity,
      businessAddressState,
      businessAddressZipCode,
      website,
      description,
      experience,
      businessServiceStart,
      businessServiceEnd,
      businessHoursStart,
      businessHoursEnd,
    } = req.body;

    // Validation (firstName/lastName removed)
    if (
      !email ||
      !password ||
      !phone ||
      !businessNameRegistered ||
      !providerRole
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields",
        missingFields: {
          email: !email,
          password: !password,
          phone: !phone,
          businessNameRegistered: !businessNameRegistered,
          providerRole: !providerRole,
        },
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const existingProvider = await ServiceProvider.findOne({ email });
    if (existingProvider) {
      return res.status(400).json({
        success: false,
        message: "Service provider already exists with this email",
      });
    }

    // FIXED: Parse services from multiple form fields
    let servicesArray = [];

    console.log("All request body fields:", req.body);

    // Handle services parsing - fix for Postman array issue
    if (req.body.servicesProvidedName) {
      let serviceNames = [];
      let serviceRates = [];

      // If servicesProvidedName is an array (multiple values with same key)
      if (Array.isArray(req.body.servicesProvidedName)) {
        serviceNames = req.body.servicesProvidedName;
      } else {
        // If it's a single value
        serviceNames = [req.body.servicesProvidedName];
      }

      // If servicesProvidedHourlyRate is an array
      if (req.body.servicesProvidedHourlyRate) {
        if (Array.isArray(req.body.servicesProvidedHourlyRate)) {
          serviceRates = req.body.servicesProvidedHourlyRate;
        } else {
          serviceRates = [req.body.servicesProvidedHourlyRate];
        }
      }

      console.log("Service names found:", serviceNames);
      console.log("Service rates found:", serviceRates);

      // Create services array by pairing names with rates
      for (let i = 0; i < serviceNames.length; i++) {
        let serviceName = serviceNames[i];
        let hourlyRate = serviceRates[i] ? parseFloat(serviceRates[i]) : 0;

        // FIX: Handle case where serviceName might be an array
        if (Array.isArray(serviceName)) {
          serviceName = serviceName[0]; // Take the first element
        }

        // FIX: Ensure serviceName is a string before calling trim
        if (
          serviceName &&
          typeof serviceName === "string" &&
          serviceName.trim().length > 0
        ) {
          servicesArray.push({
            name: serviceName.trim(),
            hourlyRate: hourlyRate,
          });
        }
      }
    }

    console.log("Final services array:", servicesArray);

    // Validate services exist in the system
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
          message: `Invalid services: ${missingServices.join(
            ", "
          )}. Please provide valid service names.`,
        });
      }
    }

    const businessServiceDays = {
      start: businessServiceStart,
      end: businessServiceEnd,
    };

    const businessHours = {
      start: businessHoursStart,
      end: businessHoursEnd,
    };

    if (!businessServiceDays.start || !businessServiceDays.end) {
      return res.status(400).json({
        success: false,
        message: "Business service start and end days are required",
      });
    }

    if (!businessHours.start || !businessHours.end) {
      return res.status(400).json({
        success: false,
        message: "Business hours start and end times are required",
      });
    }

      // Handle business logo upload only (profile image removed)
      // If outbound network is restricted, allow skipping Cloudinary to avoid timeouts
      let businessLogoData = { url: "", publicId: "" };
      const skipUploads = process.env.SKIP_UPLOADS === "true";

      // If using Cloudinary storage via multer (preferred)
      if (req.file || (req.files && req.files.businessLogo && req.files.businessLogo[0]?.path)) {
        const logoFile = req.file || (req.files.businessLogo ? req.files.businessLogo[0] : null);
        businessLogoData = {
          url: logoFile.path || logoFile.secure_url || "",
          publicId: logoFile.filename || logoFile.public_id || "",
        };
        console.log("Business logo received from Cloudinary storage:", businessLogoData);
      }
      // If using memory buffer (fallback path)
      else if (req.files && req.files["businessLogo"]) {
        const businessLogo = req.files["businessLogo"][0];
        console.log("Processing business logo from memory buffer");

        if (skipUploads) {
          console.log("Skipping Cloudinary upload (SKIP_UPLOADS=true)");
        } else {
          try {
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const publicId = `business_logo_${timestamp}_${randomString}`;

            const result = await uploadToCloudinary(
              businessLogo.buffer,
              "naibrly/business-logos",
              publicId
            );

            businessLogoData = {
              url: result.secure_url,
              publicId: result.public_id,
            };
            console.log("Business logo uploaded to Cloudinary:", businessLogoData);
          } catch (uploadError) {
            console.error(
              "Cloudinary upload error for business logo:",
              uploadError
            );
          }
        }
      }

    // Create business address object only if address fields are provided
    const businessAddress = {};
    if (businessAddressStreet)
      businessAddress.street = businessAddressStreet.trim();
    if (businessAddressCity) businessAddress.city = businessAddressCity.trim();
    if (businessAddressState)
      businessAddress.state = businessAddressState.trim();
    if (businessAddressZipCode)
      businessAddress.zipCode = businessAddressZipCode.trim();

    // Calculate average hourly rate for legacy compatibility
    const averageHourlyRate =
      servicesArray.length > 0
        ? servicesArray.reduce((sum, service) => sum + service.hourlyRate, 0) /
          servicesArray.length
        : 0;

    // Create the service provider
    const serviceProvider = new ServiceProvider({
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      profileImage: { url: "", publicId: "" }, // Empty profile image
      businessLogo: businessLogoData,
      businessNameRegistered: businessNameRegistered.trim(),
      businessNameDBA: businessNameDBA ? businessNameDBA.trim() : "",
      providerRole,
      businessAddress:
        Object.keys(businessAddress).length > 0 ? businessAddress : undefined,
      website: website ? website.trim() : "",
      servicesProvided: servicesArray,
      description: description ? description.trim() : "",
      experience: experience ? parseInt(experience) : 0,
      hourlyRate: averageHourlyRate,
      businessServiceDays,
      businessHours,
      isApproved: true,
      isVerified: false,
    });

    console.log("Provider object before save:", serviceProvider);

    await serviceProvider.save();

    // Verify what was actually saved
    const savedProvider = await ServiceProvider.findById(serviceProvider._id);
    console.log(
      "Provider after save - servicesProvided:",
      savedProvider.servicesProvided
    );

    const token = generateToken(serviceProvider._id);

    console.log("=== PROVIDER REGISTRATION SUCCESS ===");

    res.status(201).json({
      success: true,
      message: "Service provider registered successfully",
      data: {
        token,
        user: {
          id: serviceProvider._id,
          email: serviceProvider.email,
          phone: serviceProvider.phone,
          profileImage: serviceProvider.profileImage,
          role: serviceProvider.role,
          isApproved: serviceProvider.isApproved,
          isVerified: serviceProvider.isVerified,
          isActive: serviceProvider.isActive,
        },
        providerProfile: {
          businessName: serviceProvider.businessNameRegistered,
          providerRole: serviceProvider.providerRole,
          servicesProvided: serviceProvider.servicesProvided,
          businessLogo: serviceProvider.businessLogo,
          businessAddress: serviceProvider.businessAddress,
          businessServiceDays: serviceProvider.businessServiceDays,
          businessHours: serviceProvider.businessHours,
        },
      },
    });
  } catch (error) {
    console.error("Provider registration error:", error);

    // Handle specific error types
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Service provider registration failed",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    let user = await Customer.findOne({ email });
    if (!user) {
      try {
        user = await ServiceProvider.findOne({ email });
      } catch (error) {
        console.warn("ServiceProvider login check failed:", error.message);
      }
    }
    if (!user) {
      try {
        user = await Admin.findOne({ email });
      } catch (error) {
        console.warn("Admin login check failed:", error.message);
      }
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Account is deactivated",
      });
    }

    const token = generateToken(user._id);

    let userData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      profileImage: user.profileImage,
      isVerified: user.isVerified,
    };

    if (user.role === "provider") {
      userData.providerProfile = {
        businessName: user.businessNameRegistered,
        providerRole: user.providerRole,
        servicesProvided: user.servicesProvided,
        isApproved: user.isApproved,
        approvalStatus: user.approvalStatus,
        rating: user.rating,
        businessLogo: user.businessLogo,
        businessServiceDays: user.businessServiceDays,
        businessHours: user.businessHours,
      };

      userData.isApproved = user.isApproved;
      userData.approvalStatus = user.approvalStatus;
    } else if (user.role === "customer") {
      userData.address = user.address;
    } else if (user.role === "admin") {
      userData.adminRole = user.adminRole;
      userData.permissions = user.permissions;
    }

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: userData,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
};

const getMe = async (req, res) => {
  try {
    let userData;

    if (req.user.role === "customer") {
      userData = await Customer.findById(req.user._id).select("-password");
    } else if (req.user.role === "provider") {
      userData = await ServiceProvider.findById(req.user._id)
        .select("-password")
        .lean();

      if (userData) {
        const providerObjectId = new mongoose.Types.ObjectId(req.user._id);

        const totalPayoutAgg = await WithdrawalRequest.aggregate([
          { $match: { provider: providerObjectId, status: "paid" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const totalPayout =
          totalPayoutAgg.length > 0 ? totalPayoutAgg[0].total : 0;

        const isVerified = !!userData.isVerified;

        let payoutInformation = null;
        let verificationDocuments = null;

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

          verificationDocuments = approvedVerification
            ? {
                verificationId: approvedVerification._id,
                insuranceDocument: approvedVerification.insuranceDocument,
                idCardFront: approvedVerification.idCardFront,
                idCardBack: approvedVerification.idCardBack,
                reviewedAt: approvedVerification.reviewedAt,
              }
            : null;
        }

        userData.providerProfile = {
          id: userData._id,
          businessName: userData.businessNameRegistered,
          businessLogo: userData.businessLogo,
          profileImage: userData.profileImage,
          servicesProvided: userData.servicesProvided,
          businessAddress: userData.businessAddress,
          businessServiceDays: userData.businessServiceDays,
          businessHours: userData.businessHours,
          rating: userData.rating,
          totalReviews: userData.totalReviews,
          isApproved: userData.isApproved,
          isVerified: userData.isVerified,
          balances: isVerified
            ? {
                availableBalance: userData.availableBalance || 0,
                pendingPayout: userData.pendingPayout || 0,
                totalEarnings: userData.totalEarnings || 0,
                totalPayout,
              }
            : null,
          payoutInformation: isVerified ? payoutInformation : null,
          documents: isVerified ? verificationDocuments : null,
        };
      }
    } else if (req.user.role === "admin") {
      userData = await Admin.findById(req.user._id).select("-password");
    }

    res.json({
      success: true,
      data: {
        user: userData,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const approveProvider = async (req, res) => {
  try {
    const { providerId } = req.params;

    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    provider.isApproved = true;
    provider.approvalStatus = "approved";
    await provider.save();

    res.json({
      success: true,
      message: "Provider approved successfully",
      data: {
        provider: {
          id: provider._id,
          email: provider.email,
          businessName: provider.businessNameRegistered,
          isApproved: provider.isApproved,
          approvalStatus: provider.approvalStatus,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Approval failed",
      error: error.message,
    });
  }
};

const checkProviderStatus = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    res.json({
      success: true,
      data: {
        isApproved: provider.isApproved,
        approvalStatus: provider.approvalStatus,
        isActive: provider.isActive,
        isVerified: provider.isVerified,
        canSubmitVerification:
          provider.isApproved && provider.approvalStatus === "approved",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error checking provider status",
      error: error.message,
    });
  }
};

const getAllProviders = async (req, res) => {
  try {
    const providers = await ServiceProvider.find().select("-password");

    res.json({
      success: true,
      data: {
        providers: providers.map((provider) => ({
          id: provider._id,
          firstName: provider.firstName,
          lastName: provider.lastName,
          email: provider.email,
          businessName: provider.businessNameRegistered,
          isApproved: provider.isApproved,
          approvalStatus: provider.approvalStatus,
          isActive: provider.isActive,
          createdAt: provider.createdAt,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching providers",
      error: error.message,
    });
  }
};

// Stateless logout: instruct client to discard JWT
const logout = async (req, res) => {
  try {
    res.json({
      success: true,
      message:
        "Logged out successfully. Please remove your token on the client.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Logout failed",
      error: error.message,
    });
  }
};

// Delete current account (customer or provider)
const deleteAccount = async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user._id;

    if (role === "customer") {
      await Promise.all([
        Customer.deleteOne({ _id: userId }),
        MoneyRequest.deleteMany({ customer: userId }),
      ]);
      return res.json({
        success: true,
        message: "Customer account deleted successfully",
      });
    }

    if (role === "provider") {
      await Promise.all([
        ServiceProvider.deleteOne({ _id: userId }),
        PayoutInformation.deleteMany({ provider: userId }),
        Verification.deleteMany({ provider: userId }),
        WithdrawalRequest.deleteMany({ provider: userId }),
        MoneyRequest.deleteMany({ provider: userId }),
        ServiceRequest.deleteMany({ provider: userId }),
      ]);
      return res.json({
        success: true,
        message: "Provider account deleted successfully",
      });
    }

    // Protect admins from deletion via this endpoint
    return res.status(403).json({
      success: false,
      message: "Account deletion not allowed for this role",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete account",
      error: error.message,
    });
  }
};

// Public: get all customers (basic profile, no passwords)
const getAllCustomers = async (_req, res) => {
  try {
    const customers = await Customer.find()
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        customers,
        total: customers.length,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching customers",
      error: error.message,
    });
  }
};

module.exports = {
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
};
