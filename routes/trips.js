const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Trip = require("../models/Trip");
const Hotel = require("../models/Hotel");
const Destination = require("../models/Destination");
const Restaurant = require("../models/Restaurant");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const authMiddleware = require("../middleware/auth");
const {
  makeItineraryEntity,
  makePlan,
  matchesDestination,
  distanceKm,
  validatePlanRequest,
} = require("../services/tripPlanner");
const {
  findValidDestination,
  findValidLocation,
  parseStrictDate,
  todayISO,
} = require("../utils/tripValidation");

async function canonicalizeItinerary(days, destination, durationDays) {
  const types = {
    destination: (id) => Destination.findById(id).lean(),
    activity: (id) => LocalPlace.findOne({ _id: id, module: "activity", isDemoData: false }).lean(),
    restaurant: (id) => Restaurant.findOne({ _id: id, isDemoData: false }).lean(),
  };
  const timeBlocks = new Set(["Morning", "Afternoon", "Evening"]);
  const normalizedDays = [];
  for (const day of days) {
    if (!Number.isInteger(day.day) || day.day > (durationDays ?? 14) || !Array.isArray(day.items) || day.items.length > 3) {
      return { error: "The itinerary contains an invalid day or too many stops." };
    }
    const items = [];
    for (const item of day.items) {
      if (!item || typeof item.entityType !== "string" || !Object.hasOwn(types, item.entityType) ||
          !mongoose.isValidObjectId(item.entityId)) {
        return { error: "Every itinerary stop must reference a real stored place." };
      }
      const record = await types[item.entityType](item.entityId);
      if (!record || !matchesDestination(record, destination)) {
        return { error: "An itinerary stop no longer matches a stored listing for this destination." };
      }
      const canonicalItem = {
        ...makeItineraryEntity(record, item.entityType),
        suggestedTimeOfDay: timeBlocks.has(item.suggestedTimeOfDay) ? item.suggestedTimeOfDay : undefined,
      };
      if (items.length) {
        canonicalItem.distanceFromPreviousKm = distanceKm(items[items.length - 1], canonicalItem);
      }
      items.push(canonicalItem);
    }
    normalizedDays.push({
      day: day.day,
      date: typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : undefined,
      focus: typeof day.focus === "string" ? day.focus.slice(0, 120) : undefined,
      guidance: day.guidance && typeof day.guidance === "object"
        ? Object.fromEntries(["Morning", "Afternoon", "Evening"]
          .filter((period) => typeof day.guidance[period] === "string")
          .map((period) => [period, day.guidance[period].slice(0, 240)]))
        : undefined,
      items,
    });
  }
  return { value: normalizedDays };
}

async function canonicalizeRecommendations(recommendations, destination, itinerary = [], durationDays = 1, travelerCount = 1) {
  const hotels = [];
  const transport = [];
  const restaurants = [];
  for (const item of recommendations?.hotels ?? []) {
    if (!item || !mongoose.isValidObjectId(item.entityId)) return { error: "A hotel recommendation has an invalid listing reference." };
    const hotel = await Hotel.findOne({
      _id: item.entityId,
      isDemoData: false,
      available: { $ne: false },
    }).lean();
    if (!hotel || !matchesDestination(hotel, destination)) {
      return { error: "A hotel recommendation is no longer available as a verified listing." };
    }
    hotels.push({
      ...makeItineraryEntity(hotel, "hotel"),
      pricePerNight: Number.isFinite(hotel.pricePerNight) ? hotel.pricePerNight : undefined,
      rating: hotel.rating,
      isDemoData: false,
    });
  }
  for (const item of recommendations?.transport ?? []) {
    if (!item || !mongoose.isValidObjectId(item.entityId)) return { error: "A transport recommendation has an invalid listing reference." };
    const record = await Transport.findOne({ _id: item.entityId, isDemoData: false }).lean();
    if (!record || !matchesDestination(record, destination)) {
      return { error: "A transport recommendation is no longer a verified listing." };
    }
    transport.push({
      ...makeItineraryEntity(record, "transport"),
      type: record.type,
      provider: record.provider,
      route: record.route,
      origin: record.origin,
      destination: record.destination,
      price: Number.isFinite(record.price) ? record.price : undefined,
    });
  }
  for (const item of recommendations?.restaurants ?? []) {
    if (!item || !mongoose.isValidObjectId(item.entityId)) return { error: "A restaurant recommendation has an invalid listing reference." };
    const restaurant = await Restaurant.findOne({ _id: item.entityId, isDemoData: false }).lean();
    if (!restaurant || !matchesDestination(restaurant, destination)) {
      return { error: "A restaurant recommendation is no longer available as a verified listing." };
    }
    restaurants.push({
      ...makeItineraryEntity(restaurant, "restaurant"),
      cuisine: restaurant.cuisine,
      priceLevel: restaurant.priceLevel,
    });
  }
  const listedActivityCosts = itinerary.flatMap((day) => day.items)
    .filter((item) => item.entityType === "activity" && Number.isFinite(item.estimatedCost))
    .reduce((sum, item) => sum + item.estimatedCost, 0);
  const nights = Math.max(durationDays - 1, 0);
  const lowestPricedHotel = hotels.filter((hotel) => Number.isFinite(hotel.pricePerNight))
    .sort((first, second) => first.pricePerNight - second.pricePerNight)[0];
  const accommodation = lowestPricedHotel && nights > 0 ? lowestPricedHotel.pricePerNight * nights : null;
  const total = listedActivityCosts + (accommodation ?? 0);
  return {
    value: {
      hotels: hotels.slice(0, 5),
      transport: transport.slice(0, 5),
      restaurants: restaurants.slice(0, 5),
      weather: { available: false, message: "A forecast is not available for these trip dates." },
      costSummary: {
        currency: "NPR",
        listedActivityCosts,
        accommodation,
        transportation: null,
        food: null,
        bookingFees: null,
        total,
        perPerson: travelerCount > 0 ? total / travelerCount : total,
        perDay: durationDays > 0 ? total / durationDays : total,
        note: "Known-price estimate only. It includes listed activity prices and, when available, one room at the lowest listed nightly rate. Transport options, food, booking fees, and live room availability are not included.",
      },
    },
  };
}

async function loadPlannerRecords(destination) {
  const [destinations, restaurants, activities, hotels, transport] = await Promise.all([
      Destination.find({}).limit(1000).lean(),
      Restaurant.find({ isDemoData: false }).limit(1000).lean(),
      LocalPlace.find({ module: "activity", isDemoData: false }).limit(1000).lean(),
      Hotel.find({ isDemoData: false, available: { $ne: false } }).limit(1000).lean(),
      Transport.find({ isDemoData: false }).limit(1000).lean(),
    ]);
  return {
    destinations: destinations.filter((item) => matchesDestination(item, destination)),
    restaurants,
    activities,
    hotels,
    transport,
  };
}

router.post("/plan", async (req, res) => {
  const parsed = validatePlanRequest(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const validDestination = await findValidDestination(parsed.value.destination);
  if (!validDestination) {
    return res.status(400).json({
      success: false,
      code: "INVALID_DESTINATION",
      message: "Please select a valid Nepal destination.",
    });
  }
  if (typeof req.body?.origin === "string" && req.body.origin.trim()) {
    const validOrigin = await findValidLocation({ name: req.body.origin });
    if (!validOrigin) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORIGIN",
        message: "Please select a valid origin.",
      });
    }
  }

  try {
    const records = await loadPlannerRecords(parsed.value.destination);
    const plan = makePlan(parsed.value, records);
    return res.json({ plan });
  } catch (error) {
    console.error("Could not generate a trip from stored listings:", error);
    return res.status(500).json({ message: "Could not generate an itinerary right now. Please try again." });
  }
});

router.post("/plan/day", async (req, res) => {
  const input = { ...req.body, durationDays: 1 };
  if (typeof input.dayDate === "string" && input.dayDate) {
    input.startDate = input.dayDate;
    input.endDate = input.dayDate;
  } else {
    delete input.startDate;
    delete input.endDate;
  }
  const parsed = validatePlanRequest(input);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const validDestination = await findValidDestination(parsed.value.destination);
  if (!validDestination) {
    return res.status(400).json({
      success: false,
      code: "INVALID_DESTINATION",
      message: "Please select a valid Nepal destination.",
    });
  }
  if (typeof req.body?.origin === "string" && req.body.origin.trim()) {
    const validOrigin = await findValidLocation({ name: req.body.origin });
    if (!validOrigin) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORIGIN",
        message: "Please select a valid origin.",
      });
    }
  }
  const excludeEntityIds = input.excludeEntityIds ?? [];
  if (!Array.isArray(excludeEntityIds) || excludeEntityIds.length > 30 ||
      excludeEntityIds.some((id) => typeof id !== "string" || !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: "The selected itinerary stops could not be refreshed." });
  }

  try {
    const records = await loadPlannerRecords(parsed.value.destination);
    const plan = makePlan(parsed.value, records, { excludeEntityIds });
    return res.json({ day: plan.days[0] });
  } catch (error) {
    console.error("Could not refresh a trip day:", error);
    return res.status(500).json({ message: "Could not refresh this day right now. Please try again." });
  }
});

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const trips = await Trip.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    return res.json(trips);
  } catch (error) {
    console.error("Could not load trips:", error);
    return res.status(500).json({ message: "Could not load trips." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid trip reference." });
  }
  try {
    const trip = await Trip.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!trip) return res.status(404).json({ message: "Trip not found." });
    return res.json(trip);
  } catch (error) {
    console.error("Could not load trip:", error);
    return res.status(500).json({ message: "Could not load trip." });
  }
});

router.get("/:id/summary", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid trip reference." });
  }
  try {
    const trip = await Trip.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!trip) return res.status(404).json({ message: "Trip not found." });
    const Booking = require("../models/Booking");
    const Payment = require("../models/Payment");
    const TripPayment = require("../models/TripPayment");
    const bookings = await Booking.find({
      $or: [{ tripId: trip._id }, { _id: { $in: trip.bookingIds || [] } }],
    }).sort({ checkIn: 1, createdAt: 1 }).lean();
    const payments = await Payment.find({ bookingId: { $in: bookings.map((b) => b._id) } }).lean();
    const paymentsByBooking = new Map(payments.map((p) => [String(p.bookingId), p]));
    // Latest complete-trip one-payment checkout, if this trip used it.
    const checkout = await TripPayment.findOne({ tripId: trip._id }).sort({ createdAt: -1 }).lean();
    const subtotal = bookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    // Demo pricing: no taxes or provider fees are applied unless a real
    // provider integration sets them. Shown explicitly so totals are honest.
    const taxesAndFees = 0;
    return res.json({
      trip,
      bookings: bookings.map((booking) => ({
        ...booking,
        payment: paymentsByBooking.get(String(booking._id)) || null,
      })),
      checkout: checkout || null,
      totals: {
        subtotal,
        taxesAndFees,
        total: subtotal + taxesAndFees,
        currency: "NPR",
        demo: true,
      },
    });
  } catch (error) {
    console.error("Could not load trip summary:", error);
    return res.status(500).json({ message: "Could not load trip summary." });
  }
});

router.post("/", async (req, res) => {
  const {
    name, destination, origin, originDetails, startDate, endDate, notes, hotelId, plannedItems,
    durationDays, adults, children, budget, travelStyle, interests,
    transportPreference, accommodationPreference, foodPreferences,
    itinerary, recommendations, dataAvailability, warnings, selections, totalAmount,
  } = req.body || {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    return res.status(400).json({ message: "Enter a trip name of up to 120 characters." });
  }
  if (typeof destination !== "string" || !destination.trim() || destination.trim().length > 200) {
    return res.status(400).json({
      success: false,
      code: "INVALID_DESTINATION",
      message: "Please select a valid Nepal destination.",
    });
  }
  // Destination must resolve to a real record — never trust free text.
  const validDestination = await findValidDestination(destination);
  if (!validDestination) {
    return res.status(400).json({
      success: false,
      code: "INVALID_DESTINATION",
      message: "Please select a valid Nepal destination.",
    });
  }
  // Origin is optional, but when supplied it must resolve to a real
  // location — never trust free text. The server-resolved record (not
  // client-sent coordinates) is what gets stored.
  let resolvedOrigin = null;
  if (origin !== undefined && String(origin).trim()) {
    if (typeof origin !== "string" || origin.trim().length > 200) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORIGIN",
        message: "Please select a valid origin.",
      });
    }
    const refId = originDetails && typeof originDetails.refId === "string" ? originDetails.refId : undefined;
    resolvedOrigin = await findValidLocation({ id: refId, name: origin });
    if (!resolvedOrigin) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORIGIN",
        message: "Please select a valid origin.",
      });
    }
  }
  const start = startDate ? parseStrictDate(startDate) : undefined;
  const end = endDate ? parseStrictDate(endDate) : undefined;
  if (
    (startDate && !start) ||
    (endDate && !end) ||
    (start && start < todayISO()) ||
    (start && end && end < start)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_DATE",
      message: !start && startDate || !end && endDate
        ? "Please select a valid travel date."
        : start && start < todayISO()
          ? "Please select a future travel date."
          : "Return date must be after the departure date.",
    });
  }
  if (notes !== undefined && (typeof notes !== "string" || notes.length > 5000)) {
    return res.status(400).json({ message: "Trip notes must be 5,000 characters or fewer." });
  }
  if (plannedItems !== undefined && (
    !Array.isArray(plannedItems) ||
    plannedItems.length > 50 ||
    plannedItems.some((item) =>
      !item ||
      typeof item.itemId !== "string" || !item.itemId.trim() ||
      typeof item.category !== "string" || !item.category.trim() ||
      typeof item.name !== "string" || !item.name.trim() ||
      (item.location !== undefined && typeof item.location !== "string") ||
      (item.latitude !== undefined && (!Number.isFinite(item.latitude) || item.latitude < -90 || item.latitude > 90)) ||
      (item.longitude !== undefined && (!Number.isFinite(item.longitude) || item.longitude < -180 || item.longitude > 180))
    )
  )) {
    return res.status(400).json({ message: "Trip items must include a name, category, and item reference with valid optional coordinates." });
  }
  if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 14)) {
    return res.status(400).json({ message: "Trip duration must be from 1 to 14 days." });
  }
  if (budget !== undefined && (
    !budget || typeof budget !== "object" || Array.isArray(budget) ||
    (budget.amount !== undefined && (!Number.isFinite(budget.amount) || budget.amount < 0 || budget.amount > 10000000)) ||
    (budget.currency !== undefined && budget.currency !== "NPR") ||
    (budget.level !== undefined && !["Budget", "Moderate", "Premium"].includes(budget.level))
  )) {
    return res.status(400).json({ message: "Enter a valid NPR budget and budget level." });
  }
  if (adults !== undefined && (!Number.isInteger(adults) || adults < 1 || adults > 20)) {
    return res.status(400).json({ message: "Traveler count must be from 1 to 20 adults." });
  }
  if (children !== undefined && (!Number.isInteger(children) || children < 0 || children > 20 || (adults ?? 1) + children > 20)) {
    return res.status(400).json({ message: "Child traveler count is invalid." });
  }
  if (interests !== undefined && (!Array.isArray(interests) || interests.length > 12 || interests.some((value) => typeof value !== "string" || value.length > 60))) {
    return res.status(400).json({ message: "Choose up to 12 valid trip interests." });
  }
  if (foodPreferences !== undefined && (!Array.isArray(foodPreferences) || foodPreferences.length > 8 || foodPreferences.some((value) => typeof value !== "string" || value.length > 60))) {
    return res.status(400).json({ message: "Choose up to 8 valid food preferences." });
  }
  if (itinerary !== undefined && (!Array.isArray(itinerary) || itinerary.length > 14 || itinerary.some((day) =>
    !day || !Number.isInteger(day.day) || day.day < 1 || !Array.isArray(day.items) || day.items.length > 3 ||
    day.items.some((item) => !item || typeof item.entityId !== "string" || typeof item.name !== "string" || typeof item.entityType !== "string")
  ))) {
    return res.status(400).json({ message: "The generated itinerary has an invalid structure." });
  }
  if (recommendations !== undefined && (typeof recommendations !== "object" || recommendations === null || Array.isArray(recommendations))) {
    return res.status(400).json({ message: "Trip recommendations have an invalid structure." });
  }
  if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 20 || warnings.some((value) => typeof value !== "string" || value.length > 300))) {
    return res.status(400).json({ message: "Trip warnings have an invalid structure." });
  }
  if (dataAvailability !== undefined && (!Array.isArray(dataAvailability) || dataAvailability.length > 10 || dataAvailability.some((value) => typeof value !== "string" || value.length > 240))) {
    return res.status(400).json({ message: "Trip planning notes have an invalid structure." });
  }
  // Complete-trip service snapshot (hotel/transport/activity choices + priced
  // totals) submitted with the trip. Stored verbatim for admin review and the
  // trip PDF; size-capped and never trusted for pricing (server recomputes).
  let savedSelections;
  if (selections !== undefined) {
    if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
      return res.status(400).json({ message: "Trip selections have an invalid structure." });
    }
    try {
      if (Buffer.byteLength(JSON.stringify(selections), "utf8") > 100000) {
        return res.status(400).json({ message: "Trip selections are too large." });
      }
    } catch {
      return res.status(400).json({ message: "Trip selections have an invalid structure." });
    }
    savedSelections = selections;
  }
  const savedTotalAmount =
    totalAmount === undefined
      ? undefined
      : Number.isFinite(Number(totalAmount)) && Number(totalAmount) >= 0 && Number(totalAmount) <= 10000000
        ? Math.round(Number(totalAmount))
        : undefined;
  if (totalAmount !== undefined && savedTotalAmount === undefined) {
    return res.status(400).json({ message: "Trip total amount is invalid." });
  }

  let hotel = null;
  if (hotelId !== undefined) {
    if (!mongoose.isValidObjectId(hotelId)) {
      return res.status(400).json({ message: "Invalid hotel reference." });
    }
    try {
      hotel = await Hotel.findById(hotelId).lean();
      if (!hotel) return res.status(404).json({ message: "Selected hotel was not found." });
    } catch (error) {
      console.error("Could not load selected hotel for trip:", error);
      return res.status(500).json({ message: "Could not load selected hotel." });
    }
  }

  try {
    let savedItinerary = itinerary;
    if (itinerary !== undefined) {
      const checked = await canonicalizeItinerary(itinerary, destination.trim(), durationDays);
      if (checked.error) return res.status(400).json({ message: checked.error });
      savedItinerary = checked.value;
    }
    let savedRecommendations = recommendations;
    if (recommendations !== undefined) {
      if (!Array.isArray(recommendations.hotels) || !Array.isArray(recommendations.transport) ||
          (recommendations.restaurants !== undefined && !Array.isArray(recommendations.restaurants))) {
        return res.status(400).json({ message: "Trip recommendations must contain valid listing arrays." });
      }
      const checked = await canonicalizeRecommendations(
        recommendations,
        destination.trim(),
        savedItinerary ?? [],
        durationDays ?? 1,
        (adults ?? 1) + (children ?? 0)
      );
      if (checked.error) return res.status(400).json({ message: checked.error });
      savedRecommendations = checked.value;
    }
    const trip = await Trip.create({
      userId: req.user._id,
      name: name.trim(),
      destination: validDestination.name,
      origin: resolvedOrigin ? resolvedOrigin.name : undefined,
      originDetails: resolvedOrigin || undefined,
      startDate: start,
      endDate: end,
      notes: notes?.trim(),
      durationDays,
      adults,
      children,
      budget,
      travelStyle,
      interests,
      transportPreference,
      accommodationPreference,
      foodPreferences,
      itinerary: savedItinerary,
      recommendations: savedRecommendations,
      dataAvailability,
      warnings,
      hotelId: hotel?._id,
      hotelName: hotel?.name,
      hotelLocation: hotel?.location || hotel?.city,
      hotelLatitude: hotel?.latitude,
      hotelLongitude: hotel?.longitude,
      plannedItems: plannedItems?.map((item) => ({
        itemId: item.itemId.trim(),
        category: item.category.trim(),
        name: item.name.trim(),
        location: item.location?.trim(),
        latitude: item.latitude,
        longitude: item.longitude,
      })),
      selections: savedSelections,
      totalAmount: savedTotalAmount,
      status: "planned",
    });
    return res.status(201).json(trip);
  } catch (error) {
    console.error("Could not create trip:", error);
    return res.status(500).json({ message: "Could not create trip." });
  }
});

router.put("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid trip reference." });
  }
  const allowed = [
    "name", "destination", "origin", "originDetails", "startDate", "endDate", "notes", "status",
    "durationDays", "adults", "children", "budget", "travelStyle",
    "interests", "transportPreference", "accommodationPreference",
    "foodPreferences", "itinerary", "recommendations",
    "dataAvailability", "warnings",
  ];
  const updates = Object.fromEntries(
    Object.entries(req.body || {}).filter(([key]) => allowed.includes(key))
  );
  try {
    const currentTrip = await Trip.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!currentTrip) return res.status(404).json({ message: "Trip not found." });
    const rawDestination = typeof updates.destination === "string" ? updates.destination.trim() : currentTrip.destination;
    if (updates.destination && !updates.itinerary && rawDestination !== currentTrip.destination) {
      return res.status(400).json({ message: "Regenerate the itinerary before changing its destination." });
    }
    if (typeof updates.destination === "string" && updates.destination.trim()) {
      const validUpdate = await findValidDestination(updates.destination);
      if (!validUpdate) {
        return res.status(400).json({
          success: false,
          code: "INVALID_DESTINATION",
          message: "Please select a valid Nepal destination.",
        });
      }
      updates.destination = validUpdate.name;
    }
    const destination = typeof updates.destination === "string" ? updates.destination : currentTrip.destination;
    if (typeof updates.origin === "string" && updates.origin.trim()) {
      const refId = updates.originDetails && typeof updates.originDetails.refId === "string"
        ? updates.originDetails.refId
        : undefined;
      const resolved = await findValidLocation({ id: refId, name: updates.origin });
      if (!resolved) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ORIGIN",
          message: "Please select a valid origin.",
        });
      }
      updates.origin = resolved.name;
      updates.originDetails = resolved;
    } else {
      delete updates.originDetails;
      if (typeof updates.origin === "string") delete updates.origin;
    }
    if (updates.durationDays !== undefined && (!Number.isInteger(updates.durationDays) || updates.durationDays < 1 || updates.durationDays > 14)) {
      return res.status(400).json({ message: "Trip duration must be from 1 to 14 days." });
    }
    if (updates.budget !== undefined && (
      !updates.budget || typeof updates.budget !== "object" || Array.isArray(updates.budget) ||
      (updates.budget.amount !== undefined && (!Number.isFinite(updates.budget.amount) || updates.budget.amount < 0 || updates.budget.amount > 10000000)) ||
      (updates.budget.currency !== undefined && updates.budget.currency !== "NPR") ||
      (updates.budget.level !== undefined && !["Budget", "Moderate", "Premium"].includes(updates.budget.level))
    )) {
      return res.status(400).json({ message: "Enter a valid NPR budget and budget level." });
    }
    if (updates.itinerary !== undefined) {
      if (!Array.isArray(updates.itinerary) || updates.itinerary.length > 14 || updates.itinerary.some((day) =>
        !day || !Number.isInteger(day.day) || !Array.isArray(day.items) || day.items.length > 3 ||
        day.items.some((item) => !item || typeof item.entityId !== "string" || typeof item.name !== "string" || typeof item.entityType !== "string")
      )) {
        return res.status(400).json({ message: "The generated itinerary has an invalid structure." });
      }
      const checked = await canonicalizeItinerary(updates.itinerary, destination, updates.durationDays ?? currentTrip.durationDays);
      if (checked.error) return res.status(400).json({ message: checked.error });
      updates.itinerary = checked.value;
    }
    if (updates.recommendations !== undefined) {
      if (!updates.recommendations || !Array.isArray(updates.recommendations.hotels) ||
          !Array.isArray(updates.recommendations.transport) ||
          (updates.recommendations.restaurants !== undefined && !Array.isArray(updates.recommendations.restaurants))) {
        return res.status(400).json({ message: "Trip recommendations must contain valid listing arrays." });
      }
      const checked = await canonicalizeRecommendations(
        updates.recommendations,
        destination,
        updates.itinerary ?? currentTrip.itinerary ?? [],
        updates.durationDays ?? currentTrip.durationDays ?? 1,
        (updates.adults ?? currentTrip.adults ?? 1) + (updates.children ?? currentTrip.children ?? 0)
      );
      if (checked.error) return res.status(400).json({ message: checked.error });
      updates.recommendations = checked.value;
    }
    if (updates.warnings !== undefined && (!Array.isArray(updates.warnings) || updates.warnings.length > 20 || updates.warnings.some((value) => typeof value !== "string" || value.length > 300))) {
      return res.status(400).json({ message: "Trip warnings have an invalid structure." });
    }
    if (updates.dataAvailability !== undefined && (!Array.isArray(updates.dataAvailability) || updates.dataAvailability.length > 10 || updates.dataAvailability.some((value) => typeof value !== "string" || value.length > 240))) {
      return res.status(400).json({ message: "Trip planning notes have an invalid structure." });
    }
    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!trip) return res.status(404).json({ message: "Trip not found." });
    return res.json(trip);
  } catch (error) {
    console.error("Could not update trip:", error);
    return res.status(400).json({ message: "Could not update trip." });
  }
});

router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid trip reference." });
  }
  try {
    const trip = await Trip.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!trip) return res.status(404).json({ message: "Trip not found." });
    return res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Could not delete trip:", error);
    return res.status(500).json({ message: "Could not delete trip." });
  }
});

module.exports = router;
