const Bundle = require("../models/Bundle");
const BundleSettings = require("../models/BundleSettings");
const Customer = require("../models/Customer");
const ServiceProvider = require("../models/ServiceProvider");
const Service = require("../models/Service");
const Conversation = require("../models/Conversation");
const { updateProviderRating } = require("./serviceRequestController");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { calculateBundleCommission } = require("./commissionController");

// Initialize default bundle settings
const initializeBundleSettings = async () => {
  try {
    const existingSettings = await BundleSettings.findOne();
    if (!existingSettings) {
      const settings = new BundleSettings();
      await settings.save();
      console.log("✅ Bundle settings initialized");
    }
  } catch (error) {
    console.error("❌ Bundle settings initialization error:", error);
  }
};

// Create a new bundle (Customer creates bundle)
exports.createBundle = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      categoryTypeName,
      services, // Array of service names only
      serviceDate,
      serviceTimeStart,
      serviceTimeEnd,
      zipCode,
      address,
      maxParticipants = 5,
    } = req.body;

    console.log("🔍 Debug - Bundle creation request:", {
      title,
      category,
      categoryTypeName,
      services,
      serviceDate,
      zipCode,
      maxParticipants,
    });

    // Validation
    if (
      !title ||
      !category ||
      !categoryTypeName ||
      !services ||
      !serviceDate ||
      !serviceTimeStart ||
      !serviceTimeEnd
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    // Validate services array
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one service must be provided",
      });
    }

    // Get customer (creator)
    const customer = await Customer.findById(req.user._id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Use customer's zipCode if not provided
    const customerZipCode = zipCode || customer.address.zipCode;
    if (!customerZipCode) {
      return res.status(400).json({
        success: false,
        message:
          "ZIP code is required. Please provide zipCode or update your profile address.",
      });
    }

    // Get bundle settings for discount
    const bundleSettings = await BundleSettings.findOne();
    const bundleDiscount = bundleSettings?.bundleDiscount || 10;
    const bundleExpiryHours = bundleSettings?.bundleExpiryHours || 24;

    // Validate services exist in the system and get default hourly rates
    const validServices = await Service.find({
      name: { $in: services },
      isActive: true,
    });

    if (validServices.length !== services.length) {
      const validServiceNames = validServices.map((s) => s.name);
      const invalidServices = services.filter(
        (service) => !validServiceNames.includes(service)
      );

      return res.status(400).json({
        success: false,
        message: `Invalid services: ${invalidServices.join(", ")}`,
      });
    }

    // Create services array with default hourly rates
    const servicesWithDefaultRates = validServices.map((service) => ({
      name: service.name,
      hourlyRate: service.defaultHourlyRate || 50, // Use service's default rate or fallback to 50
      estimatedHours: 2, // Default estimated hours
    }));

    console.log(
      "🔍 Debug - Services with default rates:",
      servicesWithDefaultRates
    );

    // Calculate expiry date
    const expiresAt = new Date(Date.now() + bundleExpiryHours * 60 * 60 * 1000);

    // Calculate pricing BEFORE creating bundle
    const totalPrice = servicesWithDefaultRates.reduce((sum, service) => {
      return sum + service.hourlyRate * service.estimatedHours;
    }, 0);

    const discountAmount = (totalPrice * bundleDiscount) / 100;
    const finalPrice = totalPrice - discountAmount;

    console.log("💰 Price calculation:", {
      totalPrice,
      discountAmount,
      finalPrice,
      bundleDiscount,
    });

    // Create bundle
    const bundle = new Bundle({
      creator: customer._id,
      title: title.trim(),
      description: description ? description.trim() : "",
      category: category.trim(),
      categoryTypeName: categoryTypeName.trim(),
      services: servicesWithDefaultRates, // Use services with default rates
      serviceDate: new Date(serviceDate),
      serviceTimeStart: serviceTimeStart.trim(),
      serviceTimeEnd: serviceTimeEnd.trim(),
      zipCode: customerZipCode.trim(),
      address: address || customer.address,
      maxParticipants: Math.min(maxParticipants, 10),
      currentParticipants: 1,
      participants: [
        {
          customer: customer._id,
          address: address || customer.address,
          status: "active",
        },
      ],
      bundleDiscount: bundleDiscount,
      expiresAt: expiresAt,
      shareToken: crypto.randomBytes(16).toString("hex"),
      // NEW: Store pricing in database
      pricing: {
        originalPrice: totalPrice,
        discountAmount: discountAmount,
        finalPrice: finalPrice,
        discountPercent: bundleDiscount,
      },
      finalPrice: finalPrice, // Also store finalPrice at root level for easy access
    });

    console.log("🔍 Debug - Bundle object before save:", bundle);

    await bundle.save();

    // Generate shareable link and QR code
    // Use backend URL so it's a direct API join endpoint
    const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:5000";
    const shareLink = `${apiBaseUrl}/api/bundles/share/${bundle.shareToken}`;

    let qrCodeDataUrl;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(shareLink);
    } catch (qrError) {
      console.error("QR Code generation error:", qrError);
      qrCodeDataUrl = null;
    }

    // Populate for response
    await bundle.populate(
      "creator",
      "firstName lastName email phone profileImage"
    );

    res.status(201).json({
      success: true,
      message:
        "Bundle created successfully. Other customers in your area can join.",
      data: {
        bundle: {
          ...bundle.toObject(),
          pricing: bundle.pricing, // Use stored pricing
          availableSpots: bundle.maxParticipants - 1,
        },
        sharing: {
          shareLink,
          qrCode: qrCodeDataUrl,
          shareToken: bundle.shareToken,
        },
      },
    });
  } catch (error) {
    console.error("Create bundle error:", error);

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
      message: "Failed to create bundle",
      error: error.message,
    });
  }
};
// Join existing bundle (Other customers join)
exports.joinBundle = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { address } = req.body || {}; // Handle missing req.body
    const customerId = req.user._id;

    console.log("🔍 Join bundle request:", { bundleId, customerId, address });

    const bundle = await Bundle.findById(bundleId);

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    // Check if bundle has available spots
    if (!bundle.hasAvailableSpots()) {
      return res.status(400).json({
        success: false,
        message: "Bundle is already full",
      });
    }

    // Check if customer is already in bundle
    if (bundle.isCustomerInBundle(customerId)) {
      return res.status(400).json({
        success: false,
        message: "You are already part of this bundle",
      });
    }

    // Check if bundle is still active and not expired
    if (bundle.status !== "pending" && bundle.status !== "accepted") {
      return res.status(400).json({
        success: false,
        message: "Bundle is not accepting new participants",
      });
    }

    if (new Date() > bundle.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "Bundle has expired",
      });
    }

    // Get customer
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // ZIP CODE VALIDATION: Check if customer is in same zip code as bundle
    if (customer.address.zipCode !== bundle.zipCode) {
      return res.status(400).json({
        success: false,
        message: "You must be in the same ZIP code area to join this bundle",
        details: {
          yourZipCode: customer.address.zipCode,
          bundleZipCode: bundle.zipCode,
        },
      });
    }

    // Use customer's address if no address provided
    const joinAddress = address || customer.address;

    // Add customer to bundle with their own address
    bundle.participants.push({
      customer: customerId,
      address: joinAddress,
      status: "active",
    });
    bundle.currentParticipants += 1;

    // Check if bundle is now full
    if (bundle.currentParticipants >= bundle.maxParticipants) {
      bundle.status = "full";
    }

    await bundle.save();

    // If a provider is already assigned, ensure a conversation exists for this participant
    if (bundle.provider) {
      try {
        const existingConversation = await Conversation.findOne({
          bundleId: bundle._id,
          customerId,
        });

        if (!existingConversation) {
          const conversation = new Conversation({
            customerId,
            providerId: bundle.provider,
            bundleId: bundle._id,
            messages: [],
            isActive: true,
          });
          await conversation.save();
          console.log("✅ Created conversation for new participant:", {
            conversationId: conversation._id,
            customerId,
            bundleId: bundle._id,
          });
        }
      } catch (conversationError) {
        console.error("❌ Failed to create conversation for new participant:", {
          error: conversationError,
          customerId,
          bundleId: bundle._id,
        });
        // Do not fail the join flow if conversation creation fails
      }
    }

    // Populate for response
    await bundle.populate([
      { path: "creator", select: "firstName lastName profileImage" },
      {
        path: "participants.customer",
        select: "firstName lastName profileImage",
      },
      { path: "provider", select: "businessNameRegistered businessLogo" },
    ]);

    // Calculate pricing for the joining customer
    const pricing = bundle.calculateCustomerPrice();

    res.json({
      success: true,
      message: "Successfully joined the bundle",
      data: {
        bundle: {
          ...bundle.toObject(),
          pricing: pricing,
          availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        },
        joinedAs: {
          customerId: customerId,
          address: joinAddress,
        },
      },
    });
  } catch (error) {
    console.error("Join bundle error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to join bundle",
      error: error.message,
    });
  }
};

// Get available bundles by zip code (Public endpoint)
exports.getBundlesByZipCode = async (req, res) => {
  try {
    const { zipCode, category, page = 1, limit = 10 } = req.query;

    if (!zipCode) {
      return res.status(400).json({
        success: false,
        message: "Zip code is required",
      });
    }

    const filter = {
      zipCode: zipCode,
      status: { $in: ["pending", "accepted"] },
      expiresAt: { $gt: new Date() },
      currentParticipants: { $lt: "$maxParticipants" }, // Has available spotss
    };

    if (category) {
      filter.category = category;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bundles, total] = await Promise.all([
      Bundle.find(filter)
        .populate("creator", "firstName lastName profileImage")
        .populate("participants.customer", "firstName lastName profileImage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments(filter),
    ]);

    // Add pricing and available spots information to each bundle
    const bundlesWithDetails = bundles.map((bundle) => {
      const pricing = bundle.calculateCustomerPrice();
      return {
        ...bundle.toObject(),
        pricing: pricing,
        availableSpots: bundle.maxParticipants - bundle.currentParticipants,
      };
    });

    res.json({
      success: true,
      data: {
        bundles: bundlesWithDetails,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get bundles by zip code error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bundles",
      error: error.message,
    });
  }
};

// Get bundle details
exports.getBundleDetails = async (req, res) => {
  try {
    const { bundleId } = req.params;

    const bundle = await Bundle.findById(bundleId)
      .populate(
        "creator",
        "firstName lastName email phone profileImage address"
      )
      .populate(
        "participants.customer",
        "firstName lastName email phone profileImage address"
      )
      .populate(
        "provider",
        "businessNameRegistered businessLogo email phone businessAddress"
      )
      .populate(
        "providerOffers.provider",
        "businessNameRegistered businessLogo rating"
      );

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    // Calculate pricing for a customer
    const pricing = bundle.calculateCustomerPrice();

    res.json({
      success: true,
      data: {
        bundle: {
          ...bundle.toObject(),
          pricing: pricing,
          availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        },
      },
    });
  } catch (error) {
    console.error("Get bundle details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bundle details",
      error: error.message,
    });
  }
};

// Provider makes offer for bundle
exports.makeProviderOffer = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { message } = req.body;
    const providerId = req.user._id;

    const bundle = await Bundle.findById(bundleId);

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    // Check if provider already made an offer
    const existingOffer = bundle.providerOffers.find(
      (offer) => offer.provider.toString() === providerId.toString()
    );

    if (existingOffer) {
      return res.status(400).json({
        success: false,
        message: "You have already made an offer for this bundle",
      });
    }

    // Get provider details
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Check if provider serves this zip code
    const servesThisZip = provider.serviceAreas.some(
      (area) => area.zipCode === bundle.zipCode && area.isActive
    );

    if (!servesThisZip) {
      return res.status(400).json({
        success: false,
        message: "You do not serve in this bundle's ZIP code area",
      });
    }

    // Add provider offer
    bundle.providerOffers.push({
      provider: providerId,
      message: message || `I can provide these services for your bundle`,
      status: "pending",
    });

    await bundle.save();

    // Populate for response
    await bundle.populate(
      "providerOffers.provider",
      "businessNameRegistered businessLogo rating"
    );

    res.json({
      success: true,
      message: "Offer submitted successfully",
      data: {
        bundle,
      },
    });
  } catch (error) {
    console.error("Make provider offer error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit offer",
      error: error.message,
    });
  }
};

// Provider updates bundle status (accept, decline, complete)
exports.updateBundleStatus = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { status, message, cancellationReason } = req.body;
    const providerId = req.user._id;

    console.log("🔧 Update bundle status request:", {
      bundleId,
      status,
      message,
      providerId,
    });

    // Validate required fields
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    // Validate status
    const validStatuses = [
      "accepted",
      "declined",
      "completed",
      "in_progress",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Use: ${validStatuses.join(", ")}`,
      });
    }

    const bundle = await Bundle.findById(bundleId);
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    // Get provider details
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Check if provider serves this zip code
    const servesThisZip = provider.serviceAreas.some(
      (area) => area.zipCode === bundle.zipCode && area.isActive
    );

    if (!servesThisZip) {
      return res.status(400).json({
        success: false,
        message: "You do not serve in this bundle's ZIP code area",
      });
    }

    let statusNote = "";
    let changedBy = "provider";
    let originalMaxParticipants = bundle.maxParticipants; // Store original capacity

    // Handle different status updates
    if (status === "accepted") {
      // Check if bundle already has a provider
      if (
        bundle.provider &&
        bundle.provider.toString() !== providerId.toString()
      ) {
        return res.status(400).json({
          success: false,
          message: "This bundle is already assigned to another provider",
        });
      }

      // ✅ UPDATE: Set maxParticipants to provider's maxBundleCapacity
      const providerMaxCapacity = provider.maxBundleCapacity || 5;
      bundle.maxParticipants = providerMaxCapacity;

      console.log("🔄 Updating bundle capacity:", {
        originalCapacity: originalMaxParticipants,
        providerCapacity: providerMaxCapacity,
        newCapacity: bundle.maxParticipants,
      });

      // Set provider and update rates
      bundle.provider = providerId;
      statusNote =
        message ||
        `Bundle accepted by ${provider.businessNameRegistered}. Capacity set to ${providerMaxCapacity}.`;

      // Add to provider offers if not already there
      const existingOffer = bundle.providerOffers.find(
        (offer) => offer.provider.toString() === providerId.toString()
      );

      if (!existingOffer) {
        bundle.providerOffers.push({
          provider: providerId,
          message:
            message ||
            `Provider ${provider.businessNameRegistered} accepted this bundle (Capacity: ${providerMaxCapacity})`,
          status: "accepted",
        });
      }

      // FIXED: Update bundle with provider's hourly rates and recalculate pricing
      await exports.updateBundleWithProviderRates(bundleId, providerId);

      // Recalculate pricing with provider's rates
      const updatedBundle = await Bundle.findById(bundleId);
      if (updatedBundle) {
        const totalPrice = updatedBundle.services.reduce((sum, service) => {
          return sum + service.hourlyRate * service.estimatedHours;
        }, 0);

        const discountAmount =
          (totalPrice * updatedBundle.bundleDiscount) / 100;
        const finalPrice = totalPrice - discountAmount;

        // Update bundle pricing with provider's rates
        updatedBundle.pricing = {
          originalPrice: totalPrice,
          discountAmount: discountAmount,
          finalPrice: finalPrice,
          discountPercent: updatedBundle.bundleDiscount,
        };
        updatedBundle.finalPrice = finalPrice;

        await updatedBundle.save();
        console.log("💰 Updated bundle pricing with provider rates:", {
          totalPrice,
          discountAmount,
          finalPrice,
          services: updatedBundle.services,
        });
      }

      // Create separate conversations for each participant (including creator)
      try {
        const participantIds = new Set();
        if (bundle.creator) {
          participantIds.add(bundle.creator.toString());
        }
        bundle.participants?.forEach((p) => {
          if (p.customer) {
            participantIds.add(p.customer.toString());
          }
        });

        for (const customerId of participantIds) {
          const existingConversation = await Conversation.findOne({
            bundleId: bundle._id,
            customerId,
          });

          if (!existingConversation) {
            const conversation = new Conversation({
              customerId,
              providerId: bundle.provider,
              bundleId: bundle._id,
              messages: [],
              isActive: true,
            });
            await conversation.save();
            console.log("? Created bundle conversation:", {
              conversationId: conversation._id,
              customerId,
            });
          } else {
            console.log("? Bundle conversation already exists:", {
              conversationId: existingConversation._id,
              customerId,
            });
          }
        }
      } catch (conversationError) {
        console.error("? Conversation creation error:", conversationError);
        // Don't fail the whole request if conversation creation fails
      }
    } else if (status === "declined") {
      statusNote =
        message || `Bundle declined by ${provider.businessNameRegistered}`;

      // Add to provider offers as declined
      const existingOffer = bundle.providerOffers.find(
        (offer) => offer.provider.toString() === providerId.toString()
      );

      if (!existingOffer) {
        bundle.providerOffers.push({
          provider: providerId,
          message: message || "Provider declined this bundle",
          status: "rejected",
        });
      }
    } else if (status === "in_progress") {
      // Check if provider owns this bundle
      if (
        !bundle.provider ||
        bundle.provider.toString() !== providerId.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only the assigned provider can update bundle to in_progress",
        });
      }
      statusNote = message || "Bundle work started by provider";
    } else if (status === "completed") {
      // Check if provider owns this bundle
      if (
        !bundle.provider ||
        bundle.provider.toString() !== providerId.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "Only the assigned provider can complete the bundle",
        });
      }
      statusNote = message || "Bundle completed by provider";
      bundle.completedAt = new Date();

      // Ensure final price is set when bundle is completed
      if (!bundle.finalPrice && bundle.pricing) {
        bundle.finalPrice = bundle.pricing.finalPrice;
      }
    } else if (status === "cancelled") {
      // Check if provider owns this bundle
      if (
        !bundle.provider ||
        bundle.provider.toString() !== providerId.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "Only the assigned provider can cancel the bundle",
        });
      }
      statusNote = cancellationReason || "Bundle cancelled by provider";
      bundle.cancelledBy = "provider";
      bundle.cancellationReason = cancellationReason || "No reason provided";
    }

    // Update bundle status
    bundle.status = status;

    // Add status history
    if (!bundle.statusHistory) {
      bundle.statusHistory = [];
    }

    bundle.statusHistory.push({
      status: status,
      note: statusNote,
      changedBy: changedBy,
      timestamp: new Date(),
    });

    await bundle.save();

    // Populate for response
    await bundle.populate([
      { path: "creator", select: "firstName lastName profileImage phone" },
      {
        path: "participants.customer",
        select: "firstName lastName profileImage phone",
      },
      {
        path: "provider",
        select:
          "businessNameRegistered businessLogo rating phone email servicesProvided maxBundleCapacity",
      },
    ]);

    // Prepare response message
    let responseMessage = `Bundle ${status} successfully`;
    if (status === "accepted") {
      responseMessage = `Bundle accepted successfully. Capacity updated from ${originalMaxParticipants} to ${bundle.maxParticipants} spots. Pricing updated with your service rates.`;
    } else if (status === "declined") {
      responseMessage = "Bundle declined successfully";
    } else if (status === "in_progress") {
      responseMessage = "Bundle marked as in progress";
    } else if (status === "completed") {
      responseMessage = "Bundle completed successfully";
    } else if (status === "cancelled") {
      responseMessage = "Bundle cancelled successfully";
    }

    res.json({
      success: true,
      message: responseMessage,
      data: {
        bundle: {
          ...bundle.toObject(),
          pricing: bundle.pricing, // Include updated pricing in response
          availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        },
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          maxBundleCapacity: provider.maxBundleCapacity,
          services: provider.servicesProvided, // Show provider's services for reference
        },
        capacityUpdate:
          status === "accepted"
            ? {
                message: "Bundle capacity updated to provider's max capacity",
                originalCapacity: originalMaxParticipants,
                newCapacity: bundle.maxParticipants,
                providerMaxCapacity: provider.maxBundleCapacity,
                availableSpots:
                  bundle.maxParticipants - bundle.currentParticipants,
              }
            : null,
        pricingUpdate:
          status === "accepted"
            ? {
                message: "Pricing updated with provider's hourly rates",
                previousRates: "Default service rates",
                currentRates: "Provider's specific rates",
              }
            : null,
      },
    });
  } catch (error) {
    console.error("Update bundle status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update bundle status",
      error: error.message,
    });
  }
};

// Get nearby bundles for customer (based on customer's zip code)
exports.getNearbyBundlesForCustomer = async (req, res) => {
  try {
    const { page = 1, limit = 10, category } = req.query;
    const customerId = req.user._id;

    console.log("🔍 Fetching nearby bundles for customer:", customerId);

    // Get customer's zip code
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const customerZipCode = customer.address.zipCode;
    console.log("🔍 Customer ZIP code:", customerZipCode);

    if (!customerZipCode) {
      return res.status(400).json({
        success: false,
        message:
          "Customer ZIP code not found. Please update your profile address.",
      });
    }

    // FIXED: Build proper filter for bundles in customer's zip code
    const filter = {
      zipCode: customerZipCode,
      status: { $in: ["pending", "accepted"] },
      expiresAt: { $gt: new Date() },
      $expr: { $lt: ["$currentParticipants", "$maxParticipants"] }, // FIXED: Use $expr for field comparison
    };

    // Optional category filter
    if (category) {
      filter.category = category;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bundles, total] = await Promise.all([
      Bundle.find(filter)
        .populate("creator", "firstName lastName profileImage address")
        .populate(
          "participants.customer",
          "firstName lastName profileImage address"
        )
        .populate("provider", "businessNameRegistered businessLogo rating")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments(filter),
    ]);

    console.log(`🔍 Found ${bundles.length} bundles in ZIP ${customerZipCode}`);

    // Add pricing and available spots information to each bundle
    const bundlesWithDetails = bundles.map((bundle) => {
      const pricing = bundle.calculateCustomerPrice();
      const isCreator = bundle.creator._id.toString() === customerId.toString();
      const isParticipant = bundle.participants.some(
        (p) =>
          p.customer._id.toString() === customerId.toString() &&
          p.status === "active"
      );

      return {
        ...bundle.toObject(),
        pricing: pricing,
        availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        userRole: isCreator
          ? "creator"
          : isParticipant
          ? "participant"
          : "none",
        canJoin:
          !isCreator &&
          !isParticipant &&
          bundle.currentParticipants < bundle.maxParticipants,
      };
    });

    res.json({
      success: true,
      message: `Found ${bundles.length} bundles in your area`,
      data: {
        bundles: bundlesWithDetails,
        customerLocation: {
          zipCode: customerZipCode,
          address: customer.address,
        },
        searchCriteria: {
          zipCode: customerZipCode,
          category: category || "all",
          status: "active",
        },
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get nearby bundles for customer error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby bundles",
      error: error.message,
    });
  }
};

// Search bundles by name and ZIP code for customers
exports.searchBundlesByNameAndZip = async (req, res) => {
  try {
    const { searchQuery, zipCode, category, page = 1, limit = 10 } = req.query;
    const customerId = req.user._id;

    console.log("🔍 Searching bundles for customer:", {
      customerId,
      searchQuery,
      zipCode,
      category,
    });

    // Get customer details
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Use provided ZIP code or customer's default ZIP code
    const searchZipCode = zipCode || customer.address.zipCode;
    console.log("🔍 Using ZIP code:", searchZipCode);

    if (!searchZipCode) {
      return res.status(400).json({
        success: false,
        message:
          "ZIP code is required. Please provide zipCode or update your profile address.",
      });
    }

    // Build search filter
    const filter = {
      zipCode: searchZipCode,
      status: { $in: ["pending", "accepted"] },
      expiresAt: { $gt: new Date() },
      $expr: { $lt: ["$currentParticipants", "$maxParticipants"] },
    };

    // Add search query filter (search in title and description)
    if (searchQuery && searchQuery.trim() !== "") {
      const searchRegex = new RegExp(searchQuery.trim(), "i");
      filter.$or = [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { category: { $regex: searchRegex } },
        { categoryTypeName: { $regex: searchRegex } },
        { "services.name": { $regex: searchRegex } },
      ];
    }

    // Optional category filter
    if (category && category !== "all") {
      filter.category = category;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bundles, total] = await Promise.all([
      Bundle.find(filter)
        .populate("creator", "firstName lastName profileImage address")
        .populate(
          "participants.customer",
          "firstName lastName profileImage address"
        )
        .populate("provider", "businessNameRegistered businessLogo rating")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments(filter),
    ]);

    console.log(`🔍 Found ${bundles.length} bundles matching search criteria`);

    // Add pricing and user-specific information to each bundle
    const bundlesWithDetails = bundles.map((bundle) => {
      const pricing = bundle.calculateCustomerPrice();
      const isCreator = bundle.creator._id.toString() === customerId.toString();
      const isParticipant = bundle.participants.some(
        (p) =>
          p.customer._id.toString() === customerId.toString() &&
          p.status === "active"
      );

      // Calculate relevance score for search results
      const relevanceScore = calculateBundleRelevance(bundle, searchQuery);

      return {
        ...bundle.toObject(),
        pricing: pricing,
        availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        userRole: isCreator
          ? "creator"
          : isParticipant
          ? "participant"
          : "none",
        canJoin:
          !isCreator &&
          !isParticipant &&
          bundle.currentParticipants < bundle.maxParticipants,
        relevanceScore: relevanceScore,
        searchMatch: {
          titleMatch: searchQuery
            ? bundle.title.toLowerCase().includes(searchQuery.toLowerCase())
            : false,
          descriptionMatch: searchQuery
            ? bundle.description
                .toLowerCase()
                .includes(searchQuery.toLowerCase())
            : false,
          serviceMatch: searchQuery
            ? bundle.services.some((service) =>
                service.name.toLowerCase().includes(searchQuery.toLowerCase())
              )
            : false,
        },
      };
    });

    // Sort by relevance if search query is provided
    if (searchQuery && searchQuery.trim() !== "") {
      bundlesWithDetails.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    res.json({
      success: true,
      message: `Found ${bundles.length} bundles matching your search`,
      data: {
        bundles: bundlesWithDetails,
        searchSummary: {
          query: searchQuery || "all bundles",
          zipCode: searchZipCode,
          category: category || "all",
          totalResults: total,
          hasSearchQuery: !!searchQuery,
        },
        customerLocation: {
          zipCode: customer.address.zipCode,
          address: customer.address,
          searchUsedDefaultZip: !zipCode, // Indicates if customer's default ZIP was used
        },
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: total > skip + parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Search bundles by name and ZIP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search bundles",
      error: error.message,
    });
  }
};

// Helper function to calculate bundle relevance for search
const calculateBundleRelevance = (bundle, searchQuery) => {
  if (!searchQuery) return 0;

  const query = searchQuery.toLowerCase();
  let score = 0;

  // Title matches are most important
  if (bundle.title.toLowerCase().includes(query)) {
    score += 50;
  }

  // Category matches
  if (bundle.category.toLowerCase().includes(query)) {
    score += 30;
  }

  // Category type matches
  if (bundle.categoryTypeName.toLowerCase().includes(query)) {
    score += 25;
  }

  // Service matches
  const serviceMatch = bundle.services.some((service) =>
    service.name.toLowerCase().includes(query)
  );
  if (serviceMatch) {
    score += 20;
  }

  // Description matches (less important)
  if (bundle.description.toLowerCase().includes(query)) {
    score += 10;
  }

  // Boost relevance for newer bundles
  const daysOld = (new Date() - bundle.createdAt) / (1000 * 60 * 60 * 24);
  if (daysOld < 1) score += 15; // Less than 1 day old
  else if (daysOld < 3) score += 10; // Less than 3 days old
  else if (daysOld < 7) score += 5; // Less than 1 week old

  // Boost for bundles with more available spots
  const availabilityRatio =
    (bundle.maxParticipants - bundle.currentParticipants) /
    bundle.maxParticipants;
  score += Math.round(availabilityRatio * 10);

  return Math.min(score, 100);
};
// Update bundle with provider's hourly rates when they accept
exports.updateBundleWithProviderRates = async (bundleId, providerId) => {
  try {
    const bundle = await Bundle.findById(bundleId);
    const provider = await ServiceProvider.findById(providerId);

    if (!bundle || !provider) {
      throw new Error("Bundle or provider not found");
    }

    console.log("🔧 Updating bundle with provider's rates and capacity:", {
      bundleId,
      providerId,
      currentMaxParticipants: bundle.maxParticipants,
      providerMaxCapacity: provider.maxBundleCapacity,
    });

    // Update each service with provider's specific hourly rate
    const updatedServices = bundle.services.map((service) => {
      const providerService = provider.servicesProvided.find(
        (sp) => sp.name === service.name
      );

      return {
        name: service.name,
        hourlyRate: providerService?.hourlyRate || service.hourlyRate,
      };
    });

    // ✅ UPDATE: Set maxParticipants to provider's maxBundleCapacity
    bundle.services = updatedServices;
    bundle.maxParticipants = provider.maxBundleCapacity || 5;

    // If current participants exceed new capacity, handle it
    if (bundle.currentParticipants > bundle.maxParticipants) {
      console.warn(
        `⚠️ Bundle has ${bundle.currentParticipants} participants but provider capacity is ${bundle.maxParticipants}`
      );
      // You can choose to handle this by setting status to full or other logic
      if (bundle.currentParticipants >= bundle.maxParticipants) {
        bundle.status = "full";
      }
    }

    await bundle.save();

    console.log(
      "✅ Bundle updated with provider's hourly rates and capacity:",
      {
        newMaxParticipants: bundle.maxParticipants,
        providerMaxCapacity: provider.maxBundleCapacity,
        servicesCount: bundle.services.length,
      }
    );

    return bundle;
  } catch (error) {
    console.error(
      "Error updating bundle with provider rates and capacity:",
      error
    );
    throw error;
  }
};

// Customer accepts provider offer
exports.acceptProviderOffer = async (req, res) => {
  try {
    const { bundleId, offerId } = req.params;
    const customerId = req.user._id;

    const bundle = await Bundle.findById(bundleId);

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    // Check if customer is the bundle creator
    if (bundle.creator.toString() !== customerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only bundle creator can accept offers",
      });
    }

    // Find and update the offer
    const offer = bundle.providerOffers.id(offerId);
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    // Accept this offer and reject others
    bundle.providerOffers.forEach((off) => {
      if (off._id.toString() === offerId) {
        off.status = "accepted";
      } else {
        off.status = "rejected";
      }
    });

    bundle.provider = offer.provider;
    bundle.status = "accepted";

    await bundle.save();

    // Create separate conversations for each participant (including creator)
    try {
      const participantIds = new Set();
      if (bundle.creator) {
        participantIds.add(bundle.creator.toString());
      }
      bundle.participants?.forEach((p) => {
        if (p.customer) {
          participantIds.add(p.customer.toString());
        }
      });

      for (const customerId of participantIds) {
        const existingConversation = await Conversation.findOne({
          bundleId: bundle._id,
          customerId,
        });

        if (!existingConversation) {
          const conversation = new Conversation({
            customerId,
            providerId: bundle.provider,
            bundleId: bundle._id,
            messages: [],
            isActive: true,
          });
          await conversation.save();
          console.log("✅ Created bundle conversation (offer accepted):", {
            conversationId: conversation._id,
            customerId,
          });
        }
      }
    } catch (conversationError) {
      console.error("❌ Conversation creation error (offer accepted):", conversationError);
      // Do not fail the response on conversation creation issues
    }

    res.json({
      success: true,
      message:
        "Provider offer accepted successfully. Separate conversations created for each participant.",
      data: {
        bundle,
      },
    });
  } catch (error) {
    console.error("Accept provider offer error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept offer",
      error: error.message,
    });
  }
};

// Get user's bundles (created or joined)
exports.getUserBundles = async (req, res) => {
  try {
    const { type = "all", page = 1, limit = 10 } = req.query;
    const userId = req.user._id;

    let filter = {};

    if (type === "created") {
      filter = { creator: userId };
    } else if (type === "joined") {
      filter = {
        "participants.customer": userId,
        "participants.status": "active",
        creator: { $ne: userId }, // Exclude bundles they created
      };
    } else {
      // All bundles (created or joined)
      filter = {
        $or: [
          { creator: userId },
          {
            "participants.customer": userId,
            "participants.status": "active",
          },
        ],
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bundles, total] = await Promise.all([
      Bundle.find(filter)
        .populate("creator", "firstName lastName profileImage")
        .populate("participants.customer", "firstName lastName profileImage")
        .populate("provider", "businessNameRegistered businessLogo")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments(filter),
    ]);

    // Add pricing and role information
    const bundlesWithDetails = bundles.map((bundle) => {
      const pricing = bundle.calculateCustomerPrice();
      const isCreator = bundle.creator._id.toString() === userId.toString();
      const isParticipant = bundle.participants.some(
        (p) =>
          p.customer._id.toString() === userId.toString() &&
          p.status === "active"
      );

      return {
        ...bundle.toObject(),
        pricing: pricing,
        availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        userRole: isCreator
          ? "creator"
          : isParticipant
          ? "participant"
          : "none",
      };
    });

    res.json({
      success: true,
      data: {
        bundles: bundlesWithDetails,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get user bundles error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user bundles",
      error: error.message,
    });
  }
};

// Get all bundles with advanced filtering (for any user)
exports.getAllBundles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      category,
      zipCode,
      serviceType,
      minPrice,
      maxPrice,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      providerId,
      customerId,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter object
    const filter = {};

    // Status filter
    if (status) {
      if (status === "active") {
        filter.status = { $in: ["pending", "accepted", "in_progress"] };
        filter.expiresAt = { $gt: new Date() };
      } else if (status === "available") {
        filter.status = { $in: ["pending", "accepted"] };
        filter.expiresAt = { $gt: new Date() };
        filter.$expr = { $lt: ["$currentParticipants", "$maxParticipants"] };
      } else {
        filter.status = status;
      }
    } else {
      // Default: show active bundles only
      filter.status = { $in: ["pending", "accepted", "in_progress"] };
      filter.expiresAt = { $gt: new Date() };
    }

    // Category filter
    if (category) {
      filter.category = category;
    }

    // ZIP code filter
    if (zipCode) {
      filter.zipCode = zipCode;
    }

    // Service type filter
    if (serviceType) {
      filter["services.name"] = { $regex: serviceType, $options: "i" };
    }

    // Price range filter
    if (minPrice || maxPrice) {
      filter.finalPrice = {};
      if (minPrice) filter.finalPrice.$gte = parseFloat(minPrice);
      if (maxPrice) filter.finalPrice.$lte = parseFloat(maxPrice);
    }

    // Search filter (title, description, category)
    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search.trim(), "i");
      filter.$or = [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { category: { $regex: searchRegex } },
        { categoryTypeName: { $regex: searchRegex } },
        { "services.name": { $regex: searchRegex } },
      ];
    }

    // Provider filter
    if (providerId) {
      filter.provider = providerId;
    }

    // Customer filter (created by specific customer)
    if (customerId) {
      filter.creator = customerId;
    }

    console.log("🔍 Bundle filter:", JSON.stringify(filter, null, 2));

    // Build sort object
    const sortOptions = {};
    switch (sortBy) {
      case "price":
        sortOptions.finalPrice = sortOrder === "asc" ? 1 : -1;
        break;
      case "participants":
        sortOptions.currentParticipants = sortOrder === "asc" ? 1 : -1;
        break;
      case "expiry":
        sortOptions.expiresAt = sortOrder === "asc" ? 1 : -1;
        break;
      case "title":
        sortOptions.title = sortOrder === "asc" ? 1 : -1;
        break;
      default:
        sortOptions.createdAt = sortOrder === "asc" ? 1 : -1;
    }

    // Execute query with population
    const [bundles, total] = await Promise.all([
      Bundle.find(filter)
        .populate(
          "creator",
          "firstName lastName email phone profileImage address"
        )
        .populate(
          "participants.customer",
          "firstName lastName profileImage address"
        )
        .populate(
          "provider",
          "businessNameRegistered businessLogo rating phone email"
        )
        .populate(
          "providerOffers.provider",
          "businessNameRegistered businessLogo rating"
        )
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments(filter),
    ]);

    // Enhance bundles with additional information
    const bundlesWithDetails = bundles.map((bundle) => {
      const pricing = bundle.calculateCustomerPrice();
      const availableSpots =
        bundle.maxParticipants - bundle.currentParticipants;

      // Calculate time remaining
      const timeRemaining = bundle.expiresAt - new Date();
      const hoursRemaining = Math.max(
        0,
        Math.floor(timeRemaining / (1000 * 60 * 60))
      );

      // Determine bundle status for display
      let displayStatus = bundle.status;
      if (bundle.status === "pending" && availableSpots === 0) {
        displayStatus = "full";
      } else if (bundle.status === "pending" && hoursRemaining < 24) {
        displayStatus = "urgent";
      }

      return {
        ...bundle.toObject(),
        pricing: pricing,
        availableSpots: availableSpots,
        displayStatus: displayStatus,
        hoursRemaining: hoursRemaining,
        isExpired: new Date() > bundle.expiresAt,
        canJoin:
          availableSpots > 0 &&
          bundle.status === "pending" &&
          new Date() <= bundle.expiresAt,
        servicesCount: bundle.services.length,
        totalEstimatedHours: bundle.services.reduce(
          (sum, service) => sum + (service.estimatedHours || 1),
          0
        ),
      };
    });

    // Get aggregation data for statistics
    const stats = await Bundle.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalBundles: { $sum: 1 },
          avgParticipants: { $avg: "$currentParticipants" },
          avgPrice: { $avg: "$finalPrice" },
          minPrice: { $min: "$finalPrice" },
          maxPrice: { $max: "$finalPrice" },
        },
      },
    ]);

    const categoryStats = await Bundle.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          avgPrice: { $avg: "$finalPrice" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      message: `Found ${bundles.length} bundles`,
      data: {
        bundles: bundlesWithDetails,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: total > skip + parseInt(limit),
        },
        filters: {
          status: status || "active",
          category: category || "all",
          zipCode: zipCode || "all",
          serviceType: serviceType || "all",
          priceRange: {
            min: minPrice || 0,
            max: maxPrice || "any",
          },
          search: search || "",
          sortBy,
          sortOrder,
        },
        statistics: stats[0]
          ? {
              totalBundles: stats[0].totalBundles,
              avgParticipants: Math.round(stats[0].avgParticipants * 10) / 10,
              avgPrice: Math.round(stats[0].avgPrice * 100) / 100,
              priceRange: {
                min: Math.round(stats[0].minPrice * 100) / 100,
                max: Math.round(stats[0].maxPrice * 100) / 100,
              },
            }
          : null,
        categories: categoryStats,
        summary: {
          activeBundles: bundlesWithDetails.filter(
            (b) =>
              b.status === "pending" && !b.isExpired && b.availableSpots > 0
          ).length,
          expiringSoon: bundlesWithDetails.filter(
            (b) => b.hoursRemaining < 24 && b.status === "pending"
          ).length,
          fullBundles: bundlesWithDetails.filter((b) => b.availableSpots === 0)
            .length,
        },
      },
    });
  } catch (error) {
    console.error("Get all bundles error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bundles",
      error: error.message,
    });
  }
};

// Provider accepts bundle directly
exports.providerAcceptBundle = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const providerId = req.user._id;

    const bundle = await Bundle.findById(bundleId);
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    // Check if bundle is still available
    if (bundle.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Bundle is no longer available",
      });
    }

    // Get provider details
    const provider = await ServiceProvider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Check if provider serves this zip code
    const servesThisZip = provider.serviceAreas.some(
      (area) => area.zipCode === bundle.zipCode && area.isActive
    );

    if (!servesThisZip) {
      return res.status(400).json({
        success: false,
        message: "You do not serve in this bundle's ZIP code area",
      });
    }

    // Set provider and update status
    bundle.provider = providerId;
    bundle.status = "accepted";

    // Add provider offer
    bundle.providerOffers.push({
      provider: providerId,
      message: `Provider ${provider.businessNameRegistered} accepted this bundle directly`,
      status: "accepted",
    });

    // Add status history
    bundle.statusHistory.push({
      status: "accepted",
      note: `Bundle accepted by ${provider.businessNameRegistered}`,
      changedBy: "provider",
      timestamp: new Date(),
    });

    await bundle.save();

    // Create separate conversations for each participant (including creator)
    try {
      const participantIds = new Set();
      if (bundle.creator) {
        participantIds.add(bundle.creator.toString());
      }
      bundle.participants?.forEach((p) => {
        if (p.customer) {
          participantIds.add(p.customer.toString());
        }
      });

      for (const customerId of participantIds) {
        const existingConversation = await Conversation.findOne({
          bundleId: bundle._id,
          customerId,
        });

        if (!existingConversation) {
          const conversation = new Conversation({
            customerId,
            providerId: bundle.provider,
            bundleId: bundle._id,
            messages: [],
            isActive: true,
          });
          await conversation.save();
          console.log("✅ Created bundle conversation (direct accept):", {
            conversationId: conversation._id,
            customerId,
          });
        }
      }
    } catch (conversationError) {
      console.error("❌ Conversation creation error (direct accept):", conversationError);
      // Do not fail the response on conversation creation issues
    }

    // Populate for response
    await bundle.populate([
      {
        path: "provider",
        select: "businessNameRegistered businessLogo rating phone email",
      },
      { path: "creator", select: "firstName lastName profileImage phone" },
      {
        path: "participants.customer",
        select: "firstName lastName profileImage",
      },
    ]);

    res.json({
      success: true,
      message:
        "Bundle accepted successfully. Separate conversations created for each participant.",
      data: {
        bundle,
      },
    });
  } catch (error) {
    console.error("Provider accept bundle error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept bundle",
      error: error.message,
    });
  }
};

// Join bundle via share token
exports.joinBundleViaShareToken = async (req, res) => {
  try {
    const { shareToken } = req.params;
    const { address } = req.body || {};
    const customerId = req.user._id;

    // Find bundle by share token
    const bundle = await Bundle.findOne({ shareToken });
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found or link has expired",
      });
    }

    // Check if bundle is expired
    if (new Date() > bundle.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "Bundle has expired",
      });
    }

    // Use the join bundle logic
    return exports.joinBundle(
      {
        params: { bundleId: bundle._id },
        body: { address },
        user: { _id: customerId },
      },
      res
    );
  } catch (error) {
    console.error("Join bundle via share token error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to join bundle",
      error: error.message,
    });
  }
};

// Get bundle details by share token (view-only, does not join)
exports.getBundleByShareToken = async (req, res) => {
  try {
    const { shareToken } = req.params;

    const bundle = await Bundle.findOne({ shareToken })
      .populate(
        "creator",
        "firstName lastName email phone profileImage address"
      )
      .populate(
        "participants.customer",
        "firstName lastName email phone profileImage address"
      )
      .populate(
        "provider",
        "businessNameRegistered businessLogo email phone businessAddress"
      );

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found or link has expired",
      });
    }

    // If expired, do not allow join
    if (new Date() > bundle.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "Bundle has expired",
      });
    }

    const pricing = bundle.calculateCustomerPrice();

    return res.json({
      success: true,
      data: {
        bundle: {
          ...bundle.toObject(),
          pricing,
          availableSpots: bundle.maxParticipants - bundle.currentParticipants,
        },
      },
    });
  } catch (error) {
    console.error("Get bundle by share token error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bundle details",
      error: error.message,
    });
  }
};

exports.initializeBundleSettings = initializeBundleSettings;

// Add review to bundle (applies rating to all services and provider average)
exports.addBundleReview = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { rating, comment } = req.body;
    const customerId = req.user._id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    const bundle = await Bundle.findById(bundleId)
      .populate("creator", "firstName lastName")
      .populate("participants.customer", "firstName lastName")
      .populate("provider", "businessNameRegistered");

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    if (!bundle.provider) {
      return res.status(400).json({
        success: false,
        message: "Bundle has no assigned provider to review",
      });
    }

    // Check if customer is creator or participant
    const isCreator = bundle.creator?._id?.toString() === customerId.toString();
    const isParticipant = bundle.participants.some(
      (p) => p.customer && p.customer._id.toString() === customerId.toString()
    );

    if (!isCreator && !isParticipant) {
      return res.status(403).json({
        success: false,
        message: "You are not part of this bundle",
      });
    }

    // Check if already reviewed by this customer
    const alreadyReviewed = bundle.reviews.some(
      (rev) => rev.customer.toString() === customerId.toString()
    );

    if (alreadyReviewed) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this bundle",
      });
    }

    bundle.reviews.push({
      customer: customerId,
      rating,
      comment,
      createdAt: new Date(),
    });

    await bundle.save();

    // Update provider rating (includes bundle reviews + services)
    await updateProviderRating(bundle.provider._id);

    res.json({
      success: true,
      message: "Bundle review submitted successfully",
      data: {
        bundle: {
          id: bundle._id,
          reviews: bundle.reviews,
          provider: bundle.provider,
        },
      },
    });
  } catch (error) {
    console.error("Add bundle review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit bundle review",
      error: error.message,
    });
  }
};

