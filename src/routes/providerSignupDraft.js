const express = require("express");
const router = express.Router();

const {
  saveProviderSignupDraft,
  getProviderSignupDraft,
  clearProviderSignupDraft,
} = require("../controllers/providerSignupDraftController");

// Public draft endpoints keyed by email
router.post("/", saveProviderSignupDraft);
router.get("/", getProviderSignupDraft);
router.delete("/", clearProviderSignupDraft);

module.exports = router;
