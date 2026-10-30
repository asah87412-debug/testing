const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const adminAccessMiddleware = require("../middleware/adminAccess");
const getJwtSecret = require("../config/jwt");
const LoginActivity = require("../models/LoginActivity");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Destination = require("../models/Destination");
const Hotel = require("../models/Hotel");
const Restaurant = require("../models/Restaurant");
const LocalPlace = require("../models/LocalPlace");
const Transport = require("../models/Transport");
const Review = require("../models/Review");
const SupportTicket = require("../models/SupportTicket");
const Trip = require("../models/Trip");
const TripPayment = require("../models/TripPayment");
const mongoose = require("mongoose");

const router = express.Router();

const ADMIN_TOKEN_TYPE = "suvyatra-admin";
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const resourceModels = {
  destinations: Destination,
  hotels: Hotel,
  restaurants: Restaurant,
  activities: LocalPlace,
  transport: Transport,
  reviews: Review,
  feedback: SupportTicket,
};
const resourceSearchFields = {
  destinations: ["name", "province", "country"],
  hotels: ["name", "city", "province", "destination", "location"],
  restaurants: ["name", "city", "province", "cuisine", "category"],
  activities: ["name", "category", "city", "province", "description"],
  transport: ["name", "provider", "origin", "destination", "type"],
  reviews: ["userName", "itemName", "comment"],
  feedback: ["subject", "message", "status"],
};
const BOOKING_STATUSES = ["pending", "confirmed", "accepted", "rejected", "cancelled", "completed"];
const ALLOWED_BOOKING_TRANSITIONS = {
  pending: ["confirmed", "rejected", "cancelled"],
  confirmed: ["completed", "cancelled"],
  accepted: ["completed", "cancelled"],
  rejected: [],
  cancelled: [],
  completed: [],
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicUser(user) {
  if (!user) return null;
  const value = typeof user.toObject === "function" ? user.toObject() : user;
  return {
    _id: value._id,
    name: value.name || "",
    email: value.email || "",
    createdAt: value.createdAt,
    location: typeof value.location === "string" && value.location.trim()
      ? value.location.trim()
      : "Location not available",
    bio: value.bio || "",
    avatar: value.avatar || "",
    provider: value.provider || "",
    memberSince: value.memberSince || null,
    status: value.status || "active",
  };
}

function resourceFilter(type, query) {
  const filter = type === "activities" ? { module: "activity" } : {};
  if (type === "reviews" && query.visibility === "hidden") filter.isHidden = true;
  if (type === "reviews" && query.visibility === "visible") filter.isHidden = { $ne: true };
  if (type === "feedback" && ["open", "in_progress", "closed"].includes(query.status)) {
    filter.status = query.status;
  }
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search) {
    const expression = new RegExp(escapeRegex(search), "i");
    filter.$or = resourceSearchFields[type].map((field) => ({ [field]: expression }));
  }
  return filter;
}

function getEditableFields(model) {
  return Object.keys(model.schema.paths).filter((field) =>
    !["_id", "__v", "createdAt", "updatedAt", "id", "role", "password",
      "passwordResetOtpHash", "passwordResetExpiresAt", "passwordResetAttempts",
      "emailVerificationOtpHash", "emailVerificationExpiresAt", "emailVerificationAttempts",
      "emailVerificationRequestedAt",
      "userId"].includes(field) && !field.startsWith("$")
  );
}

function sanitizeResourceBody(type, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Provide a valid object for this resource." };
  }
  const model = resourceModels[type];
  const allowed = new Set(getEditableFields(model));
  const result = {};
  for (const [field, value] of Object.entries(body)) {
    if (allowed.has(field)) result[field] = value;
  }
  if (type === "activities") {
    result.module = "activity";
    result.isDemoData = false;
  }
  if (["hotels", "restaurants", "transport"].includes(type)) {
    result.isDemoData = false;
  }
  if (type === "reviews" && typeof body.isHidden === "boolean") {
    result.isHidden = body.isHidden;
  }
  return { result };
}

async function loadChatbotStatus() {
  const baseUrl = process.env.CHATBOT_API_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { configured: false, status: "not_configured", message: "Set CHATBOT_API_URL and CHATBOT_ADMIN_API_KEY on the backend to manage the existing knowledge base." };
  }
  if (!process.env.CHATBOT_ADMIN_API_KEY?.trim()) {
    return { configured: false, status: "not_configured", message: "Set CHATBOT_ADMIN_API_KEY on the backend to manage the existing knowledge base." };
  }
  try {
    const response = await fetch(`${baseUrl}/ready`, {
      signal: AbortSignal.timeout(4000),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 503) {
      return { configured: true, status: "empty", chunks: 0 };
    }
    if (!response.ok) {
      return { configured: true, status: "error", message: `Chatbot health check failed (${response.status}).` };
    }
    return { configured: true, status: "ready", chunks: body.chunks };
  } catch (error) {
    console.error("Could not check chatbot readiness:", error.message);
    return { configured: true, status: "unreachable", message: "The chatbot service could not be reached." };
  }
}

function validateResourceType(req, res, next) {
  if (!Object.hasOwn(resourceModels, req.params.resource)) {
    return res.status(404).json({ message: "Admin resource not found." });
  }
  return next();
}

router.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const issueSession = (sessionEmail) => res.json({
    token: jwt.sign(
      { sub: ADMIN_TOKEN_TYPE, role: "admin", tokenType: ADMIN_TOKEN_TYPE },
      getJwtSecret(),
      { expiresIn: "4h" }
    ),
    admin: { email: sessionEmail, role: "admin" },
  });

  // DB-backed admin account first: OTP password resets update this store, so
  // dashboard login must honor it. Role + active status enforced; env
  // credentials below remain as fallback.
  try {
    if (email && password) {
      const dbAdmin = await User.findOne({ email })
        .collation({ locale: "en", strength: 2 })
        .select("+password");
      if (dbAdmin && dbAdmin.role === "admin" && dbAdmin.status !== "disabled" &&
          typeof dbAdmin.comparePassword === "function" && await dbAdmin.comparePassword(password)) {
        return issueSession(dbAdmin.email);
      }
    }
  } catch (error) {
    console.error("Administrator database lookup failed:", error);
  }

  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const configuredPasswordHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!configuredEmail || !BCRYPT_HASH_PATTERN.test(configuredPasswordHash || "")) {
    return res.status(503).json({ message: "Admin login is not configured on this server." });
  }

  try {
    const passwordMatches = await bcrypt.compare(password || "invalid-password", configuredPasswordHash);
    if (!email || email !== configuredEmail || !password || !passwordMatches) {
      return res.status(401).json({ message: "Invalid administrator email or password." });
    }

    return issueSession(configuredEmail);
  } catch (error) {
    console.error("Administrator login failed:", error);
    return res.status(500).json({ message: "Could not complete admin login." });
  }
});

router.use(adminAccessMiddleware);

router.get("/session", (req, res) => {
  if (!req.admin) {
    return res.status(403).json({ message: "A separate administrator session is required." });
  }
  return res.json({ admin: { email: req.admin.email, role: "admin" } });
});

router.get("/overview", async (_req, res) => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  const monthAgo = new Date(today);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 29);
  try {
    const [
      users,
      bookings,
      destinations,
      hotels,
      restaurants,
      activities,
      transport,
      pendingCheckouts,
      pendingTripBookings,
      registrationsMonth,
      bookingsMonth,
      registrations,
      bookingTrend,
      popularDestinations,
      popularHotels,
      popularRestaurants,
      popularTransport,
      popularActivities,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      Booking.countDocuments(),
      Destination.countDocuments(),
      Hotel.countDocuments({ available: { $ne: false } }),
      Restaurant.countDocuments({ isDemoData: false }),
      LocalPlace.countDocuments({ module: "activity", isDemoData: false }),
      Transport.countDocuments({ isDemoData: false }),
      TripPayment.countDocuments({ paymentStatus: "PAID", approvalStatus: "pending" }),
      // Trip bookings queue for admin confirmation BEFORE payment as well as
      // after it — unpaid pending trips must be visible to confirm.
      Booking.countDocuments({ itemType: "trip", approvalStatus: "pending", paymentStatus: { $in: ["not_configured", "pending", "paid"] } }),
      User.countDocuments({ role: "user", createdAt: { $gte: monthAgo } }),
      Booking.countDocuments({ createdAt: { $gte: monthAgo } }),
      User.aggregate([
        { $match: { role: "user", createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      ]),
      Trip.aggregate([
        { $match: { destination: { $type: "string", $ne: "" } } },
        { $group: { _id: "$destination", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      ...["hotel", "restaurant", "transport"].map((itemType) => Booking.aggregate([
        { $match: { itemType } },
        { $group: { _id: "$itemName", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ])),
      Trip.aggregate([
        { $unwind: "$plannedItems" },
        { $match: { "plannedItems.category": { $regex: /^activities?$/i } } },
        { $group: { _id: "$plannedItems.name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);
    const buildTrend = (rows) => {
      const counts = new Map(rows.map((row) => [row._id, row.count]));
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(sevenDaysAgo);
        date.setUTCDate(date.getUTCDate() + index);
        const key = date.toISOString().slice(0, 10);
        return { date: key, count: counts.get(key) || 0 };
      });
    };
    const pendingApprovals = (pendingCheckouts || 0) + (pendingTripBookings || 0);
    return res.json({
      totals: { users, bookings, destinations, hotels, restaurants, activities, transport, pendingApprovals },
      last30Days: { registrations: registrationsMonth, bookings: bookingsMonth },
      trends: { registrations: buildTrend(registrations), bookings: buildTrend(bookingTrend) },
      popular: {
        destinations: popularDestinations.map(({ _id, count }) => ({ name: _id, count })),
        hotels: popularHotels.map(({ _id, count }) => ({ name: _id, count })),
        restaurants: popularRestaurants.map(({ _id, count }) => ({ name: _id, count })),
        transport: popularTransport.map(({ _id, count }) => ({ name: _id, count })),
        activities: popularActivities.map(({ _id, count }) => ({ name: _id, count })),
      },
    });
  } catch (error) {
    console.error("Could not load admin overview:", error);
    return res.status(500).json({ message: "Could not load dashboard statistics." });
  }
});

router.get("/registered-users", async (req, res) => {
  try {
    const [total, users] = await Promise.all([
      User.countDocuments(),
      User.find()
        .select("name email createdAt")
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    return res.json({
      total,
      users: users.map(({ _id, name, email, createdAt }) => ({
        _id,
        name,
        email: email || "",
        createdAt,
      })),
    });
  } catch (error) {
    console.error("Could not load registered users:", error);
    return res.status(500).json({ message: "Could not load registered users." });
  }
});

router.get("/users", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = search
    ? { $or: ["name", "email"].map((field) => ({
        [field]: { $regex: escapedSearch, $options: "i" },
      })) }
    : {};
  const sort = req.query.sort === "oldest" ? 1 : -1;
  const requestedPage = Number.parseInt(req.query.page, 10);
  const page = Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const limit = 50;
  filter.role = "user";
  if (req.query.status === "active" || req.query.status === "disabled") {
    filter.status = req.query.status;
  }

  try {
    const [total, matching, users] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments(filter),
      User.find(filter)
        .select("name email createdAt location bio provider memberSince status")
        .sort({ createdAt: sort, _id: sort })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      total,
      matching,
      page,
      pageCount: Math.max(1, Math.ceil(matching / limit)),
      users: users.map(({ _id, name, email, createdAt, location, bio, provider, memberSince, status }) => ({
        _id,
        name,
        email: email || "",
        createdAt,
        location: typeof location === "string" && location.trim()
          ? location.trim()
          : "Location not available",
        bio: bio || "",
        provider: provider || "",
        memberSince: memberSince || null,
        status: typeof status === "string" ? status : "active",
      })),
    });
  } catch (error) {
    console.error("Could not load registered users:", error);
    return res.status(500).json({ message: "Could not load registered users." });
  }
});

router.patch("/users/:id/status", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid user reference." });
  }
  if (!["active", "disabled"].includes(req.body?.status)) {
    return res.status(400).json({ message: "Account status must be active or disabled." });
  }
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: "user" },
      { $set: { status: req.body.status } },
      { new: true, runValidators: true }
    ).select("name email createdAt location bio avatar provider memberSince status");
    if (!user) return res.status(404).json({ message: "User not found." });
    return res.json(publicUser(user));
  } catch (error) {
    console.error("Could not update account status:", error);
    return res.status(500).json({ message: "Could not update account status." });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(400).json({ message: "Invalid user reference." });
    }
    const user = await User.findOne({ _id: req.params.id, role: "user" })
      .select("name email createdAt location bio provider memberSince status")
      .lean();
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email || "",
      createdAt: user.createdAt,
      location: typeof user.location === "string" && user.location.trim()
        ? user.location.trim()
        : "Location not available",
      bio: user.bio || "",
      provider: user.provider || "",
      memberSince: user.memberSince || null,
      status: typeof user.status === "string" ? user.status : "active",
    });
  } catch (error) {
    console.error("Could not load registered user details:", error);
    return res.status(500).json({ message: "Could not load user details." });
  }
});

router.get("/resources/:resource", validateResourceType, async (req, res) => {
  const { resource } = req.params;
  const Model = resourceModels[resource];
  const filter = resourceFilter(resource, req.query);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const sort = req.query.sort === "oldest" ? 1 : -1;
  try {
    let query = Model.find(filter)
      .sort({ createdAt: sort, _id: sort })
      .skip((page - 1) * limit)
      .limit(limit);
    if (resource === "feedback") {
      query = query.populate({ path: "userId", select: "name email" });
    }
    const [total, records] = await Promise.all([
      Model.countDocuments(filter),
      query.lean(),
    ]);
    return res.json({
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      records: records.map((record) => {
        if (resource !== "feedback") return record;
        const { userId, ...ticket } = record;
        return {
          ...ticket,
          user: userId ? { name: userId.name || "", email: userId.email || "" } : null,
        };
      }),
    });
  } catch (error) {
    console.error(`Could not load admin ${resource}:`, error);
    return res.status(500).json({ message: `Could not load ${resource}.` });
  }
});

router.post("/resources/:resource", validateResourceType, async (req, res) => {
  const { resource } = req.params;
  const { result, error } = sanitizeResourceBody(resource, req.body);
  if (error) return res.status(400).json({ message: error });
  if (resource === "reviews") result.isHidden = false;
  try {
    const record = await resourceModels[resource].create(result);
    return res.status(201).json(record);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.put("/resources/:resource/:id", validateResourceType, async (req, res) => {
  const { resource, id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: `Invalid ${resource} reference.` });
  }
  const { result, error } = sanitizeResourceBody(resource, req.body);
  if (error) return res.status(400).json({ message: error });
  try {
    const filter = { _id: id };
    if (resource === "activities") filter.module = "activity";
    const record = await resourceModels[resource].findOneAndUpdate(
      filter,
      { $set: result },
      { new: true, runValidators: true }
    );
    if (!record) return res.status(404).json({ message: `${resource} record not found.` });
    return res.json(record);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.delete("/resources/:resource/:id", validateResourceType, async (req, res) => {
  const { resource, id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: `Invalid ${resource} reference.` });
  }
  try {
    const filter = { _id: id };
    if (resource === "activities") filter.module = "activity";
    const record = await resourceModels[resource].findOneAndDelete(filter);
    if (!record) return res.status(404).json({ message: `${resource} record not found.` });
    return res.json({ deleted: true, id });
  } catch (error) {
    console.error(`Could not delete ${resource} record:`, error);
    return res.status(500).json({ message: `Could not delete ${resource} record.` });
  }
});

router.get("/bookings-summary", async (_req, res) => {
  try {
    const [groups, revenue] = await Promise.all([
      Booking.aggregate([
        { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
    ]);
    const byStatus = Object.fromEntries(groups.map((g) => [g._id, g.count]));
    const paid = byStatus.paid || 0;
    const pending = byStatus.pending || 0;
    const notConfigured = byStatus.not_configured || 0;
    const failed = byStatus.failed || 0;
    const refunded = byStatus.refunded || 0;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return res.json({
      total,
      paid,
      // UNPAID = initiated-but-not-paid (pending) + never-initiated (not_configured)
      unpaid: pending + notConfigured,
      pending,
      notConfigured,
      failed,
      refunded,
      totalRevenue: revenue[0]?.total || 0,
      currency: "NPR",
    });
  } catch (error) {
    console.error("Could not load bookings summary:", error);
    return res.status(500).json({ message: "Could not load bookings summary." });
  }
});

router.get("/bookings", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filter = {};
  if (BOOKING_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  // Booking category filter for admin tabs. Service tabs exclude trip-linked
  // component bookings (tripId/paymentId) so categories never mix; the trips
  // tab owns every trip-linked record. Unknown values are ignored.
  const BOOKING_CATEGORIES = {
    transport: { itemType: { $in: ["transport", "flight"] }, tripId: null, paymentId: null },
    hotels: { itemType: "hotel", tripId: null, paymentId: null },
    activities: { itemType: "activity", tripId: null, paymentId: null },
    trips: { $or: [{ itemType: "trip" }, { tripId: { $exists: true, $ne: null } }, { paymentId: { $exists: true, $ne: null } }] },
  };
  const categoryKey = typeof req.query.category === "string" ? req.query.category.trim().toLowerCase() : "";
  const categoryFilter = BOOKING_CATEGORIES[categoryKey] ?? null;
  // Payment-status filter: paid | pending | failed | refunded | not_configured | unpaid (=pending+not_configured)
  const paymentFilter = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus.trim().toLowerCase() : "";
  if (["paid", "pending", "failed", "refunded", "not_configured"].includes(paymentFilter)) {
    filter.paymentStatus = paymentFilter;
  } else if (paymentFilter === "unpaid") {
    filter.paymentStatus = { $in: ["pending", "not_configured"] };
  }
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  try {
    let searchOr = null;
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      searchOr = [
        { itemName: expression },
        { bookingCode: expression },
        { itemType: expression },
        { status: expression },
        { paymentStatus: expression },
        { paymentReference: expression },
        { location: expression },
      ];
      if (mongoose.isValidObjectId(search)) {
        searchOr.push({ _id: new mongoose.Types.ObjectId(search) });
      }
      // Match users by name OR email (all roles, so admin accounts resolve too).
      const matchingUsers = await User.find({
        $or: [{ name: expression }, { email: expression }],
      }).select("_id").lean();
      if (matchingUsers.length) {
        searchOr.push({ userId: { $in: matchingUsers.map((user) => user._id) } });
      }
      // Match parent complete-trip checkouts by checkout/payment/reference code.
      const TripPayment = require("../models/TripPayment");
      const matchingCheckouts = await TripPayment.find({
        $or: [{ checkoutCode: expression }, { paymentId: expression }, { referenceId: expression }],
      }).select("_id").lean();
      if (matchingCheckouts.length) {
        searchOr.push({ paymentId: { $in: matchingCheckouts.map((c) => c._id) } });
      }
    }
    if (categoryFilter && searchOr) {
      filter.$and = [categoryFilter, { $or: searchOr }];
    } else {
      if (categoryFilter) Object.assign(filter, categoryFilter);
      if (searchOr) filter.$or = searchOr;
    }
    const [total, bookings] = await Promise.all([
      Booking.countDocuments(filter),
      Booking.find(filter)
        .populate({ path: "userId", select: "name email" })
        .populate({ path: "tripId", select: "name destination startDate endDate" })
        .populate({ path: "paymentId", select: "checkoutCode paymentId referenceId paymentStatus paymentMethod totalAmount" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      bookings: bookings.map(({ userId, tripId, paymentId, ...booking }) => ({
        ...booking,
        user: userId ? { name: userId.name || "", email: userId.email || "" } : null,
        trip: tripId ? { _id: tripId._id, name: tripId.name || "", destination: tripId.destination || "" } : null,
        tripPayment: paymentId
          ? {
              _id: paymentId._id,
              checkoutCode: paymentId.checkoutCode || "",
              paymentId: paymentId.paymentId || "",
              referenceId: paymentId.referenceId || "",
              paymentStatus: paymentId.paymentStatus || "",
              paymentMethod: paymentId.paymentMethod || "",
              totalAmount: paymentId.totalAmount || 0,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("Could not load admin bookings:", error);
    return res.status(500).json({ message: "Could not load bookings." });
  }
});

router.get("/bookings/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const booking = await Booking.findById(req.params.id)
      .populate({ path: "userId", select: "name email phone" })
      .populate({ path: "tripId", select: "name destination startDate endDate" })
      .populate({ path: "paymentId" })
      .lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    const { userId, tripId, paymentId, ...rest } = booking;
    let siblings = [];
    if (paymentId?._id) {
      siblings = await Booking.find({ paymentId: paymentId._id, _id: { $ne: booking._id } })
        .select("bookingCode itemType itemName location amount currency paymentStatus status checkIn")
        .lean();
    } else if (tripId?._id) {
      siblings = await Booking.find({ tripId: tripId._id, _id: { $ne: booking._id } })
        .select("bookingCode itemType itemName location amount currency paymentStatus status checkIn")
        .lean();
    }
    let ledger = [];
    try {
      const Payment = require("../models/Payment");
      ledger = await Payment.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean();
    } catch { ledger = []; }
    return res.json({
      booking: {
        ...rest,
        user: userId ? { name: userId.name || "", email: userId.email || "", phone: userId.phone || "" } : null,
        trip: tripId || null,
        tripPayment: paymentId || null,
      },
      siblings,
      ledger,
    });
  } catch (error) {
    console.error("Could not load booking details:", error);
    return res.status(500).json({ message: "Could not load booking details." });
  }
});

// Parent complete-trip checkouts: one grand-total payment per trip.
router.get("/trip-payments", async (req, res) => {
  const TripPayment = require("../models/TripPayment");
  const filter = {};
  const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
  if (["PENDING", "PAID", "FAILED"].includes(status)) filter.paymentStatus = status;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  try {
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      const or = [
        { checkoutCode: expression },
        { paymentId: expression },
        { referenceId: expression },
        { paymentMethod: expression },
      ];
      const matchingUsers = await User.find({
        $or: [{ name: expression }, { email: expression }],
      }).select("_id").lean();
      if (matchingUsers.length) or.push({ userId: { $in: matchingUsers.map((u) => u._id) } });
      const matchingTrips = await Trip.find({
        $or: [{ name: expression }, { destination: expression }],
      }).select("_id").lean();
      if (matchingTrips.length) or.push({ tripId: { $in: matchingTrips.map((t) => t._id) } });
      filter.$or = or;
    }
    const [total, records] = await Promise.all([
      TripPayment.countDocuments(filter),
      TripPayment.find(filter)
        .populate({ path: "userId", select: "name email" })
        .populate({ path: "tripId", select: "name destination startDate endDate" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      tripPayments: records.map(({ userId, tripId, ...tp }) => ({
        ...tp,
        user: userId ? { name: userId.name || "", email: userId.email || "" } : null,
        trip: tripId ? { _id: tripId._id, name: tripId.name || "", destination: tripId.destination || "" } : null,
      })),
    });
  } catch (error) {
    console.error("Could not load trip payments:", error);
    return res.status(500).json({ message: "Could not load trip payments." });
  }
});

router.get("/trip-payments/:id", async (req, res) => {
  const TripPayment = require("../models/TripPayment");
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid trip payment reference." });
  }
  try {
    const checkout = await TripPayment.findById(req.params.id)
      .populate({ path: "userId", select: "name email" })
      .populate({ path: "tripId" })
      .lean();
    if (!checkout) return res.status(404).json({ message: "Trip payment not found." });
    const bookings = await Booking.find({ _id: { $in: checkout.bookingIds || [] } })
      .populate({ path: "userId", select: "name email" })
      .lean();
    return res.json({ tripPayment: checkout, bookings });
  } catch (error) {
    console.error("Could not load trip payment details:", error);
    return res.status(500).json({ message: "Could not load trip payment details." });
  }
});

// Read-only payment ledger (payments are created by the booking payment flow,
// never hand-made here, so no POST/PUT/DELETE is exposed).
router.get("/payments", async (req, res) => {
  const Payment = require("../models/Payment");
  const filter = {};
  if (["PENDING", "PAID", "FAILED", "REFUNDED"].includes(req.query.status)) {
    filter.status = req.query.status;
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  try {
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      const matchingBookings = await Booking.find({
        $or: [{ itemName: expression }, { bookingCode: expression }],
      }).select("_id").lean();
      filter.$or = [
        { reference: expression },
        { bookingId: { $in: matchingBookings.map((booking) => booking._id) } },
      ];
    }
    const [total, payments] = await Promise.all([
      Payment.countDocuments(filter),
      Payment.find(filter)
        .populate({ path: "userId", select: "name email" })
        .populate({ path: "bookingId", select: "bookingCode itemName status" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      payments: payments.map(({ userId, bookingId, ...payment }) => ({
        ...payment,
        user: userId ? { name: userId.name || "", email: userId.email || "" } : null,
        booking: bookingId
          ? { bookingCode: bookingId.bookingCode || "", itemName: bookingId.itemName || "", status: bookingId.status || "" }
          : null,
      })),
    });
  } catch (error) {
    console.error("Could not load admin payments:", error);
    return res.status(500).json({ message: "Could not load payments." });
  }
});

// Pending trip approvals: complete-trip checkouts and trip bookings waiting
// for an admin accept/reject decision. Trip bookings queue BEFORE payment
// (to confirm) as well as after it; only failed/refunded payments stay out.
router.get("/approvals", async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  try {
    const [checkouts, tripBookings] = await Promise.all([
      TripPayment.find({ paymentStatus: "PAID", approvalStatus: "pending" })
        .populate({ path: "userId", select: "name email" })
        .populate({ path: "tripId", select: "name destination startDate endDate origin" })
        .sort({ submittedForApprovalAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Booking.find({ itemType: "trip", approvalStatus: "pending", paymentStatus: { $in: ["not_configured", "pending", "paid"] } })
        .populate({ path: "userId", select: "name email" })
        .populate({ path: "tripId", select: "name destination startDate endDate origin" })
        .sort({ submittedForApprovalAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    const [checkoutTotal, tripBookingTotal] = await Promise.all([
      TripPayment.countDocuments({ paymentStatus: "PAID", approvalStatus: "pending" }),
      Booking.countDocuments({ itemType: "trip", approvalStatus: "pending", paymentStatus: { $in: ["not_configured", "pending", "paid"] } }),
    ]);
    const items = [];
    for (const c of checkouts) {
      const bookings = await Booking.find({ paymentId: c._id, status: { $ne: "cancelled" } })
        .select("bookingCode itemType itemName location amount currency paymentStatus status checkIn serviceTime")
        .lean();
      items.push({
        kind: "checkout",
        _id: c._id,
        checkoutCode: c.checkoutCode,
        paymentId: c.paymentId,
        user: c.userId ? { name: c.userId.name || "", email: c.userId.email || "" } : null,
        trip: c.tripId || null,
        totalAmount: c.totalAmount,
        currency: c.currency || "NPR",
        paymentMethod: c.paymentMethod,
        referenceId: c.referenceId || "",
        completedAt: c.completedAt || null,
        submittedForApprovalAt: c.submittedForApprovalAt || null,
        approvalDeadline: c.approvalDeadline || null,
        breakdown: c.breakdown || [],
        bookings,
      });
    }
    for (const b of tripBookings) {
      items.push({
        kind: "booking",
        _id: b._id,
        bookingCode: b.bookingCode,
        user: b.userId ? { name: b.userId.name || "", email: b.userId.email || "" } : null,
        trip: b.tripId || null,
        totalAmount: b.amount,
        currency: b.currency || "NPR",
        paymentMethod: b.paymentMethod || "",
        referenceId: b.paymentReference || "",
        completedAt: b.paymentConfirmedAt || null,
        submittedForApprovalAt: b.submittedForApprovalAt || null,
        approvalDeadline: b.approvalDeadline || null,
        breakdown: [],
        bookings: [],
      });
    }
    items.sort((a, b) => new Date(a.submittedForApprovalAt || 0) - new Date(b.submittedForApprovalAt || 0));
    const total = checkoutTotal + tripBookingTotal;
    return res.json({ total, page, pageCount: Math.max(1, Math.ceil(total / limit)), approvals: items });
  } catch (error) {
    console.error("Could not load pending approvals:", error);
    return res.status(500).json({ message: "Could not load pending approvals." });
  }
});

// Full detail for one pending item, incl. linked bookings/services + trip plan.
router.get("/approvals/:kind/:id", async (req, res) => {
  const { kind, id } = req.params;
  if (!["checkout", "booking"].includes(kind) || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid approval reference." });
  }
  try {
    if (kind === "checkout") {
      const checkout = await TripPayment.findById(id)
        .populate({ path: "userId", select: "name email" })
        .populate({ path: "tripId" })
        .lean();
      if (!checkout) return res.status(404).json({ message: "Trip payment not found." });
      const bookings = await Booking.find({ paymentId: checkout._id })
        .populate({ path: "userId", select: "name email" })
        .lean();
      return res.json({ kind, checkout, bookings });
    }
    const booking = await Booking.findById(id)
      .populate({ path: "userId", select: "name email" })
      .populate({ path: "tripId" })
      .lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    return res.json({ kind, booking });
  } catch (error) {
    console.error("Could not load approval details:", error);
    return res.status(500).json({ message: "Could not load approval details." });
  }
});

function approvalActor(req) {
  // Unified login: DB admin user. Legacy env-admin sessions carry no user id.
  if (req.user?._id) return req.user._id;
  return undefined;
}

// Accept a pending trip: approval + booking statuses flip together.
// Accepted trips become "confirmed" (awaiting payment), never paid —
// payment happens separately in My Bookings after this decision.
router.post("/approvals/:kind/:id/accept", async (req, res) => {
  const { kind, id } = req.params;
  if (!["checkout", "booking"].includes(kind) || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid approval reference." });
  }
  try {
    const now = new Date();
    const actor = approvalActor(req);
    if (kind === "checkout") {
      const checkout = await TripPayment.findOne({ _id: id, paymentStatus: "PAID", approvalStatus: "pending" });
      if (!checkout) return res.status(404).json({ message: "Pending trip payment not found. It may already be decided." });
      checkout.approvalStatus = "approved";
      checkout.approvedAt = now;
      if (actor) checkout.approvedBy = actor;
      await checkout.save();
      await Booking.updateMany(
        { paymentId: checkout._id, approvalStatus: "pending" },
        { $set: { approvalStatus: "approved", status: "confirmed", approvedAt: now, ...(actor ? { approvedBy: actor } : {}) } }
      );
      await Trip.updateOne({ _id: checkout.tripId }, { $set: { status: "confirmed" } });
      return res.json({ approved: true, kind, id });
    }
    const booking = await Booking.findOne({ _id: id, itemType: "trip", approvalStatus: "pending" });
    if (!booking) return res.status(404).json({ message: "Pending trip booking not found. It may already be decided." });
    booking.approvalStatus = "approved";
    booking.status = "confirmed";
    booking.approvedAt = now;
    if (actor) booking.approvedBy = actor;
    await booking.save();
    if (booking.tripId) await Trip.updateOne({ _id: booking.tripId }, { $set: { status: "confirmed" } });
    return res.json({ approved: true, kind, id });
  } catch (error) {
    console.error("Could not accept trip:", error);
    return res.status(500).json({ message: "Could not accept the trip." });
  }
});

// Reject a pending trip, with an optional reason. No refund is issued.
router.post("/approvals/:kind/:id/reject", async (req, res) => {
  const { kind, id } = req.params;
  if (!["checkout", "booking"].includes(kind) || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid approval reference." });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  try {
    const now = new Date();
    const actor = approvalActor(req);
    if (kind === "checkout") {
      const checkout = await TripPayment.findOne({ _id: id, paymentStatus: "PAID", approvalStatus: "pending" });
      if (!checkout) return res.status(404).json({ message: "Pending trip payment not found. It may already be decided." });
      checkout.approvalStatus = "rejected";
      checkout.rejectedAt = now;
      if (actor) checkout.rejectedBy = actor;
      if (reason) checkout.rejectionReason = reason;
      await checkout.save();
      await Booking.updateMany(
        { paymentId: checkout._id, approvalStatus: "pending" },
        { $set: { approvalStatus: "rejected", status: "rejected", rejectedAt: now, ...(actor ? { rejectedBy: actor } : {}), ...(reason ? { rejectionReason: reason } : {}) } }
      );
      await Trip.updateOne({ _id: checkout.tripId }, { $set: { status: "rejected" } });
      return res.json({ rejected: true, kind, id });
    }
    const booking = await Booking.findOne({ _id: id, itemType: "trip", approvalStatus: "pending" });
    if (!booking) return res.status(404).json({ message: "Pending trip booking not found. It may already be decided." });
    booking.approvalStatus = "rejected";
    booking.status = "rejected";
    booking.rejectedAt = now;
    if (actor) booking.rejectedBy = actor;
    if (reason) booking.rejectionReason = reason;
    await booking.save();
    if (booking.tripId) await Trip.updateOne({ _id: booking.tripId }, { $set: { status: "rejected" } });
    return res.json({ rejected: true, kind, id });
  } catch (error) {
    console.error("Could not reject trip:", error);
    return res.status(500).json({ message: "Could not reject the trip." });
  }
});

router.patch("/bookings/:id/status", async (req, res) => {  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  if (!BOOKING_STATUSES.includes(req.body?.status)) {
    return res.status(400).json({ message: "Choose a valid booking status." });
  }
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (!ALLOWED_BOOKING_TRANSITIONS[booking.status]?.includes(req.body.status)) {
      return res.status(409).json({
        message: `A ${booking.status} booking cannot be changed to ${req.body.status}.`,
      });
    }
    booking.status = req.body.status;
    // Hotel approval gate: standalone hotel bookings can only be paid after
    // admin acceptance. Accepting (confirmed) marks the booking approved so
    // POST /bookings/:id/pay lets the user pay; rejecting records the
    // decision so payment stays blocked. Other booking kinds are untouched.
    // Complete-trip bookings follow the same rule: confirming/accepting marks
    // them approved so the traveller can pay in My Bookings afterwards.
    const isStandaloneHotel =
      booking.itemType === "hotel" && !booking.tripId && !booking.paymentId;
    const isTripRecord =
      booking.itemType === "trip" || !!booking.tripId;
    if (req.body.status === "confirmed" || req.body.status === "accepted") {
      if ((isStandaloneHotel || isTripRecord) && booking.approvalStatus !== "approved") {
        booking.approvalStatus = "approved";
        booking.approvedAt = new Date();
        if (req.user?._id) booking.approvedBy = req.user._id;
      }
    }
    // A trip can only be completed after verified payment: completing an
    // unpaid, failed, or refunded trip booking is rejected here (the admin UI
    // disables the action too). Standalone bookings keep existing behavior.
    // Completing also finalizes the approval: completion presupposes admin
    // confirmation plus verified payment, so a completed trip can never be
    // left in the inconsistent (completed + approval pending) state that My
    // Bookings would otherwise read as still awaiting approval.
    if (req.body.status === "completed" && isTripRecord) {
      if (booking.paymentStatus !== "paid") {
        return res.status(409).json({
          message: "This trip cannot be marked completed before its payment is verified as paid.",
        });
      }
      if (booking.approvalStatus !== "approved") {
        booking.approvalStatus = "approved";
        if (!booking.approvedAt) booking.approvedAt = new Date();
        if (!booking.approvedBy && req.user?._id) booking.approvedBy = req.user._id;
      }
    }
    if (req.body.status === "rejected") {
      booking.approvalStatus = "rejected";
      booking.rejectedAt = new Date();
      if (req.user?._id) booking.rejectedBy = req.user._id;
      if (typeof req.body?.reason === "string" && req.body.reason.trim()) {
        booking.rejectionReason = req.body.reason.trim().slice(0, 500);
      }
    }
    await booking.save();
    return res.json({ booking });
  } catch (error) {
    console.error("Could not update booking status:", error);
    return res.status(500).json({ message: "Could not update booking status." });
  }
});

router.get("/chatbot/status", async (_req, res) => {
  return res.json(await loadChatbotStatus());
});

router.post("/chatbot/knowledge", async (req, res) => {
  const baseUrl = process.env.CHATBOT_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.CHATBOT_ADMIN_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return res.status(503).json({ message: "Chatbot knowledge management is not configured on the backend." });
  }
  let path;
  let payload;
  if (typeof req.body?.text === "string" && req.body.text.trim()) {
    if (req.body.text.length > 200000) {
      return res.status(400).json({ message: "Knowledge text must be 200,000 characters or fewer." });
    }
    path = "/api/v1/ingest/text";
    payload = { text: req.body.text, source: String(req.body.source || "admin").slice(0, 200) };
  } else if (typeof req.body?.url === "string" && req.body.url.trim()) {
    let url;
    try {
      url = new URL(req.body.url);
    } catch {
      return res.status(400).json({ message: "Enter a valid public URL." });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return res.status(400).json({ message: "Knowledge source URL must use HTTP or HTTPS." });
    }
    path = "/api/v1/ingest/url";
    payload = { url: url.toString() };
  } else {
    return res.status(400).json({ message: "Provide knowledge text or a source URL." });
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        message: typeof body.detail === "string" ? body.detail : "The chatbot rejected the knowledge source.",
      });
    }
    return res.status(201).json(body);
  } catch (error) {
    console.error("Could not ingest chatbot knowledge:", error.message);
    return res.status(502).json({ message: "Could not reach the chatbot knowledge service." });
  }
});

router.get("/login-activity", async (req, res) => {
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 200))
    : 100;

  try {
    const events = await LoginActivity.find()
      .sort({ loginAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ events });
  } catch (error) {
    console.error("Could not load login activity:", error);
    return res.status(500).json({ message: "Could not load login activity." });
  }
});

module.exports = router;
