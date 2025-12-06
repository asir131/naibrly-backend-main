const ServiceProvider = require("../models/ServiceProvider");
const Service = require("../models/Service");

// Search providers by service name and ZIP code (using req.body)
exports.searchProvidersByServiceAndZip = async (req, res) => {
  try {
    const { serviceName, zipCode, page = 1, limit = 10 } = req.body;

    // Validation
    if (!serviceName || !zipCode) {
      return res.status(400).json({
        success: false,
        message: "Service name and ZIP code are required in request body",
        requiredFields: {
          serviceName: !serviceName,
          zipCode: !zipCode,
        },
      });
    }

    console.log("🔍 Search request (Body):", { serviceName, zipCode });

    // Step 1: Validate the service exists in the system
    const validService = await Service.findOne({
      name: { $regex: new RegExp(serviceName, "i") },
      isActive: true,
    });

    if (!validService) {
      return res.status(404).json({
        success: false,
        message: `Service "${serviceName}" not found in our system`,
        suggestions: await getServiceSuggestions(serviceName),
      });
    }

    // Step 2: Find providers who offer this service and serve the ZIP code
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const searchFilter = {
      "servicesProvided.name": {
        $regex: new RegExp(validService.name, "i"),
      },
      "serviceAreas.zipCode": zipCode,
      "serviceAreas.isActive": true,
      isApproved: true,
      isActive: true,
    };

    console.log("🔍 Search filter:", searchFilter);

    const [providers, total] = await Promise.all([
      ServiceProvider.find(searchFilter)
        .select("-password -paymentSettings -documents -resetPasswordToken")
        .populate({
          path: "servicesProvided",
          match: {
            name: { $regex: new RegExp(validService.name, "i") },
          },
        })
        .sort({
          rating: -1,
          totalReviews: -1,
          totalJobsCompleted: -1,
        })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceProvider.countDocuments(searchFilter),
    ]);

    console.log(
      `🔍 Found ${providers.length} providers for service "${validService.name}" in ZIP ${zipCode}`
    );

    // Step 3: Format response with service-specific details
    const formattedProviders = providers.map((provider) => {
      // Find the specific service details from provider's services
      const providerService = provider.servicesProvided.find((service) =>
        service.name.toLowerCase().includes(validService.name.toLowerCase())
      );

      // Get service area details for this ZIP code
      const serviceArea = provider.serviceAreas.find(
        (area) => area.zipCode === zipCode && area.isActive
      );

      return {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          businessLogo: provider.businessLogo,
          profileImage: provider.profileImage,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          totalJobsCompleted: provider.totalJobsCompleted,
          description: provider.description,
          experience: provider.experience,
          phone: provider.phone,
          email: provider.email,
          businessAddress: provider.businessAddress,
          serviceArea: serviceArea || null,
        },
        service: {
          name: providerService?.name || validService.name,
          hourlyRate: providerService?.hourlyRate || 0,
          providerServiceId: providerService?._id,
        },
        matchDetails: {
          zipCodeMatch: true,
          serviceMatch: !!providerService,
          distance: "Within service area",
        },
      };
    });

    // Step 4: Get related services for suggestions
    const relatedServices = await getRelatedServices(validService.name);

    res.json({
      success: true,
      message: `Found ${formattedProviders.length} providers for "${validService.name}" in ${zipCode}`,
      data: {
        searchCriteria: {
          serviceName: validService.name,
          zipCode: zipCode,
          originalQuery: serviceName,
        },
        providers: formattedProviders,
        relatedServices,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: total > skip + parseInt(limit),
        },
        stats: {
          totalProviders: total,
          providersInArea: formattedProviders.length,
          serviceAvailable: formattedProviders.length > 0,
        },
      },
    });
  } catch (error) {
    console.error("❌ Search providers error:", error);
    res.status(500).json({
      success: false,
      message: "Search failed",
      error: error.message,
    });
  }
};

// Get popular services in a ZIP code (using req.body)
exports.getPopularServicesByZip = async (req, res) => {
  try {
    const { zipCode, limit = 10 } = req.body;

    if (!zipCode) {
      return res.status(400).json({
        success: false,
        message: "ZIP code is required in request body",
      });
    }

    // Find popular services based on providers in this area
    const popularServices = await ServiceProvider.aggregate([
      {
        $match: {
          "serviceAreas.zipCode": zipCode,
          "serviceAreas.isActive": true,
          isApproved: true,
          isActive: true,
        },
      },
      { $unwind: "$servicesProvided" },
      {
        $group: {
          _id: "$servicesProvided.name",
          providerCount: { $sum: 1 },
          averageRate: { $avg: "$servicesProvided.hourlyRate" },
          totalProviders: { $sum: 1 },
        },
      },
      { $sort: { providerCount: -1 } },
      { $limit: parseInt(limit) },
    ]);

    // Get service details
    const serviceNames = popularServices.map((service) => service._id);
    const serviceDetails = await Service.find({
      name: { $in: serviceNames },
      isActive: true,
    });

    const formattedServices = popularServices.map((service) => {
      const serviceDetail = serviceDetails.find(
        (s) => s.name.toLowerCase() === service._id.toLowerCase()
      );

      return {
        name: service._id,
        providerCount: service.providerCount,
        averageHourlyRate: Math.round(service.averageRate * 100) / 100,
        description: serviceDetail?.description || `${service._id} service`,
        category: serviceDetail?.categoryType
          ? serviceDetail.categoryType.toString()
          : null,
      };
    });

    res.json({
      success: true,
      data: {
        zipCode,
        popularServices: formattedServices,
        totalServices: formattedServices.length,
      },
    });
  } catch (error) {
    console.error("Get popular services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get popular services",
      error: error.message,
    });
  }
};

// Auto-suggest services based on partial name (using req.body)
exports.autoSuggestServices = async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: { suggestions: [] },
      });
    }

    const suggestions = await Service.find({
      name: { $regex: new RegExp(query, "i") },
      isActive: true,
    })
      .select("name description categoryType")
      .populate("categoryType", "name category")
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        query,
        suggestions: suggestions.map((service) => ({
          name: service.name,
          description: service.description,
          category: service.categoryType?.name,
          fullCategory: service.categoryType?.category,
        })),
      },
    });
  } catch (error) {
    console.error("Auto-suggest services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get service suggestions",
      error: error.message,
    });
  }
};

// Check service availability in ZIP code (using req.body)
exports.checkServiceAvailability = async (req, res) => {
  try {
    const { serviceName, zipCode } = req.body;

    if (!serviceName || !zipCode) {
      return res.status(400).json({
        success: false,
        message: "Service name and ZIP code are required in request body",
      });
    }

    const providerCount = await ServiceProvider.countDocuments({
      "servicesProvided.name": { $regex: new RegExp(serviceName, "i") },
      "serviceAreas.zipCode": zipCode,
      "serviceAreas.isActive": true,
      isApproved: true,
      isActive: true,
    });

    const serviceExists = await Service.findOne({
      name: { $regex: new RegExp(serviceName, "i") },
      isActive: true,
    });

    res.json({
      success: true,
      data: {
        serviceName,
        zipCode,
        available: providerCount > 0,
        providerCount,
        serviceExists: !!serviceExists,
        message:
          providerCount > 0
            ? `Service is available with ${providerCount} provider(s)`
            : "No providers found for this service in your area",
      },
    });
  } catch (error) {
    console.error("Check service availability error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check service availability",
      error: error.message,
    });
  }
};

// Advanced search with multiple filters (using req.body)
exports.advancedSearch = async (req, res) => {
  try {
    const {
      serviceName,
      zipCode,
      minRating = 0,
      maxHourlyRate,
      sortBy = "rating",
      page = 1,
      limit = 10,
    } = req.body;

    // Validation
    if (!serviceName || !zipCode) {
      return res.status(400).json({
        success: false,
        message: "Service name and ZIP code are required in request body",
      });
    }

    console.log("🔍 Advanced search request:", req.body);

    // Build search filter
    const searchFilter = {
      "servicesProvided.name": { $regex: new RegExp(serviceName, "i") },
      "serviceAreas.zipCode": zipCode,
      "serviceAreas.isActive": true,
      isApproved: true,
      isActive: true,
    };

    // Add rating filter
    if (minRating > 0) {
      searchFilter.rating = { $gte: parseFloat(minRating) };
    }

    // Add hourly rate filter
    if (maxHourlyRate) {
      searchFilter["servicesProvided.hourlyRate"] = {
        $lte: parseFloat(maxHourlyRate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    let sortObject = {};
    switch (sortBy) {
      case "rating":
        sortObject = { rating: -1, totalReviews: -1 };
        break;
      case "experience":
        sortObject = { experience: -1 };
        break;
      case "price_low":
        sortObject = { "servicesProvided.hourlyRate": 1 };
        break;
      case "price_high":
        sortObject = { "servicesProvided.hourlyRate": -1 };
        break;
      default:
        sortObject = { rating: -1 };
    }

    const [providers, total] = await Promise.all([
      ServiceProvider.find(searchFilter)
        .select("-password -paymentSettings -documents -resetPasswordToken")
        .sort(sortObject)
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceProvider.countDocuments(searchFilter),
    ]);

    // Format response
    const formattedProviders = providers.map((provider) => {
      const providerService = provider.servicesProvided.find((service) =>
        service.name.toLowerCase().includes(serviceName.toLowerCase())
      );

      return {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          businessLogo: provider.businessLogo,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          experience: provider.experience,
          description: provider.description,
        },
        service: {
          name: providerService?.name || serviceName,
          hourlyRate: providerService?.hourlyRate || 0,
        },
        filtersApplied: {
          minRating,
          maxHourlyRate: maxHourlyRate || "none",
          sortBy,
        },
      };
    });

    res.json({
      success: true,
      data: {
        searchCriteria: req.body,
        providers: formattedProviders,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: total > skip + parseInt(limit),
        },
        filters: {
          minRating,
          maxHourlyRate,
          sortBy,
        },
      },
    });
  } catch (error) {
    console.error("Advanced search error:", error);
    res.status(500).json({
      success: false,
      message: "Advanced search failed",
      error: error.message,
    });
  }
};

// Helper function to get service suggestions for similar services
async function getServiceSuggestions(serviceName) {
  try {
    const suggestions = await Service.find({
      name: { $regex: new RegExp(serviceName.substring(0, 3), "i") },
      isActive: true,
    })
      .select("name")
      .limit(5);

    return suggestions.map((s) => s.name);
  } catch (error) {
    console.error("Error getting service suggestions:", error);
    return [];
  }
}

// Helper function to get related services
async function getRelatedServices(serviceName) {
  try {
    // Find services in the same category
    const service = await Service.findOne({
      name: { $regex: new RegExp(serviceName, "i") },
      isActive: true,
    }).populate("categoryType");

    if (!service || !service.categoryType) {
      return [];
    }

    const relatedServices = await Service.find({
      categoryType: service.categoryType._id,
      name: { $ne: service.name },
      isActive: true,
    })
      .select("name description")
      .limit(5);

    return relatedServices;
  } catch (error) {
    console.error("Error getting related services:", error);
    return [];
  }
}
