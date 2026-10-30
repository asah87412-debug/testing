const express = require("express");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Trip = require("../models/Trip");
const TripPayment = require("../models/TripPayment");
const { createBookingRecord, HttpError } = require("../services/bookingService");
const authMiddleware = require("../middleware/auth");

const router = express.Router();
router.use(authMiddleware);

const CHECKOUT_METHODS = ["esewa", "khalti", "imepay", "fonepay", "connectips", "prabhupay", "namastepay"];

// Category shown in the price breakdown / review screen.
function breakdownCategory(itemType) {
  if (itemType === "hotel") return "Hotel";
  if (itemType === "transport") return "Transportation";
  if (itemType === "activity") return "Activities";
  return "Other services";
}

// Stable key so re-pressing checkout never duplicates bookings.
function intentKey(intent) {
  const checkIn = typeof intent.checkIn === "string" ? intent.checkIn : "";
  const serviceTime = typeof intent.serviceTime === "string" ? intent.serviceTime : "";
  const roomTypeId = typeof intent.roomTypeId === "string" ? intent.roomTypeId : "";
  return [intent.itemType, String(intent.itemId || ""), checkIn, serviceTime, roomTypeId].join("|");
}

function bookingKey(booking) {
  const checkIn = booking.checkIn ? new Date(booking.checkIn).toISOString().slice(0, 10) : "";
  return [
    booking.itemType,
    String(booking.itemId || ""),
    checkIn,
    booking.serviceTime || "",
    booking.roomTypeId ? String(booking.roomTypeId) : "",
  ].join("|");
}

function buildQrPayload(checkout) {
  return (
    `SUVYATRA-SANDBOX|trip:${checkout.tripId}` +
    `|checkout:${checkout.checkoutCode}` +
    `|amount:${checkout.totalAmount}NPR` +
    `|method:${checkout.paymentMethod}`
  );
}

function checkoutResponse(checkout, bookings, trip) {
  return {
    tripPayment: checkout,
    bookings,
    trip: trip || null,
    qr: {
      payload: checkout.qrPayload,
      amount: checkout.totalAmount,
      currency: checkout.currency || "NPR",
      checkoutCode: checkout.checkoutCode,
      paymentId: checkout.paymentId,
      method: checkout.paymentMethod,
      paymentInitiated: checkout.paymentStatus !== "FAILED",
      paymentConfirmed: checkout.paymentStatus === "PAID",
      instructions: "Sandbox/test mode: no real money moves. Scan the trip QR (or enter it manually) and confirm once to pay for the whole trip.",
    },
  };
}

async function getOwnedTrip(tripId, userId) {
  if (!mongoose.isValidObjectId(tripId)) return null;
  return Trip.findOne({ _id: tripId, userId });
}

async function activeBookingsFor(tripId, userId, checkoutId) {
  return Booking.find({
    tripId,
    userId,
    paymentId: checkoutId,
    status: { $ne: "cancelled" },
  }).sort({ checkIn: 1, createdAt: 1 });
}

function computeBreakdown(bookings) {
  const groups = {};
  for (const booking of bookings) {
    const category = breakdownCategory(booking.itemType);
    if (!groups[category]) groups[category] = { category, label: category, amount: 0 };
    groups[category].amount += Number(booking.amount) || 0;
  }
  return Object.values(groups).map((group) => ({
    ...group,
    amount: Math.round(group.amount),
  }));
}

function computeTotal(bookings) {
  return Math.round(
    bookings.reduce((sum, booking) => sum + (Number(booking.amount) || 0), 0)
  );
}

/**
 * POST /api/trip-checkout/:tripId/checkout
 * Create (or idempotently re-sync) the ONE parent payment for a complete
 * trip: creates missing pending bookings, cancels deselected ones, totals.
 * Retrying never duplicates bookings.
 */
router.post("/:tripId/checkout", async (req, res) => {
  try {
    const trip = await getOwnedTrip(req.params.tripId, req.user._id);
    if (!trip) return res.status(404).json({ message: "Trip plan not found." });
    const method = req.body?.paymentMethod;
    if (!CHECKOUT_METHODS.includes(method)) {
      return res.status(400).json({ message: "Choose a trip payment method: esewa, khalti, imepay, fonepay, connectips, prabhupay, or namastepay." });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ message: "Select at least one bookable service before checkout." });
    }
    for (const item of items) {
      if (!item || !["hotel", "transport", "restaurant", "activity"].includes(item.itemType)) {
        return res.status(400).json({ message: "Checkout supports hotel, transport, restaurant, and activity services." });
      }
    }

    const paid = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
      paymentStatus: "PAID",
    });
    if (paid) {
      return res.status(409).json({ message: "This trip is already paid. All linked bookings are paid and awaiting admin approval.", tripPayment: paid });
    }

    let checkout = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
      paymentStatus: { $in: ["PENDING", "FAILED"] },
    }).sort({ createdAt: -1 });
    if (!checkout) {
      checkout = await TripPayment.create({
        userId: req.user._id,
        tripId: trip._id,
        paymentMethod: method,
        totalAmount: 0,
        currency: "NPR",
        paymentStatus: "PENDING",
        demo: true,
      });
    } else {
      checkout.paymentMethod = method;
      checkout.paymentStatus = "PENDING";
      checkout.failureReason = undefined;
    }

    // Sync bookings: reuse matches, create missing, cancel deselected.
    const existing = await Booking.find({
      tripId: trip._id,
      userId: req.user._id,
      paymentId: checkout._id,
      paymentStatus: { $ne: "paid" },
    });
    const existingByKey = new Map(existing.map((booking) => [bookingKey(booking), booking]));
    const wantedKeys = new Set();
    const failures = [];
    for (const item of items) {
      const key = intentKey(item);
      wantedKeys.add(key);
      if (existingByKey.has(key)) continue;
      try {
        const { booking } = await createBookingRecord(req.user._id, {
          ...item,
          tripId: String(trip._id),
          paymentId: String(checkout._id),
        });
        existingByKey.set(key, booking);
      } catch (error) {
        failures.push(`${item.itemType}: ${error instanceof HttpError ? error.message : "booking failed"}`);
      }
    }
    for (const booking of existing) {
      if (!wantedKeys.has(bookingKey(booking))) {
        booking.status = "cancelled";
        await booking.save();
      }
    }
    if (failures.length) {
      return res.status(409).json({ message: failures.join("\n") });
    }

    const bookings = await activeBookingsFor(trip._id, req.user._id, checkout._id);
    // Refresh the link set (deselected bookings were cancelled above).
    checkout.bookingIds = bookings.map((booking) => booking._id);
    const chargeable = bookings.filter((booking) => Number(booking.amount) > 0);
    if (!bookings.length || !chargeable.length) {
      checkout.breakdown = [];
      checkout.totalAmount = 0;
      checkout.qrPayload = undefined;
      await checkout.save();
      return res.status(409).json({
        message: "Nothing chargeable is selected. Add a hotel, transport, or activity before paying.",
        tripPayment: checkout,
        bookings,
      });
    }
    checkout.breakdown = computeBreakdown(bookings);
    checkout.totalAmount = computeTotal(chargeable);
    checkout.qrPayload = buildQrPayload(checkout);
    await checkout.save();
    await Trip.updateOne(
      { _id: trip._id },
      {
        $set: { checkoutPaymentId: checkout._id, paymentStatus: "unpaid", totalAmount: checkout.totalAmount },
        $addToSet: { bookingIds: { $each: bookings.map((booking) => booking._id) } },
      }
    );
    const updatedTrip = await Trip.findById(trip._id).lean();
    return res.status(201).json(checkoutResponse(checkout.toObject(), bookings, updatedTrip));
  } catch (error) {
    console.error("Could not create trip checkout:", error);
    return res.status(500).json({ message: "Could not create the trip checkout." });
  }
});

/**
 * POST /api/trip-checkout/:tripId/pay — (re)initiate payment for the whole
 * trip. Never creates bookings, so retries cannot duplicate anything.
 */
router.post("/:tripId/pay", async (req, res) => {
  try {
    const trip = await getOwnedTrip(req.params.tripId, req.user._id);
    if (!trip) return res.status(404).json({ message: "Trip plan not found." });
    const paid = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
      paymentStatus: "PAID",
    });
    if (paid) {
      const bookings = await activeBookingsFor(trip._id, req.user._id, paid._id);
      return res.status(409).json({
        message: "This trip is already paid. All linked bookings are paid and awaiting admin approval.",
        ...checkoutResponse(paid.toObject(), bookings, trip.toObject ? trip.toObject() : trip),
      });
    }
    const checkout = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
      paymentStatus: { $in: ["PENDING", "FAILED"] },
    }).sort({ createdAt: -1 });
    if (!checkout) {
      return res.status(404).json({ message: "No trip checkout yet. Review the trip and continue to payment first." });
    }
    const method = req.body?.paymentMethod || checkout.paymentMethod;
    if (!CHECKOUT_METHODS.includes(method)) {
      return res.status(400).json({ message: "Choose a trip payment method: esewa, khalti, imepay, fonepay, connectips, prabhupay, or namastepay." });
    }
    checkout.paymentMethod = method;
    checkout.paymentStatus = "PENDING";
    checkout.failureReason = undefined;
    checkout.qrPayload = buildQrPayload(checkout);
    await checkout.save();
    const bookings = await activeBookingsFor(trip._id, req.user._id, checkout._id);
    const freshTrip = await Trip.findById(trip._id).lean();
    return res.json(checkoutResponse(checkout.toObject(), bookings, freshTrip));
  } catch (error) {
    console.error("Could not initiate trip payment:", error);
    return res.status(500).json({ message: "Could not initiate trip payment." });
  }
});

/**
 * POST /api/trip-checkout/:tripId/confirm — the ONLY path that marks the
 * trip paid: flips the parent record to PAID and confirms EVERY linked
 * booking with the same payment reference.
 */
router.post("/:tripId/confirm", async (req, res) => {
  try {
    const trip = await getOwnedTrip(req.params.tripId, req.user._id);
    if (!trip) return res.status(404).json({ message: "Trip plan not found." });
    const checkout = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
      paymentStatus: "PENDING",
    }).sort({ createdAt: -1 });
    if (!checkout) {
      const paid = await TripPayment.findOne({
        tripId: trip._id,
        userId: req.user._id,
        paymentStatus: "PAID",
      });
      if (paid) {
        return res.status(409).json({ message: "This trip is already paid.", tripPayment: paid });
      }
      return res.status(404).json({ message: "No initiated trip payment found. Initiate payment first." });
    }
    const reference = typeof req.body?.paymentReference === "string"
      ? req.body.paymentReference.trim().slice(0, 100)
      : "";
    const bookings = await activeBookingsFor(trip._id, req.user._id, checkout._id);
    if (!bookings.length || !(checkout.totalAmount > 0)) {
      return res.status(409).json({ message: "Nothing to confirm on this trip checkout." });
    }
    // Abort on amount mismatch instead of confirming the wrong total.
    if (req.body?.amount !== undefined && Number(req.body.amount) !== Number(checkout.totalAmount)) {
      return res.status(400).json({ message: "Payment amount does not match this trip total. Please restart the payment." });
    }
    const confirmedAt = new Date();
    checkout.paymentStatus = "PAID";
    checkout.referenceId = reference || `DEMO-TRIP-${Date.now().toString().slice(-6)}`;
    checkout.completedAt = confirmedAt;
    // Payment success does NOT approve the trip. The bundle waits for admin
    // accept/reject; the deadline is computed from backend time (120 min).
    checkout.approvalStatus = "pending";
    checkout.submittedForApprovalAt = confirmedAt;
    checkout.approvalDeadline = new Date(confirmedAt.getTime() + 120 * 60 * 1000);
    await checkout.save();
    await Booking.updateMany(
      { _id: { $in: bookings.map((booking) => booking._id) } },
      {
        $set: {
          paymentStatus: "paid",
          status: "pending",
          approvalStatus: "pending",
          submittedForApprovalAt: confirmedAt,
          approvalDeadline: new Date(confirmedAt.getTime() + 120 * 60 * 1000),
          paymentMethod: checkout.paymentMethod,
          paymentReference: checkout.referenceId,
          paymentConfirmedAt: confirmedAt,
        },
      }
    );
    await Trip.updateOne(
      { _id: trip._id },
      { $set: { paymentStatus: "paid", totalAmount: checkout.totalAmount, checkoutPaymentId: checkout._id } }
    );
    const freshBookings = await activeBookingsFor(trip._id, req.user._id, checkout._id);
    const freshTrip = await Trip.findById(trip._id).lean();
    return res.json({
      ...checkoutResponse(checkout.toObject(), freshBookings, freshTrip),
      paymentInitiated: true,
      paymentConfirmed: true,
      message: "Trip payment successful — every selected service is now paid and waiting for admin approval (sandbox record only).",
    });
  } catch (error) {
    console.error("Could not confirm trip payment:", error);
    return res.status(500).json({ message: "Could not confirm trip payment." });
  }
});

/**
 * POST /api/trip-checkout/:tripId/fail — record a failed/cancelled attempt.
 * Bookings stay pending so the user can retry without duplicates.
 */
router.post("/:tripId/fail", async (req, res) => {
  try {
    const trip = await getOwnedTrip(req.params.tripId, req.user._id);
    if (!trip) return res.status(404).json({ message: "Trip plan not found." });
    const checkout = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
      paymentStatus: "PENDING",
    }).sort({ createdAt: -1 });
    if (!checkout) return res.status(404).json({ message: "No pending trip payment to fail." });
    checkout.paymentStatus = "FAILED";
    checkout.failureReason = typeof req.body?.reason === "string"
      ? req.body.reason.slice(0, 300)
      : "Payment failed or was cancelled.";
    await checkout.save();
    await Trip.updateOne({ _id: trip._id }, { $set: { paymentStatus: "failed" } });
    const bookings = await activeBookingsFor(trip._id, req.user._id, checkout._id);
    return res.json({ tripPayment: checkout.toObject(), bookings });
  } catch (error) {
    console.error("Could not record trip payment failure:", error);
    return res.status(500).json({ message: "Could not record trip payment failure." });
  }
});

/**
 * GET /api/trip-checkout/:tripId — current checkout + linked bookings.
 */
router.get("/:tripId", async (req, res) => {
  try {
    const trip = await getOwnedTrip(req.params.tripId, req.user._id);
    if (!trip) return res.status(404).json({ message: "Trip plan not found." });
    const checkout = await TripPayment.findOne({
      tripId: trip._id,
      userId: req.user._id,
    }).sort({ createdAt: -1 }).lean();
    if (!checkout) return res.status(404).json({ message: "No trip checkout yet." });
    const bookings = await Booking.find({
      _id: { $in: checkout.bookingIds || [] },
      status: { $ne: "cancelled" },
    }).sort({ checkIn: 1, createdAt: 1 }).lean();
    return res.json({ tripPayment: checkout, bookings, trip });
  } catch (error) {
    console.error("Could not load trip checkout:", error);
    return res.status(500).json({ message: "Could not load trip checkout." });
  }
});

module.exports = router;


