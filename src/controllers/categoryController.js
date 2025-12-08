const Category = require("../models/Category");
const CategoryType = require("../models/CategoryType");
const Service = require("../models/Service");

// Comprehensive initialization of default categories, types, and services
const initializeDefaultData = async () => {
  try {
    console.log("🔄 Initializing default categories, types, and services...");

    // Step 1: Create default categories
    const categories = [
      { name: "Interior", description: "Indoor home services", order: 1 },
      { name: "Exterior", description: "Outdoor home services", order: 2 },
      {
        name: "More Services",
        description: "Additional service categories",
        order: 3,
      },
      {
        name: "Additional Resources",
        description: "Extra resources and services",
        order: 4,
      },
    ];

    const createdCategories = {};
    for (const catData of categories) {
      const category = await Category.findOneAndUpdate(
        { name: catData.name },
        catData,
        { upsert: true, new: true }
      );
      createdCategories[catData.name] = category;
    }

    // Step 2: Create default category types and services
    const defaultData = [
      {
        category: "Interior",
        type: "Home Repairs & Maintenance",
        services: [
          "Plumbing",
          "Locksmiths",
          "Appliance Repairs",
          "Door & Window Repairs",
          "HVAC",
          "Electrical",
        ],
      },
      {
        category: "Interior",
        type: "Cleaning & Organization",
        services: [
          "House Cleaning",
          "Carpet Cleaning",
          "Upholstery Cleaning",
          "Home Organization",
          "All Furniture Cleaning",
          "Junk Removal",
          "Duct & Vent Cleaning",
          "Pool Cleaning",
          "Commercial Cleaners",
        ],
      },
      {
        category: "Interior",
        type: "Renovations & Upgrades",
        services: [
          "General Contracting",
          "Carpenters",
          "Bathroom Remodeling",
          "Kitchen Remodeling",
          "Flooring Installation",
          "Carpet Installation",
          "Basement Remodeling",
        ],
      },
      {
        category: "Exterior",
        type: "Exterior Home Care",
        services: [
          "Roofing",
          "Window Washing",
          "Chimney Sweeps",
          "Gutter Cleaning",
          "Deck Contractors",
          "Siding",
          "Concrete & Masonry",
        ],
      },
      {
        category: "Exterior",
        type: "Landscaping & Outdoor Services",
        services: [
          "Lawn Care",
          "Landscaping Design",
          "Gardening",
          "Sprinkler System Repairs",
          "Artificial Turf Installation",
          "Stump Grinding",
          "Sod Installation",
          "Arborists",
        ],
      },
      {
        category: "More Services",
        type: "Moving",
        services: [
          "Local Movers",
          "Long Distance Movers",
          "Piano Movers",
          "Packing & Unpacking",
          "Move In & Move Out Cleaning",
          "Storage Companies",
          "Furniture Movers",
        ],
      },
      {
        category: "More Services",
        type: "Installation & Assembly",
        services: [
          "Holiday Light Hanging",
          "TV Mounting",
          "Security Camera Installation",
          "Appliance Installation",
          "Ceiling Fan Installation",
          "Generator Installation",
          "Furniture Assembly",
        ],
      },
    ];

    let totalTypesCreated = 0;
    let totalServicesCreated = 0;

    for (const data of defaultData) {
      const category = createdCategories[data.category];

      if (!category) {
        console.log(`❌ Category not found: ${data.category}`);
        continue;
      }

      // Create or update category type
      let categoryType = await CategoryType.findOne({
        name: data.type,
        category: category._id,
      });

      if (!categoryType) {
        categoryType = new CategoryType({
          name: data.type,
          category: category._id,
          description: `${data.type} services`,
        });
        await categoryType.save();
        totalTypesCreated++;
        console.log(`✅ Category type created: ${data.type}`);
      }

      // Create services for this category type
      for (const serviceName of data.services) {
        let service = await Service.findOne({
          name: serviceName,
          categoryType: categoryType._id,
        });

        if (!service) {
          service = new Service({
            name: serviceName,
            categoryType: categoryType._id,
            description: `${serviceName} service`,
          });
          await service.save();
          totalServicesCreated++;
        }
      }
    }
  } catch (error) {
    console.error("❌ Error initializing default data:", error.message);
  }
};

// API endpoint to manually initialize default data (for admin use)
const initializeDefaults = async (req, res) => {
  try {
    await initializeDefaultData();

    res.json({
      success: true,
      message:
        "Default categories, types, and services initialized successfully",
    });
  } catch (error) {
    console.error("Initialize defaults error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize default data",
      error: error.message,
    });
  }
};

// Get all categories with their types and services
const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({
      order: 1,
    });

    const result = await Promise.all(
      categories.map(async (category) => {
        const categoryTypes = await CategoryType.find({
          category: category._id,
          isActive: true,
        }).sort({ order: 1 });

        const categoryTypesWithServices = await Promise.all(
          categoryTypes.map(async (type) => {
            const services = await Service.find({
              categoryType: type._id,
              isActive: true,
            }).sort({ name: 1 });

            return {
              ...type.toObject(),
              services,
            };
          })
        );

        return {
          ...category.toObject(),
          categoryTypes: categoryTypesWithServices,
        };
      })
    );

    res.json({
      success: true,
      data: { categories: result },
    });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
};

// Get all services for service provider enum
const getAllServices = async (req, res) => {
  try {
    const services = await Service.find({ isActive: true })
      .sort({ name: 1 })
      .populate({
        path: "categoryType",
        populate: {
          path: "category",
        },
      });

    res.json({
      success: true,
      data: { services },
    });
  } catch (error) {
    console.error("Get services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch services",
      error: error.message,
    });
  }
};

// Search services by query against service, categoryType, or category name/description
const searchServices = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: "Query parameter is required",
      });
    }

    const searchRegex = new RegExp(query.trim(), "i");

    const services = await Service.find({
      isActive: true,
      $or: [{ name: searchRegex }, { description: searchRegex }],
    })
      .sort({ name: 1 })
      .populate({
        path: "categoryType",
        populate: {
          path: "category",
        },
      });

    // Filter to include matches that come via categoryType or category even if service name didn't match
    const filtered = services.filter((service) => {
      const categoryType = service.categoryType;
      const category = categoryType?.category;

      const matchesService =
        searchRegex.test(service.name || "") ||
        searchRegex.test(service.description || "");
      const matchesCategoryType =
        categoryType && searchRegex.test(categoryType.name || "");
      const matchesCategory =
        category && searchRegex.test(category.name || "");

      return matchesService || matchesCategoryType || matchesCategory;
    });

    res.json({
      success: true,
      data: { services: filtered },
    });
  } catch (error) {
    console.error("Search services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search services",
      error: error.message,
    });
  }
};

// Search categories (and include matching categoryTypes and their services)
const searchCategories = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: "Query parameter is required",
      });
    }

    const searchRegex = new RegExp(query.trim(), "i");

    // Find matching categories
    const categories = await Category.find({
      name: searchRegex,
      isActive: true,
    })
      .sort({ order: 1, name: 1 })
      .lean();

    // For each category, fetch its active categoryTypes and services
    const result = [];
    for (const cat of categories) {
      const catTypes = await CategoryType.find({
        category: cat._id,
        isActive: true,
      })
        .sort({ order: 1, name: 1 })
        .lean();

      const typesWithServices = [];
      for (const ct of catTypes) {
        const ctServices = await Service.find({
          categoryType: ct._id,
          isActive: true,
        })
          .sort({ name: 1 })
          .lean();

        typesWithServices.push({
          ...ct,
          services: ctServices,
        });
      }

      result.push({
        ...cat,
        categoryTypes: typesWithServices,
      });
    }

    res.json({
      success: true,
      data: { categories: result },
    });
  } catch (error) {
    console.error("Search categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search categories",
      error: error.message,
    });
  }
};

// Get initialization status
const getInitializationStatus = async (req, res) => {
  try {
    const categoryCount = await Category.countDocuments();
    const categoryTypeCount = await CategoryType.countDocuments();
    const serviceCount = await Service.countDocuments();

    res.json({
      success: true,
      data: {
        categories: categoryCount,
        categoryTypes: categoryTypeCount,
        services: serviceCount,
        expected: {
          categories: 4,
          categoryTypes: 7,
          services: 51,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get status",
      error: error.message,
    });
  }
};

// Create new category type with image and services
const createCategoryTypeWithServices = async (req, res) => {
  try {
    console.log("=== CREATE CATEGORY TYPE ===");
    console.log("Body:", req.body);
    console.log("File:", req.file);

    const { categoryName, categoryTypeName, services } = req.body;

    // Basic validation
    if (!categoryName || !categoryTypeName) {
      return res.status(400).json({
        success: false,
        message: "Category name and category type name are required",
      });
    }

    // Validate category
    const allowedCategories = [
      "Interior",
      "Exterior",
      "More Services",
      "Additional Resources",
    ];
    if (!allowedCategories.includes(categoryName)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category name",
      });
    }

    // Get or create category
    let category = await Category.findOne({ name: categoryName });
    if (!category) {
      category = new Category({
        name: categoryName,
        description: `${categoryName} services`,
      });
      await category.save();
    }

    // Check if category type already exists
    const existingType = await CategoryType.findOne({
      name: categoryTypeName.trim(),
      category: category._id,
    });

    if (existingType) {
      return res.status(400).json({
        success: false,
        message: "Category type already exists",
      });
    }

    // Prepare image data from Cloudinary upload
    const imageData = req.file
      ? {
          url: req.file.path || req.file.url || "",
          publicId: req.file.filename || req.file.public_id || "",
        }
      : { url: "", publicId: "" };

    console.log("📸 Image uploaded:", imageData);

    // Create category type
    const categoryType = new CategoryType({
      name: categoryTypeName.trim(),
      category: category._id,
      description: `${categoryTypeName.trim()} services`,
      image: imageData,
    });

    await categoryType.save();

    // Create services
    let servicesArray = [];
    if (services) {
      if (typeof services === "string") {
        servicesArray = services
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
      }
    }

    const createdServices = [];
    for (const serviceName of servicesArray) {
      const service = new Service({
        name: serviceName,
        categoryType: categoryType._id,
        description: `${serviceName} service`,
      });
      await service.save();
      createdServices.push(service);
    }

    // Send response
    res.status(201).json({
      success: true,
      message: "Category type created successfully",
      data: {
        categoryType: {
          ...categoryType.toObject(),
          category: category,
        },
        services: createdServices,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Add new service to existing category type
const addServiceToCategoryType = async (req, res) => {
  try {
    console.log("=== ADD SERVICE TO CATEGORY TYPE ===");
    console.log("Body:", req.body);

    const { categoryTypeName, serviceName, serviceDescription } = req.body;

    // Validation
    if (!categoryTypeName || !serviceName) {
      return res.status(400).json({
        success: false,
        message: "Category type name and service name are required",
      });
    }

    // Find the category type
    const categoryType = await CategoryType.findOne({
      name: categoryTypeName.trim(),
    }).populate("category");

    if (!categoryType) {
      return res.status(404).json({
        success: false,
        message: "Category type not found",
      });
    }

    console.log("🔍 Found category type:", {
      id: categoryType._id,
      name: categoryType.name,
      category: categoryType.category?.name,
    });

    // Check if service already exists in this category type
    const existingService = await Service.findOne({
      name: serviceName.trim(),
      categoryType: categoryType._id,
    });

    if (existingService) {
      return res.status(400).json({
        success: false,
        message: `Service "${serviceName}" already exists in "${categoryTypeName}"`,
      });
    }

    // Check if service exists globally (in any category type)
    const globalServiceExists = await Service.findOne({
      name: serviceName.trim(),
    });

    if (globalServiceExists) {
      return res.status(400).json({
        success: false,
        message: `Service "${serviceName}" already exists in the system. Please use a different name.`,
      });
    }

    // Create new service
    const newService = new Service({
      name: serviceName.trim(),
      categoryType: categoryType._id,
      description: serviceDescription
        ? serviceDescription.trim()
        : `${serviceName.trim()} service`,
      isActive: true,
    });

    await newService.save();

    // Populate for response
    await newService.populate({
      path: "categoryType",
      populate: {
        path: "category",
      },
    });

    console.log("✅ New service created:", newService);

    res.status(201).json({
      success: true,
      message: `Service "${serviceName}" added successfully to "${categoryTypeName}"`,
      data: {
        service: newService,
        categoryType: {
          id: categoryType._id,
          name: categoryType.name,
          category: categoryType.category,
        },
      },
    });
  } catch (error) {
    console.error("Add service to category type error:", error);

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
      message: "Failed to add service",
      error: error.message,
    });
  }
};

// Export all functions properly
module.exports = {
  initializeDefaultData,
  initializeDefaults,
  getAllCategories,
  getAllServices,
  searchServices,
  searchCategories,
  getInitializationStatus,
  createCategoryTypeWithServices,
  addServiceToCategoryType,
};
