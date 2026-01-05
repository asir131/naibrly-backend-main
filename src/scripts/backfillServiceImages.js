const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const Service = require("../models/Service");
require("../models/CategoryType");

const envPath = path.join(__dirname, "..", "..", ".env");
require("dotenv").config({ path: envPath });

const run = async () => {
  await connectDB();

  const services = await Service.find()
    .populate("categoryType", "image")
    .select("_id image categoryType");

  let updated = 0;
  let skippedNoCategory = 0;
  let skippedNoImage = 0;

  const ops = [];

  services.forEach((service) => {
    if (!service.categoryType) {
      skippedNoCategory += 1;
      return;
    }

    const image = service.categoryType.image || {};
    const url = image.url || "";
    const publicId = image.publicId || "";

    if (!url && !publicId) {
      skippedNoImage += 1;
      return;
    }

    ops.push({
      updateOne: {
        filter: { _id: service._id },
        update: { $set: { image: { url, publicId } } },
      },
    });
  });

  if (ops.length > 0) {
    const result = await Service.bulkWrite(ops);
    updated = result.modifiedCount || 0;
  }

  console.log(
    JSON.stringify(
      {
        total: services.length,
        updated,
        skippedNoCategory,
        skippedNoImage,
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error("Backfill failed:", error);
  await mongoose.connection.close();
  process.exit(1);
});
