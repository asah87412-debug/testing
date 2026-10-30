const express = require("express");
const mongoose = require("mongoose");
const LocalPlace = require("../models/LocalPlace");
const { isCurrentlyOpen, isOpenTwentyFourHours } = require("../utils/openingHours");
const adminAccessMiddleware = require("../middleware/adminAccess");
const { utcDayRange, slotUsageForActivity } = require("../services/inventory");

const router = express.Router();
const MODULES = ["activity", "shopping", "petrol", "hospital", "atm"];

function values(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function escapedSet(entries) {
  return { $in: entries.map((entry) => new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) };
}

router.get("/filters", async (req, res) => {
  const module = typeof req.query.module === "string" ? req.query.module : "";
  if (!MODULES.includes(module)) return res.status(400).json({ message: "Choose a supported places module." });
  try {
    const verified = { module, isDemoData: false };
    const [categories, cities, districts, provinces, difficulties, seasons, participantTypes, indoorOutdoor, services, verifiedServices, supportedNetworks] =
      await Promise.all([
        LocalPlace.distinct("category", verified),
        LocalPlace.distinct("city", verified),
        LocalPlace.distinct("district", verified),
        LocalPlace.distinct("province", verified),
        LocalPlace.distinct("difficulty", verified),
        LocalPlace.distinct("bestSeason", verified),
        LocalPlace.distinct("participantType", verified),
        LocalPlace.distinct("indoorOutdoor", verified),
        LocalPlace.distinct("services", verified),
        LocalPlace.distinct("verifiedServices", verified),
        LocalPlace.distinct("supportedNetworks", verified),
      ]);
    return res.json({
      categories: categories.filter(Boolean).sort(),
      cities: cities.filter(Boolean).sort(),
      districts: districts.filter(Boolean).sort(),
      provinces: provinces.filter(Boolean).sort(),
      difficulties: difficulties.filter(Boolean).sort(),
      seasons: seasons.filter(Boolean).sort(),
      participantTypes: participantTypes.filter(Boolean).sort(),
      indoorOutdoor: indoorOutdoor.filter(Boolean).sort(),
      services: services.filter(Boolean).sort(),
      verifiedServices: verifiedServices.filter(Boolean).sort(),
      supportedNetworks: supportedNetworks.filter(Boolean).sort(),
    });
  } catch (error) {
    console.error("Could not load verified place filters:", error);
    return res.status(500).json({ message: "Could not load filters." });
  }
});

router.get("/", async (req, res) => {
  const module = typeof req.query.module === "string" ? req.query.module : "";
  if (!MODULES.includes(module)) return res.status(400).json({ message: "Choose a supported places module." });
  const filter = { module, isDemoData: false };
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search) {
    const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = ["name", "category", "serviceType", "description", "location", "address", "city", "district", "province", "destination", "products", "services"]
      .map((field) => ({ [field]: expression }));
  }
  for (const field of ["category", "city", "district", "province", "difficulty", "bestSeason", "participantType", "indoorOutdoor", "supportedNetworks"]) {
    const selected = values(req.query[field]);
    if (selected.length) filter[field] = escapedSet(selected);
  }
  const serviceFilters = values(req.query.service);
  if (serviceFilters.length) {
    const serviceOr = serviceFilters.flatMap((service) => {
      const expression = escapedSet([service]);
      return [{ services: expression }, { verifiedServices: expression }];
    });
    filter.$and = [...(filter.$and || []), { $or: serviceOr }];
  }
  if (req.query.nearMe === "true") {
    return res.status(400).json({ message: "Near-me search is unavailable because this app has no configured location-permission and proximity search service." });
  }
  for (const field of ["minPrice", "maxPrice", "minDuration", "maxDuration"]) {
    if (req.query[field] === undefined) continue;
    const number = Number(req.query[field]);
    if (!Number.isFinite(number) || number < 0) return res.status(400).json({ message: `Enter a valid ${field} value.` });
  }
  const minPrice = req.query.minPrice === undefined ? undefined : Number(req.query.minPrice);
  const maxPrice = req.query.maxPrice === undefined ? undefined : Number(req.query.maxPrice);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    return res.status(400).json({ message: "Minimum price cannot exceed maximum price." });
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = minPrice;
    if (maxPrice !== undefined) filter.price.$lte = maxPrice;
  }
  const minDuration = req.query.minDuration === undefined ? undefined : Number(req.query.minDuration);
  const maxDuration = req.query.maxDuration === undefined ? undefined : Number(req.query.maxDuration);
  if (minDuration !== undefined && maxDuration !== undefined && minDuration > maxDuration) {
    return res.status(400).json({ message: "Minimum duration cannot exceed maximum duration." });
  }
  if (minDuration !== undefined || maxDuration !== undefined) {
    filter.durationMinutes = {};
    if (minDuration !== undefined) filter.durationMinutes.$gte = minDuration;
    if (maxDuration !== undefined) filter.durationMinutes.$lte = maxDuration;
  }
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  try {
    const entries = await LocalPlace.find(filter).sort({ name: 1 }).lean();
    let matching = entries;
    if (req.query.openNow === "true") matching = matching.filter((entry) => isCurrentlyOpen(entry.openingHours));
    if (req.query.open24Hours === "true") matching = matching.filter((entry) => isOpenTwentyFourHours(entry.openingHours));
    const total = matching.length;
    const items = matching.slice((page - 1) * limit, page * limit);
    return res.json({ items, page, limit, total });
  } catch (error) {
    console.error("Could not search verified places:", error);
    return res.status(500).json({ message: "Could not search places." });
  }
});

router.get("/:id/slots", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid place reference." });
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? new Date(`${req.query.date}T00:00:00.000Z`)
    : null;
  if (!date || Number.isNaN(date.getTime())) {
    return res.status(400).json({ message: "Provide an activity date as YYYY-MM-DD." });
  }
  try {
    const place = await LocalPlace.findOne({ _id: req.params.id, module: "activity", isDemoData: false }).lean();
    if (!place) return res.status(404).json({ message: "Verified activity listing not found." });
    const capacity = Number(place.capacityPerSlot) > 0 ? Number(place.capacityPerSlot) : 20;
    const slots = Array.isArray(place.slots) && place.slots.length > 0 ? place.slots : [null];
    const { dayStart, dayEnd } = utcDayRange(date);
    const result = [];
    for (const slot of slots) {
      const used = await slotUsageForActivity(place._id, dayStart, dayEnd, slot || undefined);
      result.push({ time: slot, capacity, booked: used, available: Math.max(0, capacity - used) });
    }
    return res.json({ activityId: place._id, date: req.query.date, slots: result });
  } catch (error) {
    console.error("Could not load activity slots:", error);
    return res.status(500).json({ message: "Could not load activity slots." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid place reference." });
  try {
    const place = await LocalPlace.findOne({ _id: req.params.id, isDemoData: false }).lean();
    if (!place) return res.status(404).json({ message: "Verified place listing not found." });
    return res.json(place);
  } catch (error) {
    console.error("Could not load place details:", error);
    return res.status(500).json({ message: "Could not load place details." });
  }
});

router.post("/", adminAccessMiddleware, async (req, res) => {
  try {
    const place = await LocalPlace.create({ ...req.body, isDemoData: false });
    return res.status(201).json(place);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.put("/:id", adminAccessMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid place reference." });
  try {
    const place = await LocalPlace.findByIdAndUpdate(req.params.id, { ...req.body, isDemoData: false }, { new: true, runValidators: true });
    if (!place) return res.status(404).json({ message: "Place listing not found." });
    return res.json(place);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", adminAccessMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid place reference." });
  try {
    const place = await LocalPlace.findByIdAndDelete(req.params.id);
    if (!place) return res.status(404).json({ message: "Place listing not found." });
    return res.json({ message: "Deleted successfully." });
  } catch (error) {
    console.error("Could not delete place:", error);
    return res.status(500).json({ message: "Could not delete place." });
  }
});

module.exports = router;
