const ServiceProvider = require("../models/ServiceProvider");
const ProviderServiceFeedback = require("../models/ProviderServiceFeedback");
const Customer = require("../models/Customer");
const mongoose = require("mongoose");
const ServiceRequest = require("../models/ServiceRequest");
const Bundle = require("../models/Bundle");
const PayoutInformation = require("../models/PayoutInformation");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const MoneyRequest = require("../models/MoneyRequest");
// Update provider's bundle capacity
exports.updateProviderCapacity = async (req, res) => {
  try {
    const { maxBundleCapacity } = req.body;

    if (maxBundleCapacity === undefined) {
      return res.status(400).json({
        success: false,
        message: "Max bundle capacity is required",
      });
    }

    if (maxBundleCapacity < 1 || maxBundleCapacity > 10) {
      return res.status(400).json({
        success: false,
        message: "Bundle capacity must be between 1 and 10 people",
      });
    }

    // Update provider's own capacity
    const provider = await ServiceProvider.findByIdAndUpdate(
      req.user._id,
      { maxBundleCapacity },
      { new: true, runValidators: true }
    ).select("-password");

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    res.json({
      success: true,
      message: `Your bundle capacity updated to ${maxBundleCapacity} people successfully`,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          maxBundleCapacity: provider.maxBundleCapacity,
        },
      },
    });
  } catch (error) {
    console.error("Update provider capacity error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update bundle capacity",
      error: error.message,
    });
  }
};

// Get provider's bundle capacity
exports.getProviderCapacity = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id).select(
      "maxBundleCapacity businessNameRegistered servicesProvided"
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
          maxBundleCapacity: provider.maxBundleCapacity,
          servicesProvided: provider.servicesProvided,
        },
      },
    });
  } catch (error) {
    console.error("Get provider capacity error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bundle capacity",
      error: error.message,
    });
  }
};

// List services for a provider (by providerId or authenticated provider)
exports.getProviderServices = async (req, res) => {
  try {
    const providerId = req.params.providerId || req.user?._id;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        message: "Provider id is required",
      });
    }

    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered servicesProvided rating totalReviews"
    );

    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        services: provider.servicesProvided,
      },
    });
  } catch (error) {
    console.error("Get provider services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch services",
      error: error.message,
    });
  }
};

// Get authenticated provider's own services
exports.getMyServices = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id).select(
      "businessNameRegistered servicesProvided rating totalReviews"
    );

    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        services: provider.servicesProvided,
      },
    });
  } catch (error) {
    console.error("Get my services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch services",
      error: error.message,
    });
  }
};

// controllers/providerController.js

// Public: get all reviews for a provider from completed service requests
exports.getProviderReviews = async (req, res) => {
  try {
    const { providerId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!providerId || !mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: "Valid providerId is required",
      });
    }

    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered businessLogo profileImage rating totalReviews"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviewQuery = {
      provider: providerId,
      status: "completed",
      "review.rating": { $exists: true },
    };

    const [reviews, totalReviews, ratingStats] = await Promise.all([
      ServiceRequest.find(reviewQuery)
        .select("review customer serviceType scheduledDate")
        .populate("customer", "firstName lastName profileImage")
        .sort({ "review.createdAt": -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceRequest.countDocuments(reviewQuery),
      ServiceRequest.aggregate([
        {
          $match: {
            provider: new mongoose.Types.ObjectId(providerId),
            status: "completed",
            "review.rating": { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$review.rating" },
            ratings: { $push: "$review.rating" },
          },
        },
      ]),
    ]);

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    if (ratingStats.length > 0 && Array.isArray(ratingStats[0].ratings)) {
      ratingStats[0].ratings.forEach((rating) => {
        const rounded = Math.round(rating);
        if (ratingDistribution[rounded] !== undefined) {
          ratingDistribution[rounded]++;
        }
      });
    }

    const averageRating =
      ratingStats.length > 0 && ratingStats[0].averageRating
        ? Number(ratingStats[0].averageRating.toFixed(2))
        : 0;

    const formattedReviews = reviews.map((review) => ({
      id: review._id,
      rating: review.review.rating,
      comment: review.review.comment,
      createdAt: review.review.createdAt,
      serviceName: review.serviceType,
      serviceDate: review.scheduledDate,
      customer: {
        id: review.customer?._id,
        firstName: review.customer?.firstName,
        lastName: review.customer?.lastName,
        profileImage: review.customer?.profileImage,
      },
    }));

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          businessLogo: provider.businessLogo,
          profileImage: provider.profileImage,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        reviews: {
          statistics: {
            averageRating,
            totalReviews,
            ratingDistribution,
          },
          list: formattedReviews,
          pagination: {
            current: parseInt(page),
            total: totalReviews,
            pages: Math.ceil(totalReviews / parseInt(limit)),
            limit: parseInt(limit),
          },
        },
      },
    });
  } catch (error) {
    console.error("Get provider reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider reviews",
      error: error.message,
    });
  }
};

// Authenticated provider: get all of their reviews from completed service requests
exports.getMyReviews = async (req, res) => {
  try {
    const providerId = req.user?._id;
    const { page = 1, limit = 10 } = req.query;

    if (!providerId || !mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: "Valid providerId is required",
      });
    }

    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered businessLogo profileImage rating totalReviews"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviewQuery = {
      provider: providerId,
      status: "completed",
      "review.rating": { $exists: true },
    };

    const [reviews, totalReviews, ratingStats] = await Promise.all([
      ServiceRequest.find(reviewQuery)
        .select("review customer serviceType scheduledDate")
        .populate("customer", "firstName lastName profileImage")
        .sort({ "review.createdAt": -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceRequest.countDocuments(reviewQuery),
      ServiceRequest.aggregate([
        {
          $match: {
            provider: new mongoose.Types.ObjectId(providerId),
            status: "completed",
            "review.rating": { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$review.rating" },
            ratings: { $push: "$review.rating" },
          },
        },
      ]),
    ]);

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    if (ratingStats.length > 0 && Array.isArray(ratingStats[0].ratings)) {
      ratingStats[0].ratings.forEach((rating) => {
        const rounded = Math.round(rating);
        if (ratingDistribution[rounded] !== undefined) {
          ratingDistribution[rounded]++;
        }
      });
    }

    const averageRating =
      ratingStats.length > 0 && ratingStats[0].averageRating
        ? Number(ratingStats[0].averageRating.toFixed(2))
        : 0;

    const formattedReviews = reviews.map((review) => ({
      id: review._id,
      rating: review.review.rating,
      comment: review.review.comment,
      createdAt: review.review.createdAt,
      serviceName: review.serviceType,
      serviceDate: review.scheduledDate,
      customer: {
        id: review.customer?._id,
        firstName: review.customer?.firstName,
        lastName: review.customer?.lastName,
        profileImage: review.customer?.profileImage,
      },
    }));

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          businessLogo: provider.businessLogo,
          profileImage: provider.profileImage,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        reviews: {
          statistics: {
            averageRating,
            totalReviews,
            ratingDistribution,
          },
          list: formattedReviews,
          pagination: {
            current: parseInt(page),
            total: totalReviews,
            pages: Math.ceil(totalReviews / parseInt(limit)),
            limit: parseInt(limit),
          },
        },
      },
    });
  } catch (error) {
    console.error("Get provider reviews (self) error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider reviews",
      error: error.message,
    });
  }
};

// Authenticated provider: combined reviews from service requests and bundles
exports.getMyAllReviews = async (req, res) => {
  try {
    const providerId = req.user?._id;
    const { page = 1, limit = 10, type = "all" } = req.query;

    if (!providerId || !mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: "Valid providerId is required",
      });
    }

    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered businessLogo profileImage rating totalReviews"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Service reviews (completed requests with review)
    const serviceMatch = {
      provider: providerId,
      status: "completed",
      "review.rating": { $exists: true },
    };

    const serviceReviews =
      type === "bundle"
        ? []
        : await ServiceRequest.find(serviceMatch)
            .select("review customer serviceType scheduledDate")
            .populate("customer", "firstName lastName profileImage")
            .sort({ "review.createdAt": -1 });

    // Bundle reviews (provider assigned bundles with reviews)
    const bundleMatch = {
      provider: providerId,
      "reviews.rating": { $exists: true },
    };

    const bundleDocs =
      type === "service"
        ? []
        : await Bundle.find(bundleMatch)
            .select("title reviews creator")
            .populate("creator", "firstName lastName profileImage")
            .sort({ "reviews.createdAt": -1 });

    // Flatten bundle reviews
    const bundleReviews = [];
    for (const bundle of bundleDocs) {
      (bundle.reviews || []).forEach((review) => {
        bundleReviews.push({
          _id: review._id,
          type: "bundle",
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
          bundleId: bundle._id,
          bundleTitle: bundle.title,
          customer: review.customer || bundle.creator || null,
        });
      });
    }

    // Normalize service reviews
    const normalizedServiceReviews = serviceReviews.map((review) => ({
      _id: review._id,
      type: "service",
      rating: review.review.rating,
      comment: review.review.comment,
      createdAt: review.review.createdAt,
      serviceName: review.serviceType,
      serviceDate: review.scheduledDate,
      requestId: review._id,
      customer: review.customer || null,
    }));

    // Combine and paginate
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const paginate = (arr) => {
      const sorted = [...arr].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      const start = (pageNum - 1) * limitNum;
      return {
        list: sorted.slice(start, start + limitNum),
        total: sorted.length,
        pages: Math.ceil(sorted.length / limitNum) || 1,
      };
    };

    const servicePage = type === "bundle" ? { list: [], total: 0, pages: 1 } : paginate(normalizedServiceReviews);
    const bundlePage = type === "service" ? { list: [], total: 0, pages: 1 } : paginate(bundleReviews);

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          businessLogo: provider.businessLogo,
          profileImage: provider.profileImage,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        counts: {
          total: servicePage.total + bundlePage.total,
          service: servicePage.total,
          bundle: bundlePage.total,
        },
        reviews: {
          service: servicePage.list,
          bundle: bundlePage.list,
        },
        pagination: {
          current: pageNum,
          limit: limitNum,
          service: {
            pages: servicePage.pages,
            total: servicePage.total,
          },
          bundle: {
            pages: bundlePage.pages,
            total: bundlePage.total,
          },
        },
      },
    });
  } catch (error) {
    console.error("Get provider all reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
      error: error.message,
    });
  }
};

// Provider: get review for a single service request (must belong to provider)
exports.getServiceReviewById = async (req, res) => {
  try {
    const { requestId } = req.params;
    const providerId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({
        success: false,
        message: "Valid requestId is required",
      });
    }

    const serviceRequest = await ServiceRequest.findById(requestId)
      .select("serviceType scheduledDate status review provider")
      .populate("customer", "firstName lastName profileImage");

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: "Service request not found",
      });
    }

    if (!serviceRequest.provider || serviceRequest.provider.toString() !== providerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this review",
      });
    }

    if (!serviceRequest.review || !serviceRequest.review.rating) {
      return res.status(404).json({
        success: false,
        message: "No review submitted for this service request",
      });
    }

    res.json({
      success: true,
      data: {
        requestId: serviceRequest._id,
        serviceName: serviceRequest.serviceType,
        status: serviceRequest.status,
        review: serviceRequest.review,
        customer: serviceRequest.customer || null,
      },
    });
  } catch (error) {
    console.error("Get service review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service review",
      error: error.message,
    });
  }
};

// Provider: get reviews for a single bundle (must belong to provider)
exports.getBundleReviewsById = async (req, res) => {
  try {
    const { bundleId } = req.params;
    const providerId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(bundleId)) {
      return res.status(400).json({
        success: false,
        message: "Valid bundleId is required",
      });
    }

    const bundle = await Bundle.findById(bundleId)
      .select("title status reviews provider")
      .populate("reviews.customer", "firstName lastName profileImage");

    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: "Bundle not found",
      });
    }

    if (!bundle.provider || bundle.provider.toString() !== providerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view reviews for this bundle",
      });
    }

    res.json({
      success: true,
      data: {
        bundleId: bundle._id,
        title: bundle.title,
        status: bundle.status,
        reviews: bundle.reviews || [],
      },
    });
  } catch (error) {
    console.error("Get bundle reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bundle reviews",
      error: error.message,
    });
  }
};

exports.getProviderServiceDetailsWithReviews = async (req, res) => {
  try {
    const { providerId, serviceName } = req.body;
    const { page = 1, limit = 10 } = req.query;

    // Validate input
    if (!providerId || !serviceName) {
      return res.status(400).json({
        success: false,
        message:
          "Provider ID and service name are required in the request body",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get provider details
    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered profileImage businessLogo servicesProvided description experience rating totalReviews totalJobsCompleted isVerified"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find the selected service
    const selectedService = provider.servicesProvided.find(
      (service) => service.name === serviceName
    );

    if (!selectedService) {
      return res.status(404).json({
        success: false,
        message: "Service not found for this provider",
      });
    }

    // Get other services (excluding the selected one)
    const otherServices = provider.servicesProvided.filter(
      (service) => service.name !== serviceName
    );

    // Get all reviews for this provider from ServiceRequest
    const reviewsQuery = {
      provider: providerId,
      status: "completed",
      "review.rating": { $exists: true },
    };

    const [reviews, totalReviews, ratingStats] = await Promise.all([
      // Get paginated reviews
      ServiceRequest.find(reviewsQuery)
        .select("review customer serviceType scheduledDate")
        .populate("customer", "firstName lastName profileImage")
        .sort({ "review.createdAt": -1 })
        .skip(skip)
        .limit(parseInt(limit)),

      // Get total reviews count
      ServiceRequest.countDocuments(reviewsQuery),

      // Get rating statistics
      ServiceRequest.aggregate([
        {
          $match: {
            provider: new mongoose.Types.ObjectId(providerId),
            status: "completed",
            "review.rating": { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$review.rating" },
            totalRatings: { $sum: 1 },
            ratingDistribution: {
              $push: "$review.rating",
            },
          },
        },
      ]),
    ]);

    // Calculate rating distribution
    let ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    if (ratingStats.length > 0 && ratingStats[0].ratingDistribution) {
      ratingStats[0].ratingDistribution.forEach((rating) => {
        const roundedRating = Math.round(rating);
        if (ratingDistribution[roundedRating] !== undefined) {
          ratingDistribution[roundedRating]++;
        }
      });
    }

    const averageRating =
      ratingStats.length > 0
        ? Number(ratingStats[0].averageRating.toFixed(2))
        : 0;

    // Format reviews response
    const formattedReviews = reviews.map((review) => ({
      id: review._id,
      rating: review.review.rating,
      comment: review.review.comment,
      createdAt: review.review.createdAt,
      customer: {
        id: review.customer._id,
        firstName: review.customer.firstName,
        lastName: review.customer.lastName,
        profileImage: review.customer.profileImage,
      },
      serviceName: review.serviceType,
      serviceDate: review.scheduledDate,
    }));

    // Prepare response data
    const responseData = {
      provider: {
        id: provider._id,
        businessName: provider.businessNameRegistered,
        profileImage: provider.profileImage,
        businessLogo: provider.businessLogo,
        description: provider.description,
        experience: provider.experience,
        totalJobsCompleted: provider.totalJobsCompleted,
        isVerified: provider.isVerified,
      },
      selectedService: {
        name: selectedService.name,
        hourlyRate: selectedService.hourlyRate,
        // Add any other service-specific fields you have
      },
      otherServices: otherServices.map((service) => ({
        name: service.name,
        hourlyRate: service.hourlyRate,
      })),
      reviews: {
        statistics: {
          averageRating,
          totalReviews: totalReviews,
          ratingDistribution,
        },
        list: formattedReviews,
        pagination: {
          current: parseInt(page),
          total: totalReviews,
          pages: Math.ceil(totalReviews / parseInt(limit)),
          limit: parseInt(limit),
        },
      },
    };

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("Get provider service details with reviews error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider service details",
      error: error.message,
    });
  }
};

// Public: get a specific service, other services, and feedback (by providerId)
exports.getProviderServiceDetailWithFeedback = async (req, res) => {
  try {
    const { providerId, serviceName } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered servicesProvided rating totalReviews"
    );
    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }

    const selectedService = provider.servicesProvided.find(
      (s) => s.name === serviceName
    );
    if (!selectedService) {
      return res.status(404).json({
        success: false,
        message: "Service not found for this provider",
      });
    }

    const otherServices = provider.servicesProvided.filter(
      (s) => s.name !== serviceName
    );

    // Feedback aggregation & list from ServiceRequest for all services of the provider
    const feedbackQuery = {
      provider: providerId,
      status: "completed",
      "review.rating": { $exists: true },
    };

    const [feedback, total, agg] = await Promise.all([
      ServiceRequest.find(feedbackQuery)
        .select("review customer serviceType")
        .populate("customer", "firstName lastName profileImage")
        .sort({ "review.createdAt": -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceRequest.countDocuments(feedbackQuery),
      ServiceRequest.aggregate([
        {
          $match: {
            ...feedbackQuery,
            provider: new (require("mongoose").Types.ObjectId)(providerId),
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$review.rating" },
          },
        },
      ]),
    ]);

    const averageRating = agg.length ? Number(agg[0].avgRating.toFixed(2)) : 0;

    const feedbackList = feedback.map((sr) => ({
      rating: sr.review.rating,
      comment: sr.review.comment,
      createdAt: sr.review.createdAt,
      customer: sr.customer,
      serviceName: sr.serviceType, // This now shows the actual service name from the service request
    }));

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        selectedService,
        otherServices,
        feedback: {
          list: feedbackList,
          pagination: {
            current: parseInt(page),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
          aggregates: {
            averageRating,
            totalReviews: total,
          },
        },
      },
    });
  } catch (error) {
    console.error("Get provider service details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service details",
      error: error.message,
    });
  }
};
// Get authenticated provider's own service details
exports.getMyServiceDetail = async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const provider = await ServiceProvider.findById(req.user._id).select(
      "businessNameRegistered servicesProvided rating totalReviews"
    );
    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }

    const selectedService = provider.servicesProvided.find(
      (s) => s.name === serviceName
    );
    if (!selectedService) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }

    const otherServices = provider.servicesProvided.filter(
      (s) => s.name !== serviceName
    );

    // Feedback aggregation & list
    const [feedback, total, agg] = await Promise.all([
      ProviderServiceFeedback.find({ provider: req.user._id, serviceName })
        .populate("customer", "firstName lastName profileImage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ProviderServiceFeedback.countDocuments({
        provider: req.user._id,
        serviceName,
      }),
      ProviderServiceFeedback.aggregate([
        { $match: { provider: req.user._id, serviceName } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$rating" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const averageRating = agg.length ? Number(agg[0].avgRating.toFixed(2)) : 0;

    res.json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          rating: provider.rating,
          totalReviews: provider.totalReviews,
        },
        selectedService,
        otherServices,
        feedback: {
          list: feedback,
          pagination: {
            current: parseInt(page),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
          aggregates: {
            averageRating,
            totalReviews: total,
          },
        },
      },
    });
  } catch (error) {
    console.error("Get my service details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service details",
      error: error.message,
    });
  }
};

// controllers/providerController.js

exports.getTopProvidersByService = async (req, res) => {
  try {
    const { serviceName } = req.body;
    const { page = 1, limit = 10 } = req.query;

    if (!serviceName) {
      return res.status(400).json({
        success: false,
        message: "Service name is required in the request body",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const serviceRegex = new RegExp(`^${serviceName}$`, "i");

    // Aggregate feedback to rank providers by average rating for the given service
    const topProviders = await ProviderServiceFeedback.aggregate([
      { $match: { serviceName: serviceRegex } },
      {
        $group: {
          _id: "$provider",
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
      { $sort: { averageRating: -1, totalReviews: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "serviceproviders",
          localField: "_id",
          foreignField: "_id",
          as: "providerDetails",
        },
      },
      { $unwind: "$providerDetails" },
      {
        $project: {
          _id: 1,
          averageRating: { $round: ["$averageRating", 2] },
          totalReviews: 1,
          "providerDetails.businessNameRegistered": 1,
          "providerDetails.profileImage": 1,
          "providerDetails.businessLogo": 1,
          "providerDetails.serviceAreas": 1,
          "providerDetails.servicesProvided": 1,
          "providerDetails.description": 1,
          "providerDetails.experience": 1,
          "providerDetails.totalJobsCompleted": 1,
          "providerDetails.isAvailable": 1,
          "providerDetails.isVerified": 1,
        },
      },
    ]);

    const totalCount = await ProviderServiceFeedback.aggregate([
      { $match: { serviceName: serviceRegex } },
      { $group: { _id: "$provider" } },
      { $count: "totalProviders" },
    ]);

    const totalProviders =
      totalCount.length > 0 ? totalCount[0].totalProviders : 0;

    const formattedProviders = topProviders.map((provider) => ({
      id: provider._id,
      businessName: provider.providerDetails.businessNameRegistered,
      profileImage: provider.providerDetails.profileImage,
      businessLogo: provider.providerDetails.businessLogo,
      averageRating: provider.averageRating,
      totalReviews: provider.totalReviews,
      totalJobsCompleted: provider.providerDetails.totalJobsCompleted,
      serviceAreas: provider.providerDetails.serviceAreas,
      servicesProvided: provider.providerDetails.servicesProvided,
      description: provider.providerDetails.description,
      experience: provider.providerDetails.experience,
      isAvailable: provider.providerDetails.isAvailable,
      isVerified: provider.providerDetails.isVerified,
      serviceDetails: provider.providerDetails.servicesProvided.find(
        (service) => service.name.toLowerCase() === serviceName.toLowerCase()
      ),
    }));

    res.json({
      success: true,
      data: {
        serviceName,
        providers: formattedProviders,
        pagination: {
          current: parseInt(page),
          total: totalProviders,
          pages: Math.ceil(totalProviders / parseInt(limit)),
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get top providers by service error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch top providers",
      error: error.message,
    });
  }
};

// Provider: add a service to profile
exports.addMyService = async (req, res) => {
  try {
    const { serviceName, hourlyRate } = req.body;

    if (!serviceName || !serviceName.trim()) {
      return res.status(400).json({
        success: false,
        message: "serviceName is required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }

    const exists = provider.servicesProvided.some(
      (s) => s.name.toLowerCase() === serviceName.toLowerCase()
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Service already exists in your profile",
      });
    }

    provider.servicesProvided.push({
      name: serviceName.trim(),
      hourlyRate: hourlyRate !== undefined ? Number(hourlyRate) : 0,
    });

    await provider.save();

    res.json({
      success: true,
      message: "Service added successfully",
      data: { servicesProvided: provider.servicesProvided },
    });
  } catch (error) {
    console.error("Add service error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add service",
      error: error.message,
    });
  }
};

// Provider: delete a service from profile
exports.deleteMyService = async (req, res) => {
  try {
    const { serviceName } = req.body;

    if (!serviceName) {
      return res.status(400).json({
        success: false,
        message: "serviceName is required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      return res.status(404).json({ success: false, message: "Provider not found" });
    }

    const initialLength = provider.servicesProvided.length;
    provider.servicesProvided = provider.servicesProvided.filter(
      (s) => s.name.toLowerCase() !== serviceName.toLowerCase()
    );

    if (provider.servicesProvided.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: "Service not found in your profile",
      });
    }

    await provider.save();

    res.json({
      success: true,
      message: "Service deleted successfully",
      data: { servicesProvided: provider.servicesProvided },
    });
  } catch (error) {
    console.error("Delete service error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete service",
      error: error.message,
    });
  }
};

// Provider: get balances
exports.getMyBalance = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id).select(
      "availableBalance pendingPayout totalEarnings pendingEarnings"
    );

    if (!provider) {
      return res.status(404).json({ success: false, message: "Provider not found" });
    }

    // Sum of all paid withdrawals for this provider
    const providerObjectId = new mongoose.Types.ObjectId(req.user._id);
    const totalPayoutResult = await WithdrawalRequest.aggregate([
      { $match: { provider: providerObjectId, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalPayout =
      totalPayoutResult.length > 0 ? totalPayoutResult[0].total : 0;

    res.json({
      success: true,
      data: {
        availableBalance: provider.availableBalance || 0,
        pendingPayout: provider.pendingPayout || 0,
        totalEarnings: provider.totalEarnings || 0,
        totalPayout,
      },
    });
  } catch (error) {
    console.error("Get provider balance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch balance",
      error: error.message,
    });
  }
};

// Provider: get payout information (masked account details)
exports.getMyPayoutInformation = async (req, res) => {
  try {
    const providerId = req.user._id;

    const [provider, payoutInfo] = await Promise.all([
      ServiceProvider.findById(providerId).select("hasPayoutSetup isVerified"),
      PayoutInformation.findOne({
        provider: providerId,
        isActive: true,
      }),
    ]);

    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }

    if (!provider.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Provider verification required before viewing payout information",
      });
    }

    if (!payoutInfo) {
      return res.status(404).json({
        success: false,
        message: "No payout information found",
        data: {
          hasPayoutSetup: provider.hasPayoutSetup || false,
          payoutInformation: null,
        },
      });
    }

    res.json({
      success: true,
      data: {
        hasPayoutSetup: provider.hasPayoutSetup || false,
        payoutInformation: {
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
        },
      },
    });
  } catch (error) {
    console.error("Get provider payout information error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payout information",
      error: error.message,
    });
  }
};

// Provider analytics: today's and this month's orders/earnings
exports.getMyAnalytics = async (req, res) => {
  try {
    const providerId = req.user._id;
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Helper to aggregate paid money requests (post-commission earnings)
    const buildEarnings = async (fromDate) => {
      const results = await MoneyRequest.aggregate([
        {
          $match: {
            provider: new mongoose.Types.ObjectId(providerId),
            status: "paid",
          },
        },
        {
          $addFields: {
            paidAt: {
              $ifNull: ["$paymentDetails.paidAt", "$updatedAt"],
            },
            providerEarnings: {
              $ifNull: ["$commission.providerAmount", "$totalAmount"],
            },
          },
        },
        ...(fromDate
          ? [
              {
                $match: {
                  paidAt: { $gte: fromDate },
                },
              },
            ]
          : []),
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            earnings: { $sum: "$providerEarnings" },
          },
        },
      ]);

      if (results.length === 0) {
        return { orders: 0, earnings: 0 };
      }

      return {
        orders: results[0].orders,
        earnings: results[0].earnings,
      };
    };

    const [todayStats, monthStats] = await Promise.all([
      buildEarnings(startOfToday),
      buildEarnings(startOfMonth),
    ]);

    res.json({
      success: true,
      data: {
        today: todayStats,
        month: monthStats,
      },
    });
  } catch (error) {
    console.error("Get provider analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
      error: error.message,
    });
  }
};

// Public: get all providers with key profile fields
exports.getAllProvidersInfo = async (_req, res) => {
  try {
    const providers = await ServiceProvider.find()
      .select(
        "-password -resetPasswordToken -resetPasswordExpires -approvalNotes"
      )
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        providers,
        total: providers.length,
      },
    });
  } catch (error) {
    console.error("Get all providers info error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
      error: error.message,
    });
  }
};

// Public: get provider + selected service details by query params (clean endpoint)
exports.getProviderServiceDetailsByQuery = async (req, res) => {
  try {
    const { providerId, serviceName, page = 1, limit = 10 } = req.query;

    if (!providerId || !serviceName) {
      return res.status(400).json({
        success: false,
        message: "providerId and serviceName are required",
      });
    }

    // Reuse logic from the path-param handler
    req.params = { providerId, serviceName };
    req.query = { page, limit };
    return exports.getProviderServiceDetailWithFeedback(req, res);
  } catch (error) {
    console.error("Get provider service details by query error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service details",
      error: error.message,
    });
  }
};

// Authenticated customer: add feedback for a provider service
exports.addProviderServiceFeedback = async (req, res) => {
  try {
    const { providerId, serviceName } = req.params;
    const { rating, comment } = req.body;

    if (rating === undefined || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ success: false, message: "Rating must be between 1 and 5" });
    }

    // Validate provider and service
    const provider = await ServiceProvider.findById(providerId).select(
      "servicesProvided"
    );
    if (!provider) {
      return res
        .status(404)
        .json({ success: false, message: "Provider not found" });
    }
    const hasService = provider.servicesProvided.some(
      (s) => s.name === serviceName
    );
    if (!hasService) {
      return res.status(404).json({
        success: false,
        message: "Service not found for this provider",
      });
    }

    // Optional: ensure customer exists
    const customer = await Customer.findById(req.user._id).select("_id");
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const doc = await ProviderServiceFeedback.create({
      provider: providerId,
      customer: req.user._id,
      serviceName,
      rating,
      comment: comment || "",
    });

    await doc.populate("customer", "firstName lastName profileImage");

    res.status(201).json({
      success: true,
      message: "Feedback submitted",
      data: { feedback: doc },
    });
  } catch (error) {
    console.error("Add provider service feedback error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit feedback",
      error: error.message,
    });
  }
};

// ========== SERVICE AREAS CONTROLLERS ========== //

// Public: Get all service areas for a specific provider (by providerId)
exports.getProviderServiceAreas = async (req, res) => {
  try {
    const { providerId } = req.params;

    // Validate providerId
    if (!providerId) {
      return res.status(400).json({
        success: false,
        message: "Provider ID is required",
      });
    }

    // Find provider and select only service areas
    const provider = await ServiceProvider.findById(providerId).select(
      "businessNameRegistered serviceAreas isActive"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    if (!provider.isActive) {
      return res.status(400).json({
        success: false,
        message: "Provider account is not active",
      });
    }

    res.json({
      success: true,
      message: "Service areas retrieved successfully",
      data: {
        provider: {
          id: provider._id,
          businessName: provider.businessNameRegistered,
          isActive: provider.isActive,
        },
        serviceAreas: provider.serviceAreas,
        totalAreas: provider.serviceAreas.length,
        activeAreas: provider.serviceAreas.filter((area) => area.isActive)
          .length,
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

// Get service areas for the authenticated provider (own profile)
exports.getMyServiceAreas = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id).select(
      "businessNameRegistered serviceAreas"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    res.json({
      success: true,
      message: "Your service areas retrieved successfully",
      data: {
        serviceAreas: provider.serviceAreas,
        totalAreas: provider.serviceAreas.length,
        activeAreas: provider.serviceAreas.filter((area) => area.isActive)
          .length,
      },
    });
  } catch (error) {
    console.error("Get my service areas error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your service areas",
      error: error.message,
    });
  }
};

// Add a new service area
exports.addServiceArea = async (req, res) => {
  try {
    const { zipCode, city, state } = req.body;

    // Validate input
    if (!zipCode || !city || !state) {
      return res.status(400).json({
        success: false,
        message: "Zip code, city, and state are required",
      });
    }

    const provider = await ServiceProvider.findById(req.user._id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Check if service area already exists
    const existingArea = provider.serviceAreas.find(
      (area) => area.zipCode === zipCode && area.isActive
    );

    if (existingArea) {
      return res.status(400).json({
        success: false,
        message: "Service area already exists for this zip code",
      });
    }

    // Add new service area
    provider.serviceAreas.push({
      zipCode,
      city,
      state,
      isActive: true,
      addedAt: new Date(),
    });

    await provider.save();

    res.status(201).json({
      success: true,
      message: "Service area added successfully",
      data: {
        serviceArea: provider.serviceAreas[provider.serviceAreas.length - 1],
        totalAreas: provider.serviceAreas.length,
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

// Update a service area
exports.updateServiceArea = async (req, res) => {
  try {
    const { areaId } = req.params;
    const { zipCode, city, state, isActive } = req.body;

    const provider = await ServiceProvider.findById(req.user._id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find the service area
    const serviceArea = provider.serviceAreas.id(areaId);

    if (!serviceArea) {
      return res.status(404).json({
        success: false,
        message: "Service area not found",
      });
    }

    // Update fields if provided
    if (zipCode) serviceArea.zipCode = zipCode;
    if (city) serviceArea.city = city;
    if (state) serviceArea.state = state;
    if (typeof isActive === "boolean") serviceArea.isActive = isActive;

    await provider.save();

    res.json({
      success: true,
      message: "Service area updated successfully",
      data: {
        serviceArea,
      },
    });
  } catch (error) {
    console.error("Update service area error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update service area",
      error: error.message,
    });
  }
};

// Remove a service area (soft delete by setting isActive to false)
exports.removeServiceArea = async (req, res) => {
  try {
    const { areaId } = req.params;

    const provider = await ServiceProvider.findById(req.user._id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    // Find the service area
    const serviceArea = provider.serviceAreas.id(areaId);

    if (!serviceArea) {
      return res.status(404).json({
        success: false,
        message: "Service area not found",
      });
    }

    // Soft delete by setting isActive to false
    serviceArea.isActive = false;

    await provider.save();

    res.json({
      success: true,
      message: "Service area removed successfully",
      data: {
        removedArea: serviceArea,
        activeAreas: provider.serviceAreas.filter((area) => area.isActive)
          .length,
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

// Get providers by service area (zip code)
exports.getProvidersByServiceArea = async (req, res) => {
  try {
    const { zipCode } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!zipCode) {
      return res.status(400).json({
        success: false,
        message: "Zip code is required",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Find providers who serve this zip code and are active
    const [providers, total] = await Promise.all([
      ServiceProvider.find({
        "serviceAreas.zipCode": zipCode,
        "serviceAreas.isActive": true,
        isActive: true,
        isApproved: true,
      })
        .select(
          "businessNameRegistered businessLogo servicesProvided rating totalReviews totalJobsCompleted serviceAreas hourlyRate description"
        )
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceProvider.countDocuments({
        "serviceAreas.zipCode": zipCode,
        "serviceAreas.isActive": true,
        isActive: true,
        isApproved: true,
      }),
    ]);

    // Filter service areas to only show the matching zip code
    const providersWithFilteredAreas = providers.map((provider) => {
      const providerObj = provider.toObject();
      providerObj.serviceAreas = provider.serviceAreas.filter(
        (area) => area.zipCode === zipCode && area.isActive
      );
      return providerObj;
    });

    res.json({
      success: true,
      message: `Found ${providers.length} providers serving zip code ${zipCode}`,
      data: {
        providers: providersWithFilteredAreas,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get providers by service area error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch providers by service area",
      error: error.message,
    });
  }
};
