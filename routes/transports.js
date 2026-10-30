const express = require("express");
const mongoose = require("mongoose");
const Transport = require("../models/Transport");
const adminAccessMiddleware = require("../middleware/adminAccess");
const { utcDayRange, seatLabelsForTransport, bookedSeatsForTransport } = require("../services/inventory");

const router = express.Router();

function values(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function exact(valuesToMatch) {
  return { $in: valuesToMatch.map((value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) };
}

router.get("/filters", async (_req, res) => {
  try {
    const verified = { isDemoData: false };
    const [types, origins, destinations, serviceModes] = await Promise.all([
      Transport.distinct("type", verified),
      Transport.distinct("origin", verified),
      Transport.distinct("destination", verified),
      Transport.distinct("serviceMode", verified),
    ]);
    return res.json({
      types: types.filter(Boolean).sort(),
      origins: origins.filter(Boolean).sort(),
      destinations: destinations.filter(Boolean).sort(),
      serviceModes: serviceModes.filter(Boolean).sort(),
    });
  } catch (error) {
    console.error("Could not load transport filters:", error);
    return res.status(500).json({ message: "Could not load transport filters." });
  }
});

router.get("/", async (req, res) => {
  // Browse results list only bookable services: records without a confirmed
  // fare cannot be booked (booking is rejected with 409), so showing them
  // with "Price unavailable" only produces dead ends. Detail/seats endpoints
  // below still resolve such records directly with their honest fields.
  const filter = { isDemoData: false, price: { $exists: true, $ne: null } };
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search) {
    const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = ["name", "type", "provider", "route", "origin", "destination", "description"]
      .map((field) => ({ [field]: expression }));
  }
  for (const field of ["type", "origin", "destination", "serviceMode"]) {
    const selected = values(req.query[field]);
    if (selected.length) {
      filter[field] = field === "origin" || field === "destination"
        ? { $in: selected.map((value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) }
        : exact(selected);
    }
  }
  if (req.query.sort === "cheapest") {
    // Listings without a verified price sort after listings with a price.
  } else if (req.query.sort && req.query.sort !== "duration") {
    return res.status(400).json({ message: "Unsupported transport sort option." });
  }
  if (req.query.available === "true") {
    return res.status(400).json({ message: "Live transport availability is not provided by the current API." });
  }

  try {
    const records = await Transport.find(filter).sort({ name: 1 }).limit(500).lean();
    if (req.query.sort === "duration") {
      records.sort((left, right) => {
        if (left.durationMinutes === undefined && right.durationMinutes !== undefined) return 1;
        if (right.durationMinutes === undefined && left.durationMinutes !== undefined) return -1;
        return (left.durationMinutes ?? 0) - (right.durationMinutes ?? 0) || left.name.localeCompare(right.name);
      });
    } else if (req.query.sort === "cheapest") {
      records.sort((left, right) => {
        if (left.price === undefined && right.price !== undefined) return 1;
        if (right.price === undefined && left.price !== undefined) return -1;
        return (left.price ?? 0) - (right.price ?? 0) || left.name.localeCompare(right.name);
      });
    }
    const results = records.slice(0, 100);
    return res.json(results);
  } catch (error) {
    console.error("Could not search transport listings:", error);
    return res.status(500).json({ message: "Could not search transport listings." });
  }
});

router.get("/:id/seats", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid transport reference." });
  }
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? new Date(`${req.query.date}T00:00:00.000Z`)
    : null;
  if (!date || Number.isNaN(date.getTime())) {
    return res.status(400).json({ message: "Provide a travel date as YYYY-MM-DD." });
  }
  try {
    const transport = await Transport.findOne({ _id: req.params.id, isDemoData: false }).lean();
    if (!transport) return res.status(404).json({ message: "Verified transport listing not found." });
    const seatMap = seatLabelsForTransport(transport);
    const { dayStart, dayEnd } = utcDayRange(date);
    const { bookedSeats, bookedGuestCount } = await bookedSeatsForTransport(transport._id, dayStart, dayEnd);
    const capacity = Number(transport.capacity) || (seatMap ? seatMap.length : 0);
    if (!seatMap) {
      return res.json({
        transportId: transport._id,
        seatSelection: false,
        capacity,
        booked: bookedGuestCount,
        available: Math.max(0, capacity - bookedGuestCount),
      });
    }
    const taken = new Set(bookedSeats);
    return res.json({
      transportId: transport._id,
      seatSelection: true,
      capacity: seatMap.length,
      booked: bookedSeats.length,
      available: Math.max(0, seatMap.length - bookedSeats.length),
      seats: seatMap.map((label) => ({ label, booked: taken.has(label) })),
    });
  } catch (error) {
    console.error("Could not load seat availability:", error);
    return res.status(500).json({ message: "Could not load seat availability." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid transport reference." });
  }
  try {
    const transport = await Transport.findOne({ _id: req.params.id, isDemoData: false }).lean();
    if (!transport) return res.status(404).json({ message: "Verified transport listing not found." });
    return res.json(transport);
  } catch (error) {
    console.error("Could not load transport details:", error);
    return res.status(500).json({ message: "Could not load transport details." });
  }
});

router.post("/", adminAccessMiddleware, async (req, res) => {
  try {
    const transport = await Transport.create({ ...req.body, isDemoData: false });
    return res.status(201).json(transport);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.put("/:id", adminAccessMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid transport reference." });
  }
  try {
    const transport = await Transport.findByIdAndUpdate(
      req.params.id,
      { ...req.body, isDemoData: false },
      { new: true, runValidators: true }
    );
    if (!transport) return res.status(404).json({ message: "Transport listing not found." });
    return res.json(transport);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", adminAccessMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid transport reference." });
  }
  try {
    const transport = await Transport.findByIdAndDelete(req.params.id);
    if (!transport) return res.status(404).json({ message: "Transport listing not found." });
    return res.json({ message: "Deleted successfully." });
  } catch (error) {
    console.error("Could not delete transport listing:", error);
    return res.status(500).json({ message: "Could not delete transport listing." });
  }
});

module.exports = router;
