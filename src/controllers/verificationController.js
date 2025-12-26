const Verification = require("../models/Verification");
const ServiceProvider = require("../models/ServiceProvider");
const PayoutInformation = require("../models/PayoutInformation");
const Admin = require("../models/Admin");
const { sendNotification, sendNotificationToUsers } = require("../utils/notification");
const { cloudinary, hasCloudinaryConfig } = require("../config/cloudinary");

// Helper: upload buffer to Cloudinary with timeout, or pass through multer-stored path/publicId.
// If Cloudinary is not configured or uploads are skipped, fall back to local metadata.
const mapFileToAsset = async (file, folder, fallbackPrefix) => {
  if (!file) return { url: "", publicId: "" };

  // If Cloudinary creds are missing, do not attempt to upload
  if (!hasCloudinaryConfig) {
    return {
      url: file.path || file.originalname || "",
      publicId: file.filename || `${fallbackPrefix}_${Date.now()}`,
    };
  }

  // If upload was already handled by Cloudinary storage (multer), use that
  if (file.path || file.secure_url) {
    return {
      url: file.path || file.secure_url,
      publicId: file.filename || file.public_id || "",
    };
  }

  // Skip uploads when instructed (useful for restricted networks)
  const skipUploads = process.env.SKIP_UPLOADS === "true";
  if (skipUploads) {
    return {
      url: file.originalname || "",
      publicId: `${fallbackPrefix}_${Date.now()}`,
    };
  }

  // Upload from buffer with a hard timeout so the request doesn't hang
  const uploadBuffer = (buffer, folderName, filename, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Cloudinary upload timed out after ${timeoutMs}ms`)),
        timeoutMs
      );

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folderName,
          public_id: filename,
          resource_type: "auto",
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

  if (file.buffer) {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    const publicId = `${fallbackPrefix}_${timestamp}_${rand}`;
    const result = await uploadBuffer(file.buffer, folder, publicId);
    return { url: result.secure_url, publicId: result.public_id };
  }

  // Fallback to originalname if nothing else is available
  return {
    url: file.originalname || "",
    publicId: `${fallbackPrefix}_${Date.now()}`,
  };
};

exports.submitVerification = async (req, res) => {
  try {
    console.log("[verify] Starting verification submission...");
    console.log("[verify] Request body:", req.body);
    console.log("[verify] Request files:", req.files);

    const { einNumber, firstName, lastName, businessRegisteredCountry } =
      req.body;

    // Validation - check all required fields
    if (!einNumber || !firstName || !lastName || !businessRegisteredCountry) {
      console.log("Missing required fields");
      return res.status(400).json({
        success: false,
        message: "EIN Number, first name, last name, and country are required",
        missingFields: {
          einNumber: !einNumber,
          firstName: !firstName,
          lastName: !lastName,
          businessRegisteredCountry: !businessRegisteredCountry,
        },
      });
    }

    // Check if files are uploaded
    if (!req.files) {
      console.log("No files uploaded");
      return res.status(400).json({
        success: false,
        message:
          "All documents are required: insurance document, ID card front, and ID card back",
      });
    }

    const insuranceDocument = req.files["insuranceDocument"]?.[0];
    const idCardFront = req.files["idCardFront"]?.[0];
    const idCardBack = req.files["idCardBack"]?.[0];

    console.log("[verify] File details:", {
      insurance: insuranceDocument?.originalname,
      idFront: idCardFront?.originalname,
      idBack: idCardBack?.originalname,
    });

    if (!insuranceDocument || !idCardFront || !idCardBack) {
      console.log("Missing required files");
      return res.status(400).json({
        success: false,
        message:
          "All documents are required: insurance document, ID card front, and ID card back",
        missing: {
          insuranceDocument: !insuranceDocument,
          idCardFront: !idCardFront,
          idCardBack: !idCardBack,
        },
      });
    }

    // Check if provider exists
    const provider = await ServiceProvider.findById(req.user._id);
    if (!provider) {
      console.log("Provider not found:", req.user._id);
      return res.status(404).json({
        success: false,
        message: "Service provider not found",
      });
    }

    console.log("Provider found:", provider.businessNameRegistered);

    if (!provider.firstName && firstName) {
      provider.firstName = firstName.trim();
    }
    if (!provider.lastName && lastName) {
      provider.lastName = lastName.trim();
    }

    // Check if verification already exists and is pending
    const existingVerification = await Verification.findOne({
      provider: req.user._id,
      status: "pending",
    });

    if (existingVerification) {
      console.log("Pending verification already exists");
      return res.status(400).json({
        success: false,
        message: "You already have a pending verification request",
      });
    }

    console.log("Creating new verification record...");

    // Upload/resolve documents
    const [insuranceAsset, idFrontAsset, idBackAsset] = await Promise.all([
      mapFileToAsset(insuranceDocument, "naibrly/verifications", "insurance"),
      mapFileToAsset(idCardFront, "naibrly/verifications", "id_front"),
      mapFileToAsset(idCardBack, "naibrly/verifications", "id_back"),
    ]);

    // Create verification record with all documents
    const verification = new Verification({
      provider: req.user._id,
      einNumber,
      firstName,
      lastName,
      businessRegisteredCountry,
      insuranceDocument: insuranceAsset,
      idCardFront: idFrontAsset,
      idCardBack: idBackAsset,
    });

    console.log("Saving verification to database...");
    await verification.save();
    console.log("Verification saved:", verification._id);

    // Update provider verification status
    provider.isVerified = false;
    await provider.save();
    console.log("Provider verification status updated");

    const admins = await Admin.find().select("_id");
    await sendNotificationToUsers({
      userIds: admins.map((a) => a._id),
      title: "Verification submitted",
      body: `${provider.businessNameRegistered || "Provider"} submitted verification documents`,
      link: "/admin/notifications",
    });

    res.status(201).json({
      success: true,
      message: "Verification information submitted successfully with all documents",
      data: {
        verification: {
          id: verification._id,
          einNumber: verification.einNumber,
          firstName: verification.firstName,
          lastName: verification.lastName,
          businessRegisteredCountry: verification.businessRegisteredCountry,
          status: verification.status,
          submittedAt: verification.submittedAt,
          insuranceDocument: verification.insuranceDocument,
          idCardFront: verification.idCardFront,
          idCardBack: verification.idCardBack,
        },
      },
    });
  } catch (error) {
    console.error("Submit verification error:", error);
    console.error("Error stack:", error.stack);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
    });

    // Delete all uploaded files if verification fails
    if (req.files) {
      console.log("Cleaning up uploaded files due to error...");
      const filesToDelete = [];

      if (req.files["insuranceDocument"]?.[0]?.filename) {
        filesToDelete.push(req.files["insuranceDocument"][0].filename);
      }
      if (req.files["idCardFront"]?.[0]?.filename) {
        filesToDelete.push(req.files["idCardFront"][0].filename);
      }
      if (req.files["idCardBack"]?.[0]?.filename) {
        filesToDelete.push(req.files["idCardBack"][0].filename);
      }

      if (hasCloudinaryConfig) {
        for (const publicId of filesToDelete) {
          try {
            await cloudinary.uploader.destroy(publicId);
            console.log(`Deleted uploaded file: ${publicId}`);
          } catch (deleteError) {
            console.error(`Error deleting file ${publicId}:`, deleteError);
          }
        }
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || "Failed to submit verification information",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : "Internal server error",
    });
  }
};

// Get verification status for provider
exports.getVerificationStatus = async (req, res) => {
  try {
    const verification = await Verification.findOne({
      provider: req.user._id,
    }).sort({ createdAt: -1 }); // Get latest verification

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "No verification information found",
      });
    }

    res.json({
      success: true,
      data: {
        verification,
      },
    });
  } catch (error) {
    console.error("Get verification status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get verification status",
      error: error.message,
    });
  }
};

// Admin: Get all verification requests
exports.getAllVerifications = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const effectiveStatus = status || "pending";

    const pipeline = [
      {
        $match: {
          status: effectiveStatus,
        },
      },
      {
        $lookup: {
          from: "serviceproviders",
          localField: "provider",
          foreignField: "_id",
          as: "provider",
        },
      },
      { $unwind: "$provider" },
      {
        $match: {
          "provider.isVerified": { $ne: true },
        },
      },
      {
        $lookup: {
          from: "admins",
          localField: "reviewedBy",
          foreignField: "_id",
          as: "reviewedBy",
        },
      },
      {
        $unwind: {
          path: "$reviewedBy",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          provider: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            businessNameRegistered: 1,
            profileImage: 1,
            isVerified: 1,
            createdAt: 1,
          },
          reviewedBy: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
          },
          einNumber: 1,
          businessRegisteredCountry: 1,
          insuranceDocument: 1,
          idCardFront: 1,
          idCardBack: 1,
          firstName: 1,
          lastName: 1,
          status: 1,
          reviewedAt: 1,
          rejectionReason: 1,
          submittedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: parseInt(limit) }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const aggResult = await Verification.aggregate(pipeline);
    const data = aggResult[0]?.data || [];
    const total = aggResult[0]?.totalCount?.[0]?.count || 0;
    const verifications = data;

    res.json({
      success: true,
      data: {
        verifications,
        pagination: {
          current: parseInt(page),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get all verifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch verification requests",
      error: error.message,
    });
  }
};

// Admin: Approve/Reject verification
exports.reviewVerification = async (req, res) => {
  try {
    const { verificationId } = req.params;
    const { status, rejectionReason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "approved" or "rejected"',
      });
    }

    const verification = await Verification.findById(verificationId).populate(
      "provider"
    );

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification request not found",
      });
    }

    verification.status = status;
    verification.reviewedBy = req.user._id;
    verification.reviewedAt = new Date();

    if (status === "rejected" && rejectionReason) {
      verification.rejectionReason = rejectionReason;
    }

    await verification.save();

    if (verification.provider) {
      verification.provider.isVerified = status === "approved";
      if (status === "approved") {
        if (verification.firstName) {
          verification.provider.firstName = verification.firstName;
        }
        if (verification.lastName) {
          verification.provider.lastName = verification.lastName;
        }

        const docEntries = [];
        if (verification.insuranceDocument?.url) {
          docEntries.push({
            name: "insuranceDocument",
            url: verification.insuranceDocument.url,
            verified: true,
          });
        }
        if (verification.idCardFront?.url) {
          docEntries.push({
            name: "idCardFront",
            url: verification.idCardFront.url,
            verified: true,
          });
        }
        if (verification.idCardBack?.url) {
          docEntries.push({
            name: "idCardBack",
            url: verification.idCardBack.url,
            verified: true,
          });
        }

        if (docEntries.length) {
          const existingMap = new Map(
            (verification.provider.documents || []).map((d) => [d.name, d])
          );

          for (const entry of docEntries) {
            existingMap.set(entry.name, {
              ...existingMap.get(entry.name),
              ...entry,
            });
          }

          verification.provider.documents = Array.from(existingMap.values());
        }
      }
      await verification.provider.save();

      await PayoutInformation.findOneAndUpdate(
        { provider: verification.provider._id },
        {
          verificationStatus: status === "approved" ? "verified" : "failed",
          isVerified: status === "approved",
          verificationNotes:
            status === "approved" ? "Approved with verification" : rejectionReason,
          verifiedAt: new Date(),
          verifiedBy: req.user._id,
        },
        { new: true }
      );
    }

    res.json({
      success: true,
      message: `Verification ${status} successfully`,
      data: {
        verification,
      },
    });
  } catch (error) {
    console.error("Review verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to review verification",
      error: error.message,
    });
  }
};

// Admin: get full provider profile (registration, verification, payout)
exports.getProviderVerificationBundle = async (req, res) => {
  try {
    const { providerId } = req.params;

    const provider = await ServiceProvider.findById(providerId).select(
      "-password -resetPasswordToken -resetPasswordExpires"
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "Provider not found",
      });
    }

    const latestVerification = await Verification.findOne({
      provider: providerId,
    })
      .sort({ createdAt: -1 })
      .populate("reviewedBy", "firstName lastName email");

    const payoutInfo = await PayoutInformation.findOne({
      provider: providerId,
      isActive: true,
    }).select("-accountNumber");

    const verificationData = latestVerification
      ? {
          verificationId: latestVerification._id,
          ...latestVerification.toObject(),
        }
      : null;

    const payoutData = payoutInfo
      ? {
          payoutInformationId: payoutInfo._id,
          ...payoutInfo.toObject(),
          accountNumber: payoutInfo.getMaskedAccountNumber(),
        }
      : null;

    res.json({
      success: true,
      data: {
        provider,
        verification: verificationData,
        payoutInformation: payoutData,
      },
    });
  } catch (error) {
    console.error("Get provider verification bundle error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch provider verification details",
      error: error.message,
    });
  }
};

// Provider: Delete verification (if pending)
exports.deleteVerification = async (req, res) => {
  try {
    const verification = await Verification.findOne({
      provider: req.user._id,
      status: "pending",
    });

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "No pending verification found to delete",
      });
    }

    const filesToDelete = [];

    if (verification.insuranceDocument?.publicId) {
      filesToDelete.push(verification.insuranceDocument.publicId);
    }
    if (verification.idCardFront?.publicId) {
      filesToDelete.push(verification.idCardFront.publicId);
    }
    if (verification.idCardBack?.publicId) {
      filesToDelete.push(verification.idCardBack.publicId);
    }

    if (hasCloudinaryConfig) {
      for (const publicId of filesToDelete) {
        try {
          await cloudinary.uploader.destroy(publicId);
          console.log(`Deleted verification file: ${publicId}`);
        } catch (deleteError) {
          console.error(`Error deleting file ${publicId}:`, deleteError);
        }
      }
    }

    await Verification.findByIdAndDelete(verification._id);

    res.json({
      success: true,
      message: "Verification request and all documents deleted successfully",
    });
  } catch (error) {
    console.error("Delete verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete verification request",
      error: error.message,
    });
  }
};

// Get verification by ID
exports.getVerificationById = async (req, res) => {
  try {
    const { verificationId } = req.params;

    const verification = await Verification.findById(verificationId)
      .populate(
        "provider",
        "firstName lastName email businessNameRegistered phone profileImage"
      )
      .populate("reviewedBy", "firstName lastName email");

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification not found",
      });
    }

    res.json({
      success: true,
      data: {
        verification,
      },
    });
  } catch (error) {
    console.error("Get verification by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch verification details",
      error: error.message,
    });
  }
};
