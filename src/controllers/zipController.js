const ServiceProvider = require("../models/ServiceProvider");
const Bundle = require("../models/Bundle");
const CategoryType = require("../models/CategoryType");

// Get provider's service areas
exports.getProviderServiceAreas = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id).select(
      "serviceAreas businessNameRegistered businessAddress"
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
          businessAddress: provider.businessAddress,
          serviceAreas: provider.serviceAreas,
        },
      },
    });
  } catch (error) {
    console.error("Get provider service areas error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service areas",
      error: error.message,
    });
  }
};

// Add new service area for provider
exports.addServiceArea = async (req, res) => {
  try {
    const { zipCode, city, state } = req.body;

    if (!zipCode) {
      return res.status(400).json({
        success: false,
        message: "ZIP code is required",
      });
    }

    // Basic ZIP code validation
    const zipRegex = /^\d{5}(-\d{4})?$/;
    if (!zipRegex.test(zipCode)) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid ZIP code format (e.g., 12345 or 12345-6789)",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Check if ZIP code already exists in service areas
    const existingArea = provider.serviceAreas.find(
      (area) => area.zipCode === zipCode
    );

    if (existingArea) {
      return res.status(400).json({
        success: false,
        message: `ZIP code ${zipCode} is already in your service areas`,
      });
    }

    // Add new service area
    provider.serviceAreas.push({
      zipCode: zipCode.trim(),
      city: city ? city.trim() : "",
      state: state ? state.trim() : "",
      isActive: true,
      addedAt: new Date(),
    });

    await provider.save();

    res.json({
      success: true,
      message: `Service area ${zipCode} added successfully`,
      data: {
        serviceArea: {
          zipCode: zipCode.trim(),
          city: city ? city.trim() : "",
          state: state ? state.trim() : "",
          isActive: true,
        },
        totalServiceAreas: provider.serviceAreas.length,
      },
    });
  } catch (error) {
    console.error("Add service area error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add service area",
      error: error.message,
    });
  }
};

// Remove service area from provider
exports.removeServiceArea = async (req, res) => {
  try {
    const { zipCode } = req.body;

    if (!zipCode) {
      return res.status(400).json({
        success: false,
        message: "ZIP code is required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find and remove the service area
    const initialLength = provider.serviceAreas.length;
    provider.serviceAreas = provider.serviceAreas.filter(
      (area) => area.zipCode !== zipCode
    );

    if (provider.serviceAreas.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: `ZIP code ${zipCode} not found in your service areas`,
      });
    }

    await provider.save();

    res.json({
      success: true,
      message: `Service area ${zipCode} removed successfully`,
      data: {
        removedZipCode: zipCode,
        remainingServiceAreas: provider.serviceAreas.length,
      },
    });
  } catch (error) {
    console.error("Remove service area error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove service area",
      error: error.message,
    });
  }
};

// Toggle service area active status
exports.toggleServiceArea = async (req, res) => {
  try {
    const { zipCode, isActive } = req.body;

    if (!zipCode || isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: "ZIP code and isActive status are required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find the service area
    const serviceArea = provider.serviceAreas.find(
      (area) => area.zipCode === zipCode
    );

    if (!serviceArea) {
      return res.status(404).json({
        success: false,
        message: `ZIP code ${zipCode} not found in your service areas`,
      });
    }

    // Update active status
    serviceArea.isActive = isActive;

    await provider.save();

    res.json({
      success: true,
      message: `Service area ${zipCode} ${
        isActive ? "activated" : "deactivated"
      } successfully`,
      data: {
        serviceArea: {
          zipCode: serviceArea.zipCode,
          isActive: serviceArea.isActive,
        },
      },
    });
  } catch (error) {
    console.error("Toggle service area error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update service area",
      error: error.message,
    });
  }
};

// Get nearby active bundles for provider (based on their service areas)
exports.getNearbyBundles = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = "pending" } = req.query;
    const skip = (page - 1) * limit;

    // Mark expired bundles without deleting (keep for conversations/history)
    const now = new Date();
    await Bundle.updateMany(
      {
        serviceDate: { $lt: now },
        status: { $nin: ["completed", "cancelled", "expired"] },
      },
      { $set: { status: "expired" } }
    );


    console.log("🔍 Fetching nearby bundles for provider:", req.user._id);

    // Get provider with service areas
    const provider = await ServiceProvider.findById(req.user._id).select(
      "serviceAreas servicesProvided businessNameRegistered businessAddress"
    );
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    console.log("🔍 Provider service areas:", provider.serviceAreas);

    // Get active service area ZIP codes
    let activeServiceZips = provider.serviceAreas
      .filter((area) => area.isActive !== false)
      .map((area) => area.zipCode);

    if (activeServiceZips.length === 0) {
      const businessZip = provider.businessAddress?.zipCode?.trim();
      if (businessZip) {
        activeServiceZips = [businessZip];
      }
    }

    console.log("🔍 Active service ZIPs:", activeServiceZips);

    if (activeServiceZips.length === 0) {
      return res.json({
        success: true,
        message:
          "No active service areas found. Please add service areas to see nearby bundles.",
        data: {
          bundles: [],
          serviceAreas: [],
          pagination: {
            current: parseInt(page),
            total: 0,
            pages: 0,
          },
        },
      });
    }

    // Get provider's services
    const providerServices = provider.servicesProvided.map((sp) => sp.name);
    if (providerServices.length === 0) {
      return res.json({
        success: true,
        message: "No services configured for this provider.",
        data: {
          bundles: [],
          serviceAreas: provider.serviceAreas.filter((area) => area.isActive),
          pagination: {
            current: parseInt(page),
            total: 0,
            pages: 0,
          },
        },
      });
    }

    console.log("🔍 Provider services:", providerServices);

    // Find bundles that match provider's service areas and services
    const filter = {
      zipCode: { $in: activeServiceZips }, // This should match the bundle's zipCode field
      status: status,
      $expr: { $setIsSubset: ["$services.name", providerServices] },
      "providerOffers.provider": { $ne: req.user._id },
      provider: { $ne: req.user._id }, // Don't show bundles already assigned to this provider
    };

    console.log("🔍 Database filter:", JSON.stringify(filter, null, 2));

    const bundles = await Bundle.find(filter)
      .populate("creator", "firstName lastName profileImage address")
      .populate(
        "participants.customer",
        "firstName lastName profileImage address"
      )
      .populate("provider", "businessNameRegistered businessLogo rating")
      // Soonest service date first; break ties by creation time
      .sort({ serviceDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const categoryTypeNames = [
      ...new Set(
        bundles.map((bundle) => bundle.categoryTypeName).filter(Boolean)
      ),
    ];
    const categoryTypes = await CategoryType.find({
      name: { $in: categoryTypeNames },
    })
      .select("name image")
      .lean();
    const categoryTypeImageMap = new Map(
      categoryTypes.map((type) => [type.name, type.image || null])
    );

    const total = await Bundle.countDocuments(filter);

    console.log(`🔍 Found ${bundles.length} bundles matching the criteria`);

    // Enhance bundles with match score and service area info
    const enhancedBundles = bundles.map((bundle) => {
      const matchingServices = bundle.services.filter((service) =>
        providerServices.includes(service.name)
      );
      const matchScore =
        matchingServices.length > 0
          ? (matchingServices.length / bundle.services.length) * 100
          : 0;

      // Find which service area this bundle belongs to
      const serviceArea = provider.serviceAreas.find(
        (area) => area.zipCode === bundle.zipCode
      );

      // Check if provider already made an offer
      const providerAlreadyOffered = bundle.providerOffers.some(
        (offer) =>
          offer.provider &&
          offer.provider.toString() === req.user._id.toString()
      );

      return {
        ...bundle.toObject(),
        categoryTypeImage:
          categoryTypeImageMap.get(bundle.categoryTypeName) || null,
        matchScore: Math.round(matchScore),
        matchingServices: matchingServices.map((s) => s.name),
        providerAlreadyOffered: providerAlreadyOffered,
        serviceArea: serviceArea || null,
        isInServiceArea: true, // Explicitly mark that this bundle is in provider's service area
      };
    });

    res.json({
      success: true,
      message: `Found ${bundles.length} bundles in your service areas`,
      data: {
        bundles: enhancedBundles,
        providerServiceAreas: provider.serviceAreas.filter(
          (area) => area.isActive
        ),
        providerServices: providerServices,
        activeServiceZips: activeServiceZips,
        searchCriteria: {
          status: status,
          zipCodes: activeServiceZips,
          services: providerServices,
        },
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get nearby bundles error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby bundles",
      error: error.message,
    });
  }
};

// Get providers by ZIP code (for customers to find providers in their area)
exports.getProvidersByZipCode = async (req, res) => {
  try {
    const { zipCode, serviceType, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    if (!zipCode) {
      return res.status(400).json({
        success: false,
        message: "ZIP code is required",
      });
    }

    // Find providers who serve this ZIP code
    const filter = {
      "serviceAreas.zipCode": zipCode,
      "serviceAreas.isActive": true,
      isApproved: true,
      isActive: true,
    };

    // Optional service type filter
    if (serviceType) {
      filter["servicesProvided.name"] = serviceType;
    }

    const providers = await ServiceProvider.find(filter)
      .select("-password")
      .sort({ rating: -1, totalJobsCompleted: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ServiceProvider.countDocuments(filter);

    // Format response
    const formattedProviders = providers.map((provider) => ({
      _id: provider._id,
      businessNameRegistered: provider.businessNameRegistered,
      businessNameDBA: provider.businessNameDBA,
      providerRole: provider.providerRole,
      businessAddress: provider.businessAddress,
      servicesProvided: provider.servicesProvided,
      rating: provider.rating,
      totalReviews: provider.totalReviews,
      totalJobsCompleted: provider.totalJobsCompleted,
      profileImage: provider.profileImage,
      businessLogo: provider.businessLogo,
      description: provider.description,
      serviceAreas: provider.serviceAreas.filter((area) => area.isActive),
    }));

    res.json({
      success: true,
      data: {
        providers: formattedProviders,
        searchZipCode: zipCode,
        serviceType: serviceType || "all",
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get providers by ZIP code error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
      error: error.message,
    });
  }
};



