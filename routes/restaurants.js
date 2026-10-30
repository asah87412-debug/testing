const express = require("express");
const mongoose = require("mongoose");
const Restaurant = require("../models/Restaurant");
const adminAccessMiddleware = require("../middleware/adminAccess");
const { isCurrentlyOpen } = require("../utils/openingHours");
const { utcDayRange, reservedTablesForRestaurant } = require("../services/inventory");

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
    const [cities, districts, provinces, cuisines, categories, foodTypes, mealTimes, facilities, priceRanges] =
      await Promise.all([
        Restaurant.distinct("city", verified),
        Restaurant.distinct("district", verified),
        Restaurant.distinct("province", verified),
        Restaurant.distinct("cuisine", verified),
        Restaurant.distinct("category", verified),
        Restaurant.distinct("foodTypes", verified),
        Restaurant.distinct("mealTimes", verified),
        Restaurant.distinct("facilities", verified),
        Restaurant.distinct("priceRange", verified),
      ]);
    return res.json({
      cities: cities.filter(Boolean).sort(),
      districts: districts.filter(Boolean).sort(),
      provinces: provinces.filter(Boolean).sort(),
      cuisines: cuisines.filter(Boolean).sort(),
      categories: categories.filter(Boolean).sort(),
      foodTypes: foodTypes.filter(Boolean).sort(),
      mealTimes: mealTimes.filter(Boolean).sort(),
      facilities: facilities.filter(Boolean).sort(),
      priceRanges: priceRanges.filter(Boolean).sort(),
    });
  } catch (error) {
    console.error("Could not load restaurant filters:", error);
    return res.status(500).json({ message: "Could not load restaurant filters." });
  }
});

router.get("/", async (req, res) => {
  const filter = { isDemoData: false };
  let search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search) {
    if (/\bvegetarian\b/i.test(search)) {
      filter.foodTypes = exact(["Vegetarian"]);
      search = search.replace(/\bvegetarian\b/ig, "");
    }
    if (/\bvegan\b/i.test(search)) {
      filter.foodTypes = exact(["Vegan"]);
      search = search.replace(/\bvegan\b/ig, "");
    }
    if (/\bbreakfast\b/i.test(search)) {
      filter.mealTimes = exact(["Breakfast"]);
      search = search.replace(/\bbreakfast\b/ig, "");
    } else if (/\blunch\b/i.test(search)) {
      filter.mealTimes = exact(["Lunch"]);
      search = search.replace(/\blunch\b/ig, "");
    } else if (/\bdinner\b/i.test(search)) {
      filter.mealTimes = exact(["Dinner"]);
      search = search.replace(/\bdinner\b/ig, "");
    }
    const terms = search
      .replace(/\b(restaurants?|food|cafes?|dining|in|near|around|for|the)\b/ig, " ")
      .split(/\s+/)
      .map((term) => term.trim().replace(/^[,.:;]+|[,.:;]+$/g, ""))
      .filter(Boolean);
    const searchableFields = [
      "name", "category", "location", "address", "city", "district", "province",
      "destination", "cuisine", "foodTypes", "description", "nearbyAttractions",
    ];
    if (terms.length) {
      filter.$and = terms.map((term) => {
        const expression = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        return { $or: searchableFields.map((field) => ({ [field]: expression })) };
      });
    }
  }

  for (const field of ["city", "district", "province", "category", "cuisine", "foodType", "mealTime", "facility", "priceRange"]) {
    const selected = values(req.query[field]);
    if (!selected.length) continue;
    const dbField = field === "foodType" ? "foodTypes" : field === "mealTime" ? "mealTimes" : field;
    filter[dbField] = exact(selected);
  }
  for (const field of ["vegetarian", "vegan"]) {
    if (req.query[field] === "true") filter.foodTypes = exact([field]);
  }
  try {
    const records = await Restaurant.find(filter).sort({ name: 1 }).limit(500).lean();
    const openNowRecords = req.query.openNow === "true"
      ? records.filter((record) => isCurrentlyOpen(record.openingHours))
      : records;
    const limitedRecords = openNowRecords.slice(0, 100);
    return res.json(limitedRecords);
  } catch (error) {
    console.error("Could not search restaurants:", error);
    return res.status(500).json({ message: "Could not search restaurants." });
  }
});

router.get("/:id/tables", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid restaurant reference." });
  }
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? new Date(`${req.query.date}T00:00:00.000Z`)
    : null;
  if (!date || Number.isNaN(date.getTime())) {
    return res.status(400).json({ message: "Provide a reservation date as YYYY-MM-DD." });
  }
  // Time slot is optional: without it, tables reserved for ANY time that day are shown.
  const time = typeof req.query.time === "string" ? req.query.time.trim().slice(0, 20) : "";
  try {
    const restaurant = await Restaurant.findOne({ _id: req.params.id, isDemoData: false }).lean();
    if (!restaurant) return res.status(404).json({ message: "Verified restaurant listing not found." });
    const tables = Array.isArray(restaurant.tables) ? restaurant.tables : [];
    const { dayStart, dayEnd } = utcDayRange(date);
    const reserved = await reservedTablesForRestaurant(restaurant._id, dayStart, dayEnd, time || undefined);
    const reservedSet = new Set(reserved.map((label) => String(label).toUpperCase()));
    return res.json({
      restaurantId: restaurant._id,
      date: req.query.date,
      time: time || null,
      tables: tables.map((table) => ({
        label: table.label,
        seats: table.seats,
        reserved: reservedSet.has(String(table.label).toUpperCase()),
      })),
    });
  } catch (error) {
    console.error("Could not load table availability:", error);
    return res.status(500).json({ message: "Could not load table availability." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid restaurant reference." });
  }
  try {
    const restaurant = await Restaurant.findOne({ _id: req.params.id, isDemoData: false }).lean();
    if (!restaurant) return res.status(404).json({ message: "Verified restaurant listing not found." });
    return res.json(restaurant);
  } catch (error) {
    console.error("Could not load restaurant:", error);
    return res.status(500).json({ message: "Could not load restaurant." });
  }
});

router.post("/", adminAccessMiddleware, async (req, res) => {
  try {
    const restaurant = await Restaurant.create({ ...req.body, isDemoData: false });
    return res.status(201).json(restaurant);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.put("/:id", adminAccessMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid restaurant reference." });
  }
  try {
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      { ...req.body, isDemoData: false },
      { new: true, runValidators: true }
    );
    if (!restaurant) return res.status(404).json({ message: "Restaurant not found." });
    return res.json(restaurant);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", adminAccessMiddleware, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid restaurant reference." });
  }
  try {
    const restaurant = await Restaurant.findByIdAndDelete(req.params.id);
    if (!restaurant) return res.status(404).json({ message: "Restaurant not found." });
    return res.json({ message: "Deleted successfully." });
  } catch (error) {
    console.error("Could not delete restaurant:", error);
    return res.status(500).json({ message: "Could not delete restaurant." });
  }
});

module.exports = router;
