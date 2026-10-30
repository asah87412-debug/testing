const mongoose = require("mongoose");
const crypto = require("node:crypto");

const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["hotel", "flight", "transport", "restaurant", "activity", "trip"], required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId },
  roomTypeId: { type: mongoose.Schema.Types.ObjectId },
  roomTypeName: { type: String, trim: true, maxlength: 100 },
  itemName: { type: String, required: true, trim: true, maxlength: 160 },
  location: { type: String, trim: true, maxlength: 200 },
  // Image snapshot of the booked service at booking time, so My Bookings
  // and confirmations always render an image even if the source listing
  // image or the live image resolver becomes unavailable later.
  image: { type: String, trim: true },
  images: [{ type: String, trim: true }],
  imageSource: { type: String, trim: true },
  imageSourcePage: { type: String, trim: true },
  imageLicense: { type: String, trim: true },
  imageCredit: { type: String, trim: true },
  imageDescription: { type: String, trim: true },
  imageRelevance: { type: String, enum: ["entity", "category"] },
  checkIn: Date,
  checkOut: Date,
  serviceTime: { type: String, trim: true, maxlength: 20 },
  // Transport seat selection (e.g. ["1A", "1B"]). Empty when the service has no seat map.
  seatNumbers: [{ type: String, trim: true, maxlength: 10 }],
  // Restaurant table reservation (e.g. "T4").
  tableLabel: { type: String, trim: true, maxlength: 20 },
  // Optional link to the trip plan this booking belongs to (unified trip summary).
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", index: true },
  // Optional link to the parent complete-trip checkout (one payment for the
  // whole trip). Standalone bookings leave this unset and keep their own
  // per-booking payment flow.
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "TripPayment", index: true },
  guests: { type: Number, default: 1, min: 1, max: 12 },
  adults: { type: Number, min: 1, max: 12 },
  children: { type: Number, min: 0, max: 12 },
  // Participant ages for age-restricted activities, in passenger order.
  // Stored at booking time so payment confirmation can re-verify eligibility.
  participantAges: [{ type: Number, min: 0, max: 120 }],
  rooms: { type: Number, min: 1, max: 10, default: 1 },
  amount: { type: Number, required: true, min: 0, max: 10000000 },
  currency: { type: String, default: "NPR" },
  // Trip origin (for complete-trip records; mirrors the linked Trip).
  origin: { type: String, trim: true, maxlength: 200 },
  originDetails: { type: mongoose.Schema.Types.Mixed },
  paymentMethod: {
    type: String,
    enum: ["esewa", "khalti", "imepay", "fonepay", "connectips", "prabhupay", "namastepay", "bank_card"],
  },
  paymentStatus: {
    type: String,
    enum: ["not_configured", "pending", "paid", "failed", "refunded"],
    default: "not_configured",
    required: true,
  },
  paymentReference: { type: String, trim: true, maxlength: 100 },
  paymentInitiatedAt: Date,
  paymentConfirmedAt: Date,
  sandboxPayment: { type: Boolean, default: false },
  amountIsEstimate: { type: Boolean, default: false },
  status: { type: String, enum: ["pending", "confirmed", "accepted", "rejected", "cancelled", "completed"], default: "pending" },
  bookingCode: { type: String, unique: true, required: true },
  // Admin approval is SEPARATE from payment. A paid trip booking waits for
  // admin accept/reject; standalone single-service bookings are approved
  // automatically at confirm time (approvalStatus "approved").
  approvalStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
    required: true,
    index: true,
  },
  submittedForApprovalAt: Date,
  approvalDeadline: Date,
  approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  rejectedAt: Date,
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  rejectionReason: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true });

bookingSchema.pre("validate", function () {
  if (!this.bookingCode) {
    this.bookingCode = `SVY-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  }
});

module.exports = mongoose.model("Booking", bookingSchema);
