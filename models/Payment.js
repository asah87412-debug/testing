const mongoose = require("mongoose");

// Standalone payment ledger (destination-agnostic).
// Demo/sandbox payments are recorded with demo: true and NEVER represent real money
// movement unless a verified provider callback sets providerVerified: true.
const paymentSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true, min: 0, max: 10000000 },
  currency: { type: String, default: "NPR" },
  method: {
    type: String,
    enum: ["esewa", "khalti", "imepay", "fonepay", "connectips", "prabhupay", "namastepay", "bank_card", "cash"],
    required: true,
  },
  status: {
    type: String,
    enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
    default: "PENDING",
    required: true,
    index: true,
  },
  reference: { type: String, trim: true, maxlength: 100 },
  qrPayload: { type: String, trim: true, maxlength: 500 },
  demo: { type: Boolean, default: true },
  providerVerified: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);
