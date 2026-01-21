const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const Bundle = require("../models/Bundle");

const envPath = path.join(__dirname, "..", "..", ".env");
require("dotenv").config({ path: envPath });

const run = async () => {
  await connectDB();

  const filter = {
    $or: [{ zipCode: { $exists: false } }, { zipCode: null }, { zipCode: "" }],
  };

  const bundles = await Bundle.find(filter)
    .populate("creator", "address")
    .select("_id zipCode address creator");

  let updated = 0;
  let skipped = 0;

  const ops = [];

  bundles.forEach((bundle) => {
    const addressZip = bundle.address?.zipCode;
    const creatorZip = bundle.creator?.address?.zipCode;
    const nextZip = (addressZip || creatorZip || "").trim();

    if (!nextZip) {
      skipped += 1;
      return;
    }

    const update = { zipCode: nextZip };
    if (bundle.address && !bundle.address?.zipCode) {
      update["address.zipCode"] = nextZip;
    }

    ops.push({
      updateOne: {
        filter: { _id: bundle._id },
        update: { $set: update },
      },
    });
  });

  if (ops.length > 0) {
    const result = await Bundle.bulkWrite(ops);
    updated = result.modifiedCount || 0;
  }

  console.log(
    JSON.stringify(
      {
        totalChecked: bundles.length,
        updated,
        skipped,
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
