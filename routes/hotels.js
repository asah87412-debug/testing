const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Hotel = require("../models/Hotel");
const { addRoomAvailability } = require("../services/hotelAvailability");
const { validateGuestCounts } = require("../utils/quantityValidation");
const makeCrud = require("../controllers/crudFactory");
const adminAccessMiddleware = require("../middleware/adminAccess");

const crud = makeCrud(Hotel, {
  searchable: [
    "name",
    "city",
    "district",
    "province",
    "destination",
    "location",
    "description",
    "propertyTypes",
    "nearbyAttractions",
  ],
});

function parseValues(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function parseAvailabilityQuery(query) {
  const keys = ["checkIn", "checkOut", "adults", "children", "rooms"];
  if (keys.some((key) => query[key] === undefined)) return null;
  const checkIn = parseDateOnly(query.checkIn);
  const checkOut = parseDateOnly(query.checkOut);
  const adults = Number(query.adults);
  const children = Number(query.children);
  const rooms = Number(query.rooms);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (
    !checkIn ||
    !checkOut ||
    checkIn < today ||
    checkOut <= checkIn ||
    !validateGuestCounts(adults, children, rooms)
  ) return null;
  return { checkIn, checkOut, adults, children, rooms };
}

function exactValues(values) {
  return { $in: values.map((value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) };
}

function parseSearch(value) {
  const match = value.match(
    /^(?:(budget(?:-friendly)?|luxury)\s+)?(hotels?|resorts?|hostels?|homestays?|mountain lodges?|lodges?|camping(?:\s*&\s*glamping)?|glamping|eco stays?|heritage stays?|workation stays?|family stays?|pet-friendly stays?|budget stays?)\s+(?:(?:in|near)\s+)?(.+)$/i
  );
  if (!match) return { term: value, propertyType: "" };
  const descriptor = `${match[1] || ""} ${match[2]}`.trim().toLocaleLowerCase();
  const types = {
    "budget hotel": "Budget Stays?",
    "budget hotels": "Budget Stays?",
    "budget-friendly hotel": "Budget Stays?",
    "budget-friendly hotels": "Budget Stays?",
    "budget stay": "Budget Stays?",
    "budget stays": "Budget Stays?",
    "luxury hotel": "Luxury Hotels?",
    "luxury hotels": "Luxury Hotels?",
    hotel: "Hotels?",
    hotels: "Hotels?",
    resort: "Resorts?",
    resorts: "Resorts?",
    hostel: "Hostels?",
    hostels: "Hostels?",
    homestay: "Homestays?",
    homestays: "Homestays?",
    lodge: "Lodges?",
    lodges: "Lodges?",
    "mountain lodge": "Mountain Lodges?",
    "mountain lodges": "Mountain Lodges?",
    camping: "Camping",
    "camping & glamping": "Camping & Glamping",
    glamping: "Glamping",
    "eco stay": "Eco Stays?",
    "eco stays": "Eco Stays?",
    "heritage stay": "Heritage Stays?",
    "heritage stays": "Heritage Stays?",
    "workation stay": "Workation Stays?",
    "workation stays": "Workation Stays?",
    "family stay": "Family Stays?",
    "family stays": "Family Stays?",
    "pet-friendly stay": "Pet-Friendly Stays?",
    "pet-friendly stays": "Pet-Friendly Stays?",
  };
  return { term: match[3].trim(), propertyType: types[descriptor] || "" };
}

router.get("/filters", async (_req, res) => {
  try {
    const match = { available: { $ne: false } };
    const [cities, districts, provinces, destinations, propertyTypes, amenities, travelerTypes, specialFeatures] =
      await Promise.all([
        Hotel.distinct("city", match),
        Hotel.distinct("district", match),
        Hotel.distinct("province", match),
        Hotel.distinct("destination", match),
        Hotel.distinct("propertyTypes", match),
        Hotel.distinct("amenities", match),
        Hotel.distinct("travelerTypes", match),
        Hotel.distinct("specialFeatures", match),
      ]);
    return res.json({
      cities: cities.filter(Boolean).sort(),
      districts: districts.filter(Boolean).sort(),
      provinces: provinces.filter(Boolean).sort(),
      destinations: destinations.filter(Boolean).sort(),
      propertyTypes: propertyTypes.filter(Boolean).sort(),
      facilities: amenities.filter(Boolean).sort(),
      travelerTypes: travelerTypes.filter(Boolean).sort(),
      specialFeatures: specialFeatures.filter(Boolean).sort(),
    });
  } catch (error) {
    console.error("Could not load hotel filters:", error);
    return res.status(500).json({ message: "Could not load hotel filters." });
  }
});

router.get("/", async (req, res) => {
  const availabilityKeys = ["checkIn", "checkOut", "adults", "children", "rooms"];
  const hasAvailabilitySearch = availabilityKeys.some((key) => req.query[key] !== undefined);
  let availabilitySearch;
  if (hasAvailabilitySearch) {
    if (availabilityKeys.some((key) => req.query[key] === undefined)) {
      return res.status(400).json({ message: "Provide check-in, check-out, adults, children, and rooms to search availability." });
    }
    availabilitySearch = parseAvailabilityQuery(req.query);
    if (!availabilitySearch) {
      return res.status(400).json({ message: "Enter valid future dates, 1–20 adults, 0–20 children, and 1–10 rooms (20 guests maximum)." });
    }
  }

  const filter = {
    available: { $ne: false },
  };
  const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const parsedSearch = parseSearch(rawSearch);
  const search = parsedSearch.term;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "i");
    filter.$or = [
      { name: expression },
      { city: expression },
      { district: expression },
      { province: expression },
      { destination: expression },
      { location: expression },
      { description: expression },
      { propertyTypes: expression },
      { nearbyAttractions: expression },
    ];
  }

  for (const [queryKey, dbKey] of [
    ["city", "city"],
    ["district", "district"],
    ["province", "province"],
    ["destination", "destination"],
  ]) {
    const values = parseValues(req.query[queryKey]);
    if (values.length) filter[dbKey] = exactValues(values);
  }
  const propertyTypes = parseValues(req.query.propertyType);
  if (propertyTypes.length) filter.propertyTypes = exactValues(propertyTypes);
  if (parsedSearch.propertyType) {
    const inferred = { propertyTypes: new RegExp(`^${parsedSearch.propertyType}$`, "i") };
    if (filter.propertyTypes) {
      filter.$and = [{ propertyTypes: filter.propertyTypes }, inferred];
      delete filter.propertyTypes;
    } else {
      filter.propertyTypes = inferred.propertyTypes;
    }
  }
  const facilities = parseValues(req.query.facility);
  if (facilities.length) filter.amenities = exactValues(facilities);
  const travelerTypes = parseValues(req.query.travelerType);
  if (travelerTypes.length) filter.travelerTypes = exactValues(travelerTypes);
  const specialFeatures = parseValues(req.query.specialFeature);
  if (specialFeatures.length) filter.specialFeatures = exactValues(specialFeatures);

  const minPrice = req.query.minPrice === undefined ? undefined : Number(req.query.minPrice);
  const maxPrice = req.query.maxPrice === undefined ? undefined : Number(req.query.maxPrice);
  if (
    (minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0)) ||
    (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0)) ||
    (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)
  ) {
    return res.status(400).json({ message: "Enter a valid hotel price range." });
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.pricePerNight = {};
    if (minPrice !== undefined) filter.pricePerNight.$gte = minPrice;
    if (maxPrice !== undefined) filter.pricePerNight.$lte = maxPrice;
  }

  const sort = req.query.sort;
  let sortBy = { name: 1 };
  if (sort === "price-asc") sortBy = { pricePerNight: 1, name: 1 };
  else if (sort === "price-desc") sortBy = { pricePerNight: -1, name: 1 };
  else if (sort === "newest") sortBy = { createdAt: -1 };
  else if (sort === "relevance" && search) {
    sortBy = { name: 1 };
  }

  try {
    let hotels = (await Hotel.find(filter).sort(sortBy).lean()).map((hotel) => ({
      ...hotel,
      isDemoData: hotel.isDemoData !== false,
    }));
    if (availabilitySearch) {
      hotels = await addRoomAvailability(hotels, availabilitySearch);
    }
    if (sort === "relevance" && search) {
      const terms = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const score = (hotel) => {
        const fields = [
          hotel.name,
          hotel.location,
          hotel.city,
          hotel.district,
          hotel.province,
          hotel.destination,
          ...(hotel.nearbyAttractions || []),
        ].map((value) => (value || "").toLocaleLowerCase());
        return terms.reduce((total, term) => total + (
          fields[0] === term ? 10 :
            fields[0]?.startsWith(term) ? 7 :
              fields.some((value) => value === term) ? 5 :
                fields.some((value) => value.includes(term)) ? 2 : 0
        ), 0);
      };
      hotels.sort((left, right) => score(right) - score(left) || left.name.localeCompare(right.name));
    }
    return res.json(hotels);
  } catch (error) {
    console.error("Could not search hotels:", error);
    return res.status(500).json({ message: "Could not search hotels." });
  }
});

router.get("/:id/availability", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid hotel reference." });
  }
  const availabilitySearch = parseAvailabilityQuery(req.query);
  if (!availabilitySearch) {
    return res.status(400).json({ message: "Provide valid future check-in/check-out dates, adults, children, and rooms." });
  }
  try {
    const hotel = await Hotel.findOne({ _id: req.params.id, available: { $ne: false } }).lean();
    if (!hotel) return res.status(404).json({ message: "Hotel not found or unavailable." });
    const [result] = await addRoomAvailability([hotel], availabilitySearch, { includeUnavailable: true });
    return res.json({
      hotelId: hotel._id,
      roomTypes: result.roomTypes,
      availableForSearch: result.availableForSearch,
    });
  } catch (error) {
    console.error("Could not check hotel room availability:", error);
    return res.status(500).json({ message: "Could not check hotel room availability." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid hotel reference." });
  }
  try {
    const record = await Hotel.findById(req.params.id).lean();
    const hotel = record ? { ...record, isDemoData: record.isDemoData !== false } : null;
    if (!hotel) return res.status(404).json({ message: "Hotel not found." });
    return res.json(hotel);
  } catch (error) {
    console.error("Could not load hotel details:", error);
    return res.status(500).json({ message: "Could not load hotel details." });
  }
});

router.post("/", adminAccessMiddleware, crud.create);
router.put("/:id", adminAccessMiddleware, crud.update);
router.delete("/:id", adminAccessMiddleware, crud.remove);

module.exports = router;
