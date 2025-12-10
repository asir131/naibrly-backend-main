const Content = require("../models/Content");

// Get content by type (terms, privacy, about)
exports.getContent = async (req, res) => {
  try {
    const { type } = req.params;

    if (!["terms", "privacy", "about"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid content type. Must be 'terms', 'privacy', or 'about'",
      });
    }

    let content = await Content.findOne({ type }).populate(
      "lastUpdatedBy",
      "firstName lastName email"
    );

    // If content doesn't exist, create default
    if (!content) {
      const defaultTitles = {
        terms: "Terms & Conditions",
        privacy: "Privacy Policy",
        about: "About Us",
      };

      const defaultContent = {
        terms: "Please add your terms and conditions here.",
        privacy: "Please add your privacy policy here.",
        about: "Please add information about your company here.",
      };

      content = new Content({
        type,
        title: defaultTitles[type],
        content: defaultContent[type],
      });

      await content.save();
    }

    res.json({
      success: true,
      data: {
        content: {
          id: content._id,
          type: content.type,
          title: content.title,
          content: content.content,
          lastUpdatedBy: content.lastUpdatedBy,
          createdAt: content.createdAt,
          updatedAt: content.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Get content error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch content",
      error: error.message,
    });
  }
};

// Update content by type
exports.updateContent = async (req, res) => {
  try {
    const { type } = req.params;
    const { title, content } = req.body;

    if (!["terms", "privacy", "about"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid content type. Must be 'terms', 'privacy', or 'about'",
      });
    }

    if (!title && !content) {
      return res.status(400).json({
        success: false,
        message: "At least one field (title or content) is required",
      });
    }

    let contentDoc = await Content.findOne({ type });

    if (!contentDoc) {
      // Create new content if doesn't exist
      contentDoc = new Content({
        type,
        title: title || `${type.charAt(0).toUpperCase() + type.slice(1)}`,
        content: content || "",
        lastUpdatedBy: req.user._id,
      });
    } else {
      // Update existing content
      if (title) contentDoc.title = title;
      if (content) contentDoc.content = content;
      contentDoc.lastUpdatedBy = req.user._id;
    }

    await contentDoc.save();

    // Populate the lastUpdatedBy field
    await contentDoc.populate("lastUpdatedBy", "firstName lastName email");

    res.json({
      success: true,
      message: "Content updated successfully",
      data: {
        content: {
          id: contentDoc._id,
          type: contentDoc.type,
          title: contentDoc.title,
          content: contentDoc.content,
          lastUpdatedBy: contentDoc.lastUpdatedBy,
          createdAt: contentDoc.createdAt,
          updatedAt: contentDoc.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Update content error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update content",
      error: error.message,
    });
  }
};
