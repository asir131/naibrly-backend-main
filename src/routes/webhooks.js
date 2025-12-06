// routes/webhooks.js
const express = require("express");
const {
  handleStripeWebhook,
  testWebhook,
} = require("../controllers/webhookController");

const router = express.Router();

// Webhook endpoint (must be before body parser)
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

// Test webhook endpoint
router.post("/stripe/test", testWebhook);

router.post(
  "/stripe/test-raw",
  express.raw({ type: "application/json" }),
  (req, res) => {
    console.log("🔔 Test raw endpoint hit");
    console.log("Body type:", typeof req.body);
    console.log("Is Buffer:", Buffer.isBuffer(req.body));
    console.log("Body length:", req.body?.length);
    console.log(
      "Body content (first 200 chars):",
      req.body?.toString().substring(0, 200)
    );
    console.log("Headers:", req.headers);

    try {
      // Try to parse the body to see if it's valid JSON
      const bodyString = req.body?.toString();
      const parsedBody = bodyString ? JSON.parse(bodyString) : null;

      res.json({
        success: true,
        bodyType: typeof req.body,
        isBuffer: Buffer.isBuffer(req.body),
        bodyLength: req.body?.length,
        bodyContent: bodyString,
        parsedBody: parsedBody,
        headers: {
          "content-type": req.headers["content-type"],
          "content-length": req.headers["content-length"],
          host: req.headers["host"],
        },
      });
    } catch (parseError) {
      res.json({
        success: true,
        bodyType: typeof req.body,
        isBuffer: Buffer.isBuffer(req.body),
        bodyLength: req.body?.length,
        bodyContent: req.body?.toString(),
        parseError: parseError.message,
        headers: {
          "content-type": req.headers["content-type"],
          "content-length": req.headers["content-length"],
          host: req.headers["host"],
        },
      });
    }
  }
);

module.exports = router;
