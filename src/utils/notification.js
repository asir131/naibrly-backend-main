const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { emitToUser } = require("../socket");

const normalizeId = (value) => {
  if (!value) return null;
  if (typeof value === "object" && value._id) {
    return value._id.toString();
  }
  return value.toString ? value.toString() : String(value);
};

const buildNotificationPayload = ({
  title,
  body,
  link,
  requestId,
  bundleId,
  recipientRole,
  customerId,
}) => {
  let resolvedLink = link || "/";
  const idPart = requestId || bundleId;
  const normalizedCustomerId = normalizeId(customerId);

  if (!link) {
    if (recipientRole == "provider" && idPart && normalizedCustomerId) {
      resolvedLink = `/provider/signup/message/${idPart}-${normalizedCustomerId}`;
    } else if (requestId) {
      resolvedLink = `/conversation/request-${requestId}`;
    } else if (bundleId) {
      resolvedLink = `/conversation/bundle-${bundleId}`;
    }
  }

  return {
    id: new mongoose.Types.ObjectId().toString(),
    title: title || "Notification",
    body: body || "",
    link: resolvedLink,
    createdAt: new Date().toISOString(),
    isRead: false,
  };
};

const sendNotification = async ({
  userId,
  title,
  body,
  link,
  requestId,
  bundleId,
  recipientRole,
  customerId,
}) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return null;
  const payload = buildNotificationPayload({
    title,
    body,
    link,
    requestId,
    bundleId,
    recipientRole,
    customerId,
  });

  emitToUser(normalizedUserId, "message", { type: "notification", data: payload });

  try {
    await Notification.create({
      user: normalizedUserId,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      isRead: false,
      createdAt: payload.createdAt || new Date(),
    });
  } catch (err) {
    console.error("notification persist error:", err.message);
  }

  return payload;
};

const sendNotificationToUsers = async ({ userIds, ...rest }) => {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(userIds.map((id) => id?.toString()).filter(Boolean)));
  const results = [];
  for (const id of uniqueIds) {
    const payload = await sendNotification({ userId: id, ...rest });
    if (payload) results.push(payload);
  }
  return results;
};

module.exports = {
  buildNotificationPayload,
  sendNotification,
  sendNotificationToUsers,
};
