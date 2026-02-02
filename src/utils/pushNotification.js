const DeviceToken = require("../models/DeviceToken");
const { initFirebaseAdmin } = require("./firebaseAdmin");

const sendPushToUser = async ({ userId, title, body, data }) => {
  const admin = initFirebaseAdmin();
  if (!admin) return;

  try {
    const tokens = await DeviceToken.find({ user: userId }).lean();
    if (!tokens.length) return;

    const registrationTokens = tokens.map((t) => t.token).filter(Boolean);
    if (!registrationTokens.length) return;

    const message = {
      tokens: registrationTokens,
      notification: {
        title: title || "Naibrly",
        body: body || "",
      },
      data: data || {},
    };

    const response = await admin.messaging().sendMulticast(message);

    // Remove invalid tokens
    const invalidTokens = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const errorCode = res.error?.code || "";
        if (
          errorCode.includes("registration-token-not-registered") ||
          errorCode.includes("invalid-argument")
        ) {
          invalidTokens.push(registrationTokens[idx]);
        }
      }
    });

    if (invalidTokens.length) {
      await DeviceToken.deleteMany({ token: { $in: invalidTokens } });
    }
  } catch (error) {
    console.error("[push] sendPushToUser failed:", error.message);
  }
};

module.exports = { sendPushToUser };
