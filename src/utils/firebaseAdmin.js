const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let initialized = false;

const initFirebaseAdmin = () => {
  if (initialized) return admin;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath) {
    console.warn("[firebase-admin] Missing FIREBASE_SERVICE_ACCOUNT_PATH");
    return null;
  }

  try {
    const resolvedPath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.join(process.cwd(), serviceAccountPath);
    const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    return admin;
  } catch (error) {
    console.error("[firebase-admin] init failed:", error.message);
    return null;
  }
};

module.exports = {
  initFirebaseAdmin,
};
