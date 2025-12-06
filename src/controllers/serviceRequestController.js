const ServiceRequest = require("../models/ServiceRequest");
const ServiceProvider = require("../models/ServiceProvider");
const Customer = require("../models/Customer");
const Service = require("../models/Service");
const Bundle = require("../models/Bundle");
const { calculateServiceCommission } = require("./commissionController");

// Helper function to get default price based on service type
const getDefaultPrice = (serviceType) => {
  const priceMap = {
    "IKEA Assembly": 80,
    "TV Mounting": 60,
    "Furniture Assembly": 70,
    "General Mounting": 50,
    "Truck Assisted Help Moving": 120,
    "Help Moving": 90,
    Cleaning: 65,
    "Door, Cabinet, & Furniture Repair": 85,
    "Heavy Lifting & Loading": 75,
    "Electrical help": 95,
    "Plumbing help": 100,
    Painting: 110,
    Carpentry: 90,
    "Appliance Installation": 85,
    "Home Organization": 60,
    "Home Repairs & Maintenance": 70,
    "Cleaning & Organization": 65,
    "Renovations & Upgrades": 150,
  };

  return priceMap[serviceType] || 75; // Default price
};

// Helper function to get estimated hours
const getEstimatedHours = (serviceType) => {
  const hoursMap = {
    "IKEA Assembly": 2,
    "TV Mounting": 1,
    "Furniture Assembly": 3,
    "General Mounting": 1,
    "Truck Assisted Help Moving": 4,
    "Help Moving": 3,
    Cleaning: 2,
    "Door, Cabinet, & Furniture Repair": 2,
    "Heavy Lifting & Loading": 2,
    "Electrical help": 2,
    "Plumbing help": 2,
    Painting: 4,
    Carpentry: 3,
    "Appliance Installation": 2,
    "Home Organization": 3,
    "Home Repairs & Maintenance": 2,
    "Cleaning & Organization": 3,
    "Renovations & Upgrades": 6,
  };

  return hoursMap[serviceType] || 2; // Default hours
};

// Create a new service request with multiple services support
exports.createServiceRequest = async (req, res) => {
  try {
    const { providerId, serviceType, problem, note, scheduledDate } = req.body;

    console.log("🔍 Debug - Request body:", req.body);

    // Validate required fields
    if (!providerId || !serviceType || !problem || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message:
          "Provider, service type, problem, and date are required fields",
        missingFields: {
          providerId: !providerId,
          serviceType: !serviceType,
          problem: !problem,
          scheduledDate: !scheduledDate,
        },
      });
    }

    // Get provider
    const provider = await ServiceProvider.findById(providerId);

    console.log("🔍 Debug - Provider data:", {
      id: provider?._id,
      businessName: provider?.businessNameRegistered,
      servicesProvided: provider?.servicesProvided,
      servicesCount: provider?.servicesProvided?.length,
      serviceAreas: provider?.serviceAreas,
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Service provider not found",
      });
    }

    if (!provider.isApproved || !provider.isActive) {
      return res.status(400).json({
        success: false,
        message: "This service provider is not available",
      });
    }

    // Get customer data
    const customer = await Customer.findById(req.user._id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    console.log("🔍 Debug - Customer data:", {
      id: customer._id,
      zipCode: customer.address.zipCode,
      address: customer.address,
    });

    // ✅ ZIP CODE VALIDATION: Check if provider serves in customer's area
    const customerZipCode = customer.address.zipCode;
    const providerServesThisArea = provider.serviceAreas.some(
      (area) => area.zipCode === customerZipCode && area.isActive
    );

    console.log("🔍 ZIP Code Validation:", {
      customerZipCode: customerZipCode,
      providerServiceAreas: provider.serviceAreas
        .filter((a) => a.isActive)
        .map((a) => a.zipCode),
      providerServesThisArea: providerServesThisArea,
    });

    if (!providerServesThisArea) {
      return res.status(400).json({
        success: false,
        message: "This provider doesn't provide services in your area",
        details: {
          customerZipCode: customerZipCode,
          providerServiceAreas: provider.serviceAreas
            .filter((area) => area.isActive)
            .map((area) => ({
              zipCode: area.zipCode,
              city: area.city,
              state: area.state,
            })),
          suggestion: "Please search for providers who serve your ZIP code",
        },
      });
    }

    // Handle multiple services (comma-separated) or single service
    let requestedServices = [];
    if (typeof serviceType === "string" && serviceType.includes(",")) {
      requestedServices = serviceType.split(",").map((s) => s.trim());
    } else {
      requestedServices = [serviceType.toString().trim()];
    }

    console.log("🔍 Debug - Requested services:", requestedServices);

    // Check if requested services exist in Service model
    const validServices = await Service.find({
      name: { $in: requestedServices },
      isActive: true,
    });

    console.log(
      "🔍 Debug - Valid services from Service model:",
      validServices.map((s) => s.name)
    );

    // Check which requested services are valid
    const validServiceNames = validServices.map((s) => s.name);
    const invalidServices = requestedServices.filter(
      (service) => !validServiceNames.includes(service)
    );

    console.log("🔍 Debug - Service validation:", {
      validServices: validServiceNames,
      invalidServices,
      requestedServices,
    });

    // If any requested service is not valid, return error
    if (invalidServices.length > 0) {
      // Get all available services from Service model for error message
      const allServices = await Service.find({ isActive: true }).select("name");
      const availableServiceNames = allServices.map((s) => s.name);

      return res.status(400).json({
        success: false,
        message: `Invalid services: ${invalidServices.join(
          ", "
        )}. Please provide valid service names.`,
        debug: {
          requested: requestedServices,
          invalid: invalidServices,
          available: availableServiceNames,
        },
      });
    }

    // Now check if provider offers these services
    const providerServices = provider.servicesProvided || [];

    // Extract service names from provider's servicesProvided array
    const providerServiceNames = providerServices
      .map((service) => {
        // Handle both string and object formats
        if (typeof service === "string") {
          return service.toLowerCase().trim();
        } else if (service && typeof service === "object" && service.name) {
          return service.name.toLowerCase().trim();
        }
        return "";
      })
      .filter((name) => name);

    const providerValidServices = [];
    const providerInvalidServices = [];

    validServiceNames.forEach((serviceName) => {
      const normalizedService = serviceName.toLowerCase().trim();
      const serviceIndex = providerServiceNames.findIndex(
        (service) => service === normalizedService
      );

      if (serviceIndex !== -1) {
        // Get the original service object from provider
        providerValidServices.push(
          validServiceNames[validServiceNames.indexOf(serviceName)]
        );
      } else {
        providerInvalidServices.push(serviceName);
      }
    });

    console.log("🔍 Debug - Provider service validation:", {
      providerValidServices,
      providerInvalidServices,
      providerServiceNames,
    });

    // If provider doesn't offer the service, return error
    if (providerInvalidServices.length > 0) {
      const availableServiceNames = providerServices
        .map((service) => {
          if (typeof service === "string") {
            return service;
          } else if (service && typeof service === "object" && service.name) {
            return service.name;
          }
          return "";
        })
        .filter((name) => name);

      return res.status(400).json({
        success: false,
        message: `This provider does not offer: ${providerInvalidServices.join(
          ", "
        )}. Available services: ${availableServiceNames.join(", ")}`,
        debug: {
          requested: requestedServices,
          notOffered: providerInvalidServices,
          available: availableServiceNames,
        },
      });
    }

    // Use the first valid service as the main service for the request
    const actualServiceName = providerValidServices[0];
    const actualServiceDoc = validServices.find(
      (s) => s.name === actualServiceName
    );

    console.log("🔍 Debug - Using service:", {
      name: actualServiceName,
      id: actualServiceDoc?._id,
    });

    // Validate date
    let formattedDate;
    try {
      formattedDate = new Date(scheduledDate);
      if (isNaN(formattedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format",
        });
      }

      // Check if date is in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (formattedDate < today) {
        return res.status(400).json({
          success: false,
          message: "Scheduled date cannot be in the past",
        });
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    // Prepare requested services array for database
    const requestedServicesData = providerValidServices.map((serviceName) => {
      const serviceDoc = validServices.find((s) => s.name === serviceName);
      return {
        name: serviceName,
        status: "pending",
        price: getDefaultPrice(serviceName),
        estimatedHours: getEstimatedHours(serviceName),
      };
    });

    console.log("🔍 Debug - Requested services data:", requestedServicesData);

    // Calculate total price and hours
    const totalPrice = requestedServicesData.reduce(
      (sum, service) => sum + service.price,
      0
    );
    const totalEstimatedHours = requestedServicesData.reduce(
      (sum, service) => sum + service.estimatedHours,
      0
    );

    // Calculate commission
    const commissionCalculation = await calculateServiceCommission(totalPrice);

    // Create service request with all requested services
    const serviceRequest = new ServiceRequest({
      customer: req.user._id,
      customerName: {
        firstName: customer.firstName,
        lastName: customer.lastName,
      },
      provider: providerId,
      serviceType: actualServiceName, // Main service
      service: actualServiceDoc?._id, // Reference to main Service document
      requestedServices: requestedServicesData, // All requested services
      problem: problem.trim(),
      note: note ? note.trim() : "",
      scheduledDate: formattedDate,
      statusHistory: [
        {
          status: "pending",
          note: "Request created by customer",
        },
      ],
      price: totalPrice, // Total price for all services
      estimatedHours: totalEstimatedHours, // Total hours for all services
      // Commission fields
      commission: {
        rate: commissionCalculation.commissionRate,
        amount: commissionCalculation.commissionAmount,
        providerAmount: commissionCalculation.providerAmount,
      },
      // Add location info for reference
      locationInfo: {
        customerZipCode: customerZipCode,
        customerAddress: customer.address,
      },
    });

    await serviceRequest.save();

    // Populate customer basic info for response
    await serviceRequest.populate("customer", "firstName lastName email");

    // Populate for response
    await serviceRequest.populate(
      "customer",
      "firstName lastName email phone profileImage address"
    );
    await serviceRequest.populate(
      "provider",
      "firstName lastName businessNameRegistered profileImage businessLogo phone rating servicesProvided serviceAreas"
    );
    await serviceRequest.populate("service", "name description categoryType");

    console.log(
      "✅ Service request created successfully with services:",
      providerValidServices
    );

    res.status(201).json({
      success: true,
      message: `Service request created successfully for ${actualServiceName}`,
      data: {
        serviceRequest: {
          _id: serviceRequest._id,
          serviceType: serviceRequest.serviceType,
          service: serviceRequest.service,
          requestedServices: serviceRequest.requestedServices, // Include requested services in response
          problem: serviceRequest.problem,
          note: serviceRequest.note,
          scheduledDate: serviceRequest.scheduledDate,
          status: serviceRequest.status,
          price: serviceRequest.price,
          estimatedHours: serviceRequest.estimatedHours,
          commission: serviceRequest.commission,
          customer: serviceRequest.customer,
          provider: serviceRequest.provider,
          createdAt: serviceRequest.createdAt,
          locationInfo: serviceRequest.locationInfo,
        },
        requestedServices: {
          valid: providerValidServices,
          used: actualServiceName,
        },
        locationValidation: {
          customerZipCode: customerZipCode,
          providerServesArea: true,
          providerServiceAreas: provider.serviceAreas.filter(
            (area) => area.isActive
          ),
        },
        pricing: {
          totalPrice: serviceRequest.price,
          commission: {
            rate: `${commissionCalculation.commissionRate}%`,
            amount: commissionCalculation.commissionAmount,
          },
          providerAmount: commissionCalculation.providerAmount,
        },
      },
    });
  } catch (error) {
    console.error("❌ Create service request error:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create service request",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

// Get service requests for customer
exports.getCustomerRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const filter = { customer: req.user._id };
    if (status) filter.status = status;

    const serviceRequests = await ServiceRequest.find(filter)
      .populate(
        "provider",
        "firstName lastName businessNameRegistered profileImage businessLogo phone rating"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ServiceRequest.countDocuments(filter);

    // Format response for frontend
    const formattedRequests = serviceRequests.map((request) => ({
      _id: request._id,
      serviceType: request.serviceType,
      problem: request.problem,
      note: request.note,
      scheduledDate: request.scheduledDate,
      status: request.status,
      price: request.price,
      estimatedHours: request.estimatedHours,
      commission: request.commission,
      provider: request.provider,
      createdAt: request.createdAt,
      statusHistory: request.statusHistory,
    }));

    res.json({
      success: true,
      data: {
        serviceRequests: formattedRequests,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get customer requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service requests",
      error: error.message,
    });
  }
};

exports.getCustomerAllRequests = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch service requests
    const [requests, requestsTotal] = await Promise.all([
      ServiceRequest.find({ customer: req.user._id })
        .populate(
          "provider",
          "firstName lastName businessNameRegistered profileImage businessLogo phone rating"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceRequest.countDocuments({ customer: req.user._id }),
    ]);

    // Fetch bundles where customer is either creator OR participant
    const Bundle = require("../models/Bundle");
    const [bundles, bundlesTotal] = await Promise.all([
      Bundle.find({
        $or: [
          { creator: req.user._id }, // Customer created the bundle
          { "participants.customer": req.user._id }, // Customer is a participant
        ],
      })
        .populate(
          "participants.customer",
          "firstName lastName profileImage address"
        )
        .populate("provider", "businessNameRegistered businessLogo rating")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments({
        $or: [
          { creator: req.user._id },
          { "participants.customer": req.user._id },
        ],
      }),
    ]);

    res.json({
      success: true,
      data: {
        serviceRequests: {
          items: requests,
          pagination: {
            current: parseInt(page),
            total: requestsTotal,
            pages: Math.ceil(requestsTotal / parseInt(limit)),
          },
        },
        bundles: {
          items: bundles,
          pagination: {
            current: parseInt(page),
            total: bundlesTotal,
            pages: Math.ceil(bundlesTotal / parseInt(limit)),
          },
        },
      },
    });
  } catch (error) {
    console.error("Get customer all requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch data",
      error: error.message,
    });
  }
};
// Get service requests for provider
exports.getProviderRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { provider: req.user._id };
    if (status) filter.status = status;

    const [serviceRequests, requestsTotal] = await Promise.all([
      ServiceRequest.find(filter)
        .populate(
          "customer",
          "firstName lastName email phone profileImage address"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceRequest.countDocuments(filter),
    ]);

    // Bundles assigned to this provider
    const bundleFilter = { provider: req.user._id };
    if (status) bundleFilter.status = status;

    const [bundles, bundlesTotal] = await Promise.all([
      Bundle.find(bundleFilter)
        .populate(
          "creator",
          "firstName lastName email phone profileImage address"
        )
        .populate(
          "participants.customer",
          "firstName lastName email phone profileImage address"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Bundle.countDocuments(bundleFilter),
    ]);

    res.json({
      success: true,
      data: {
        serviceRequests: {
          items: serviceRequests,
          pagination: {
            current: parseInt(page),
            total: requestsTotal,
            pages: Math.ceil(requestsTotal / parseInt(limit)),
          },
        },
        bundles: {
          items: bundles,
          pagination: {
            current: parseInt(page),
            total: bundlesTotal,
            pages: Math.ceil(bundlesTotal / parseInt(limit)),
          },
        },
      },
    });
  } catch (error) {
    console.error("Get provider requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service requests",
      error: error.message,
    });
  }
};

// Enhanced update request status (provider actions - accept/complete/cancel)
exports.updateRequestStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body;

    // Validate required fields
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const serviceRequest = await ServiceRequest.findById(requestId);

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    // Check if provider owns this request
    if (serviceRequest.provider.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this request",
      });
    }

    // Validate current status
    if (serviceRequest.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot update a completed request",
      });
    }

    if (serviceRequest.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cannot update a cancelled request",
      });
    }

    // Enhanced status transition validation
    const validTransitions = {
      pending: ["accepted", "cancelled"],
      accepted: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
    };

    if (!validTransitions[serviceRequest.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${serviceRequest.status} to ${status}`,
      });
    }

    // Store previous status for response
    const previousStatus = serviceRequest.status;

    // Update request - only status is required
    serviceRequest.status = status;

    // Set cancelledBy if status is cancelled
    if (status === "cancelled") {
      serviceRequest.cancelledBy = "provider";
      // Note: cancellationReason is now optional
    }

    await serviceRequest.save();

    // Populate the request for response
    await serviceRequest.populate(
      "customer",
      "firstName lastName email phone profileImage"
    );
    await serviceRequest.populate(
      "provider",
      "firstName lastName businessNameRegistered profileImage businessLogo phone rating"
    );

    // Prepare response message
    let message = `Service request ${status} successfully`;
    if (status === "accepted") {
      message = "Service request accepted successfully";
    } else if (status === "completed") {
      message = "Service marked as completed successfully";
    } else if (status === "cancelled") {
      message = "Service request cancelled successfully";
    }

    res.json({
      success: true,
      message,
      data: {
        serviceRequest: {
          _id: serviceRequest._id,
          serviceType: serviceRequest.serviceType,
          problem: serviceRequest.problem,
          status: serviceRequest.status,
          previousStatus,
          scheduledDate: serviceRequest.scheduledDate,
          commission: serviceRequest.commission,
          customer: serviceRequest.customer,
          provider: serviceRequest.provider,
          updatedAt: serviceRequest.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Update request status error:", error);

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
      message: "Failed to update service request status",
      error: error.message,
    });
  }
};

// Customer cancels request
exports.cancelRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { cancellationReason } = req.body;

    const serviceRequest = await ServiceRequest.findById(requestId);

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    // Check if customer owns this request
    if (serviceRequest.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this request",
      });
    }

    // Only allow cancellation if not completed
    if (serviceRequest.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel a completed request",
      });
    }

    serviceRequest.status = "cancelled";
    serviceRequest.cancelledBy = "customer";
    serviceRequest.cancellationReason = cancellationReason;

    await serviceRequest.save();

    res.json({
      success: true,
      message: "Service request cancelled successfully",
      data: { serviceRequest },
    });
  } catch (error) {
    console.error("Cancel request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel service request",
      error: error.message,
    });
  }
};

// Add review to completed request
exports.addReview = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rating, comment } = req.body;

    const serviceRequest = await ServiceRequest.findById(requestId);

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    // Check if customer owns this request and it's completed
    if (serviceRequest.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to review this request",
      });
    }

    if (serviceRequest.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Can only review completed requests",
      });
    }

    if (serviceRequest.review && serviceRequest.review.rating) {
      return res.status(400).json({
        success: false,
        message: "Review already submitted for this request",
      });
    }

    // Add review
    serviceRequest.review = {
      rating,
      comment,
      createdAt: new Date(),
    };

    await serviceRequest.save();

    // Update provider's rating
    await updateProviderRating(serviceRequest.provider);

    res.json({
      success: true,
      message: "Review submitted successfully",
      data: { serviceRequest },
    });
  } catch (error) {
    console.error("Add review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit review",
      error: error.message,
    });
  }
};

// Get available providers for a service
exports.getProvidersByService = async (req, res) => {
  try {
    const { serviceType, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    if (!serviceType) {
      return res.status(400).json({
        success: false,
        message: "Service type is required",
      });
    }

    // Fixed filter - query the nested name field in servicesProvided array
    const filter = {
      "servicesProvided.name": serviceType,
      isApproved: true,
      isActive: true,
    };

    const providers = await ServiceProvider.find(filter)
      .select("-password")
      .sort({ rating: -1, totalJobsCompleted: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ServiceProvider.countDocuments(filter);

    // Format the response to include only the matching service
    const formattedProviders = providers.map((provider) => {
      const matchingService = provider.servicesProvided.find(
        (service) => service.name === serviceType
      );

      return {
        ...provider.toObject(),
        // Include only the matching service for clarity
        matchingService: matchingService || null,
      };
    });

    res.json({
      success: true,
      data: {
        providers: formattedProviders,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get providers by service error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
      error: error.message,
    });
  }
};

// Advanced provider search with service type and ZIP code matching
exports.getProvidersByServiceAndZip = async (req, res) => {
  try {
    const {
      serviceType,
      zipCode,
      minRating = 0,
      maxHourlyRate,
      sortBy = "rating",
      page = 1,
      limit = 10,
    } = req.query;

    const skip = (page - 1) * limit;

    // Validate required fields
    if (!serviceType || !zipCode) {
      return res.status(400).json({
        success: false,
        message: "Service type and ZIP code are required",
        requiredFields: {
          serviceType: !serviceType,
          zipCode: !zipCode,
        },
      });
    }

    console.log("🔍 Advanced provider search:", {
      serviceType,
      zipCode,
      minRating,
      maxHourlyRate,
      sortBy,
    });

    // Build comprehensive filter
    const filter = {
      "servicesProvided.name": serviceType,
      "serviceAreas.zipCode": zipCode,
      "serviceAreas.isActive": true,
      isApproved: true,
      isActive: true,
    };

    // Add optional filters
    if (minRating > 0) {
      filter.rating = { $gte: parseFloat(minRating) };
    }

    if (maxHourlyRate) {
      filter["servicesProvided.hourlyRate"] = {
        $lte: parseFloat(maxHourlyRate),
      };
    }

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
      case "jobs_completed":
        sortObject = { totalJobsCompleted: -1 };
        break;
      default:
        sortObject = { rating: -1 };
    }

    const [providers, total] = await Promise.all([
      ServiceProvider.find(filter)
        .select("-password -paymentSettings -documents -resetPasswordToken")
        .sort(sortObject)
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceProvider.countDocuments(filter),
    ]);

    // Format response with detailed matching information
    const formattedProviders = providers.map((provider) => {
      const matchingService = provider.servicesProvided.find(
        (service) => service.name === serviceType
      );

      const serviceArea = provider.serviceAreas.find(
        (area) => area.zipCode === zipCode && area.isActive
      );

      // Calculate match score based on multiple factors
      const matchScore = calculateProviderMatchScore(
        provider,
        serviceType,
        zipCode
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
          experience: provider.experience,
          description: provider.description,
          phone: provider.phone,
          email: provider.email,
          businessAddress: provider.businessAddress,
          serviceAreas: provider.serviceAreas.filter((area) => area.isActive),
        },
        service: {
          name: matchingService?.name || serviceType,
          hourlyRate: matchingService?.hourlyRate || 0,
          providerServiceId: matchingService?._id,
        },
        serviceArea: serviceArea || null,
        matchDetails: {
          zipCodeMatch: true,
          serviceMatch: !!matchingService,
          matchScore: matchScore,
          availability: provider.isAvailable !== false,
          responseTime: "Within 24 hours", // You can calculate this based on historical data
        },
        bookingInfo: {
          canBookDirectly: true,
          requiresApproval: false,
          estimatedResponseTime: "1-2 hours",
        },
      };
    });

    console.log(`✅ Found ${formattedProviders.length} matching providers`);

    res.json({
      success: true,
      message: `Found ${formattedProviders.length} providers for "${serviceType}" in ${zipCode}`,
      data: {
        searchCriteria: {
          serviceType,
          zipCode,
          minRating,
          maxHourlyRate,
          sortBy,
        },
        providers: formattedProviders,
        filtersApplied: {
          serviceType,
          zipCode,
          minRating: minRating || "any",
          maxHourlyRate: maxHourlyRate || "any",
          sortBy,
        },
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
          hasMore: total > skip + parseInt(limit),
        },
        summary: {
          totalMatches: total,
          availableNow: formattedProviders.length,
          averageRating:
            providers.length > 0
              ? (
                  providers.reduce((sum, p) => sum + (p.rating || 0), 0) /
                  providers.length
                ).toFixed(1)
              : 0,
          priceRange:
            providers.length > 0
              ? {
                  min: Math.min(
                    ...providers.flatMap((p) =>
                      p.servicesProvided
                        .filter((s) => s.name === serviceType)
                        .map((s) => s.hourlyRate)
                    )
                  ),
                  max: Math.max(
                    ...providers.flatMap((p) =>
                      p.servicesProvided
                        .filter((s) => s.name === serviceType)
                        .map((s) => s.hourlyRate)
                    )
                  ),
                  average: (
                    providers
                      .flatMap((p) =>
                        p.servicesProvided
                          .filter((s) => s.name === serviceType)
                          .map((s) => s.hourlyRate)
                      )
                      .reduce((sum, rate) => sum + rate, 0) / providers.length
                  ).toFixed(2),
                }
              : null,
        },
      },
    });
  } catch (error) {
    console.error("Search providers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search providers",
      error: error.message,
    });
  }
};

// Helper function to calculate provider match score
const calculateProviderMatchScore = (provider, serviceType, zipCode) => {
  let score = 0;

  // Base score for having the service
  const hasService = provider.servicesProvided.some(
    (s) => s.name === serviceType
  );
  if (hasService) score += 40;

  // Score for rating
  if (provider.rating >= 4.5) score += 30;
  else if (provider.rating >= 4.0) score += 20;
  else if (provider.rating >= 3.0) score += 10;

  // Score for experience
  if (provider.experience >= 5) score += 15;
  else if (provider.experience >= 2) score += 10;
  else if (provider.experience >= 1) score += 5;

  // Score for completed jobs
  if (provider.totalJobsCompleted >= 50) score += 15;
  else if (provider.totalJobsCompleted >= 20) score += 10;
  else if (provider.totalJobsCompleted >= 5) score += 5;

  return Math.min(score, 100);
};

// Nearby services by customer's ZIP code - MATCHING SERVICE AREAS
exports.getNearbyServicesByZip = async (req, res) => {
  try {
    const { page = 1, limit = 20, q } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log("🔍 Fetching nearby services for customer ZIP code");

    // Load the customer to get zip code
    const customer = await Customer.findById(req.user._id).select(
      "address.zipCode"
    );
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }
    const customerZipCode = customer.address.zipCode;

    console.log("🔍 Customer ZIP code:", customerZipCode);

    // Find providers who serve customer's ZIP code in their service areas
    const providerFilter = {
      isApproved: true,
      isActive: true,
      "serviceAreas.zipCode": customerZipCode,
      "serviceAreas.isActive": true,
    };

    console.log("🔍 Provider filter:", providerFilter);

    // Optional search on service name
    const nameRegex = q ? new RegExp(q, "i") : null;

    // Project each provider's servicesProvided array into separate rows and keep providerId
    const pipeline = [
      { $match: providerFilter },
      {
        $project: {
          businessNameRegistered: 1,
          rating: 1,
          totalReviews: 1,
          businessAddress: 1,
          servicesProvided: 1,
          serviceAreas: {
            $filter: {
              input: "$serviceAreas",
              as: "area",
              cond: {
                $and: [
                  { $eq: ["$$area.zipCode", customerZipCode] },
                  { $eq: ["$$area.isActive", true] },
                ],
              },
            },
          },
        },
      },
      { $unwind: "$servicesProvided" },
      ...(nameRegex
        ? [{ $match: { "servicesProvided.name": { $regex: nameRegex } } }]
        : []),
      {
        $project: {
          providerId: "$_id",
          service: "$servicesProvided",
          businessNameRegistered: 1,
          rating: 1,
          totalReviews: 1,
          businessAddress: 1,
          serviceAreas: 1,
        },
      },
      { $sort: { rating: -1, totalReviews: -1, "service.name": 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ];

    const [items, totalAgg] = await Promise.all([
      ServiceProvider.aggregate(pipeline),
      ServiceProvider.aggregate([
        { $match: providerFilter },
        { $unwind: "$servicesProvided" },
        ...(nameRegex
          ? [{ $match: { "servicesProvided.name": { $regex: nameRegex } } }]
          : []),
        { $count: "count" },
      ]),
    ]);

    const total = totalAgg.length ? totalAgg[0].count : 0;

    console.log(
      `🔍 Found ${items.length} services from providers serving ZIP ${customerZipCode}`
    );

    // Map to required shape: ONLY 3 DATA FIELDS
    const services = items.map((doc) => ({
      serviceName: doc.service?.name,
      hourlyRate: doc.service?.hourlyRate ?? null,
      providerId: doc.providerId,
    }));

    res.json({
      success: true,
      data: {
        zipCode: customerZipCode,
        services,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get nearby services by zip error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby services",
      error: error.message,
    });
  }
};

// Get provider's requests with status filter
exports.getProviderRequestsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Validate status
    const validStatuses = ["pending", "accepted", "completed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status. Use: pending, accepted, completed, or cancelled",
      });
    }

    const filter = { provider: req.user._id };
    if (status) filter.status = status;

    const serviceRequests = await ServiceRequest.find(filter)
      .populate(
        "customer",
        "firstName lastName email phone profileImage address"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ServiceRequest.countDocuments(filter);

    res.json({
      success: true,
      data: {
        serviceRequests,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
        status: status || "all",
      },
    });
  } catch (error) {
    console.error("Get provider requests by status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service requests",
      error: error.message,
    });
  }
};

// Get provider dashboard stats
exports.getProviderDashboardStats = async (req, res) => {
  try {
    const providerId = req.user._id;

    const stats = await ServiceRequest.aggregate([
      { $match: { provider: providerId } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Format stats
    const statusCounts = {
      pending: 0,
      accepted: 0,
      completed: 0,
      cancelled: 0,
      total: 0,
    };

    stats.forEach((stat) => {
      statusCounts[stat._id] = stat.count;
      statusCounts.total += stat.count;
    });

    // Get today's requests
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaysRequests = await ServiceRequest.countDocuments({
      provider: providerId,
      scheduledDate: { $gte: today },
    });

    // Get recent pending requests
    const recentPendingRequests = await ServiceRequest.find({
      provider: providerId,
      status: "pending",
    })
      .populate("customer", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        statusCounts,
        todaysRequests,
        recentPendingRequests,
        provider: {
          id: req.user._id,
          name: `${req.user.firstName} ${req.user.lastName}`,
          businessName: req.user.businessNameRegistered,
        },
      },
    });
  } catch (error) {
    console.error("Get provider dashboard stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard stats",
      error: error.message,
    });
  }
};

// Test endpoint to check provider services
exports.testProviderServices = async (req, res) => {
  try {
    const { providerId } = req.params;

    const provider = await ServiceProvider.findById(providerId).select(
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
          servicesProvided: provider.servicesProvided,
        },
      },
    });
  } catch (error) {
    console.error("Test provider services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider services",
      error: error.message,
    });
  }
};

// Helper function to update provider rating (includes service requests + bundle reviews)
const updateProviderRating = async (providerId) => {
  try {
    const serviceReviews = await ServiceRequest.find({
      provider: providerId,
      "review.rating": { $exists: true },
    }).select("review");

    const bundleReviews = await Bundle.find({
      provider: providerId,
      "reviews.rating": { $exists: true },
    }).select("reviews");

    const serviceRatings = serviceReviews
      .filter((r) => r.review?.rating)
      .map((r) => r.review.rating);
    const bundleRatings = [];
    bundleReviews.forEach((b) => {
      (b.reviews || []).forEach((rev) => {
        if (rev.rating) bundleRatings.push(rev.rating);
      });
    });

    const allRatings = [...serviceRatings, ...bundleRatings];
    if (allRatings.length === 0) {
      return;
    }

    const totalRating = allRatings.reduce((sum, r) => sum + r, 0);
    const averageRating = totalRating / allRatings.length;

    await ServiceProvider.findByIdAndUpdate(providerId, {
      rating: Math.round(averageRating * 10) / 10,
      totalReviews: allRatings.length,
    });
  } catch (error) {
    console.error("Update provider rating error:", error);
  }
};

exports.updateProviderRating = updateProviderRating;
