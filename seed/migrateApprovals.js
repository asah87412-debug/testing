// One-time migration: paid bookings created before admin approval existed
// are grandfathered as approved (they were auto-confirmed under old rules).
// Run: node seed/migrateApprovals.js
require("dotenv").config();
const connectDB = require("../config/db");
const Booking = require("../models/Booking");
const TripPayment = require("../models/TripPayment");

async function migrate() {
  await connectDB();
  // Only records created before the approval fields existed match ($exists:
  // false). New records always carry approvalStatus, so re-running is safe.
  const bookings = await Booking.updateMany(
    { paymentStatus: "paid", approvalStatus: { $exists: false } },
    { $set: { approvalStatus: "approved", approvedAt: new Date() } }
  );
  const checkouts = await TripPayment.updateMany(
    { paymentStatus: "PAID", approvalStatus: { $exists: false } },
    { $set: { approvalStatus: "approved", approvedAt: new Date() } }
  );
  console.log(`Approvals migration: bookings=${bookings.modifiedCount}, checkouts=${checkouts.modifiedCount}`);
  await require("mongoose").disconnect();
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error("Approvals migration failed:", err);
    process.exit(1);
  });
}

module.exports = migrate;
