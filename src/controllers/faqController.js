const FAQ = require("../models/FAQ");

// Get all FAQs
exports.getAllFAQs = async (req, res) => {
  try {
    const { category, active, search } = req.query;

    const filter = {};

    if (category) {
      filter.category = category;
    }

    if (active !== undefined) {
      filter.isActive = active === "true";
    }

    if (search) {
      filter.$or = [
        { question: { $regex: search, $options: "i" } },
        { answer: { $regex: search, $options: "i" } },
      ];
    }

    const faqs = await FAQ.find(filter)
      .populate("createdBy", "firstName lastName email")
      .populate("lastUpdatedBy", "firstName lastName email")
      .sort({ order: 1, createdAt: -1 });

    res.json({
      success: true,
      data: {
        faqs: faqs.map((faq) => ({
          id: faq._id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          order: faq.order,
          isActive: faq.isActive,
          createdBy: faq.createdBy,
          lastUpdatedBy: faq.lastUpdatedBy,
          createdAt: faq.createdAt,
          updatedAt: faq.updatedAt,
        })),
        total: faqs.length,
      },
    });
  } catch (error) {
    console.error("Get all FAQs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch FAQs",
      error: error.message,
    });
  }
};

// Get single FAQ
exports.getFAQ = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findById(id)
      .populate("createdBy", "firstName lastName email")
      .populate("lastUpdatedBy", "firstName lastName email");

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: "FAQ not found",
      });
    }

    res.json({
      success: true,
      data: {
        faq: {
          id: faq._id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          order: faq.order,
          isActive: faq.isActive,
          createdBy: faq.createdBy,
          lastUpdatedBy: faq.lastUpdatedBy,
          createdAt: faq.createdAt,
          updatedAt: faq.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Get FAQ error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch FAQ",
      error: error.message,
    });
  }
};

// Create FAQ
exports.createFAQ = async (req, res) => {
  try {
    const { question, answer, category, order, isActive } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        message: "Question and answer are required",
      });
    }

    const faq = new FAQ({
      question: question.trim(),
      answer: answer.trim(),
      category: category || "general",
      order: order || 0,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.user._id,
      lastUpdatedBy: req.user._id,
    });

    await faq.save();

    await faq.populate("createdBy", "firstName lastName email");
    await faq.populate("lastUpdatedBy", "firstName lastName email");

    res.status(201).json({
      success: true,
      message: "FAQ created successfully",
      data: {
        faq: {
          id: faq._id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          order: faq.order,
          isActive: faq.isActive,
          createdBy: faq.createdBy,
          lastUpdatedBy: faq.lastUpdatedBy,
          createdAt: faq.createdAt,
          updatedAt: faq.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Create FAQ error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create FAQ",
      error: error.message,
    });
  }
};

// Update FAQ
exports.updateFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category, order, isActive } = req.body;

    const faq = await FAQ.findById(id);

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: "FAQ not found",
      });
    }

    if (question) faq.question = question.trim();
    if (answer) faq.answer = answer.trim();
    if (category) faq.category = category;
    if (order !== undefined) faq.order = order;
    if (isActive !== undefined) faq.isActive = isActive;
    faq.lastUpdatedBy = req.user._id;

    await faq.save();

    await faq.populate("createdBy", "firstName lastName email");
    await faq.populate("lastUpdatedBy", "firstName lastName email");

    res.json({
      success: true,
      message: "FAQ updated successfully",
      data: {
        faq: {
          id: faq._id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          order: faq.order,
          isActive: faq.isActive,
          createdBy: faq.createdBy,
          lastUpdatedBy: faq.lastUpdatedBy,
          createdAt: faq.createdAt,
          updatedAt: faq.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Update FAQ error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update FAQ",
      error: error.message,
    });
  }
};

// Delete FAQ
exports.deleteFAQ = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findById(id);

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: "FAQ not found",
      });
    }

    await FAQ.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "FAQ deleted successfully",
      data: {
        deletedId: id,
      },
    });
  } catch (error) {
    console.error("Delete FAQ error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete FAQ",
      error: error.message,
    });
  }
};
