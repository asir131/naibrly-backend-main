const express = require("express");
const { getPublicFAQs } = require("../controllers/faqController");

const router = express.Router();

// Public FAQ route (only active FAQs)
router.get("/", getPublicFAQs);

module.exports = router;
