// Shared destination + date validation for trip planning ("validate first,
// then search/plan"). Used by trip routes and the public validate endpoint.
// Canonical stored date is always AD/Gregorian ISO (YYYY-MM-DD).

const Destination = require("../models/Destination");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const mongoose = require("mongoose");

const INVALID_DESTINATION = {
  success: false,
  code: "INVALID_DESTINATION",
  message: "Please select a valid Nepal destination.",
};

const INVALID_ORIGIN = {
  success: false,
  code: "INVALID_ORIGIN",
  message: "Please select a valid origin.",
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a raw destination string against the real Destination collection.
 * Accepts an exact name/slug match (case-insensitive) or a whole-word
 * prefix of a canonical name ("Chitwan" → "Chitwan National Park").
 * Never matches on substring/character checks alone — "sjfbfbfj",
 * "asdfgh", "xyz123", "Pokh" all resolve null.
 */
async function findValidDestination(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return null;
  const exact = new RegExp(`^${escapeRegex(name)}$`, "i");
  const direct = await Destination.findOne({ $or: [{ name: exact }, { slug: exact }] }).lean();
  if (direct) return direct;
  // Whole-word prefix: the query must end on a word boundary in the record.
  const prefix = new RegExp(`^${escapeRegex(name)}(?=\\s|$)`, "i");
  return Destination.findOne({ name: prefix }).sort({ name: 1 }).lean();
}

function publicDestination(record) {
  if (!record) return null;
  return {
    _id: record._id,
    name: record.name || "",
    slug: record.slug || "",
    province: record.province || "",
    country: record.country || "Nepal",
    latitude: record.latitude,
    longitude: record.longitude,
  };
}

async function validateDestinationInput(raw) {
  const record = await findValidDestination(raw);
  if (!record) return { ...INVALID_DESTINATION, destination: null };
  return { success: true, destination: publicDestination(record) };
}

// ---------------------------------------------------------------------------
// Unified locations: destinations + transport route points + local places.
// The same service backs both Destination and Origin autocomplete/selection,
// so neither field can accept arbitrary text.
// ---------------------------------------------------------------------------

function joinAddress(parts) {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .filter((part, index, all) => all.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === index)
    .join(", ");
}

function normalizeLocation(record, kind, matchedName) {
  if (!record) return null;
  if (kind === "destination") {
    const name = record.name || "";
    return {
      refId: String(record._id),
      name,
      formattedAddress: joinAddress([name, record.province, record.country || "Nepal"]) || name,
      kind: "destination",
      source: "destination",
      latitude: record.latitude,
      longitude: record.longitude,
      city: record.province ? name : name,
      province: record.province || "",
      country: record.country || "Nepal",
    };
  }
  if (kind === "transport-hub") {
    const name = matchedName || record.origin || record.destination || record.name || "";
    return {
      refId: String(record._id),
      name,
      formattedAddress: /nepal/i.test(name) ? name : joinAddress([name, "Nepal"]),
      kind: "transport-hub",
      source: "transport",
      latitude: record.latitude,
      longitude: record.longitude,
      city: name,
      province: "",
      country: "Nepal",
    };
  }
  const name = record.name || "";
  return {
    refId: String(record._id),
    name,
    formattedAddress: joinAddress([name, record.city, record.province, "Nepal"]) || name,
    kind: "place",
    source: "localplace",
    latitude: record.latitude,
    longitude: record.longitude,
    city: record.city || "",
    province: record.province || "",
    country: "Nepal",
  };
}

/**
 * Resolve a location against real records. Prefers a stable record id
 * (proves the user selected a suggestion); falls back to exact-name
 * resolution for API clients sending canonical names.
 * Returns a normalized location or null. Gibberish always resolves null.
 */
async function findValidLocation({ id, name } = {}) {
  const text = typeof name === "string" ? name.trim() : "";
  if (id && mongoose.isValidObjectId(id)) {
    const [d, t, p] = await Promise.all([
      Destination.findById(id).lean(),
      Transport.findById(id).lean(),
      LocalPlace.findById(id).lean(),
    ]);
    // When both id and text are given they must agree — the id proves a
    // suggestion was selected, the text proves it wasn't edited afterwards.
    // A transport record carries two endpoints; the matched one is stored.
    if (d) {
      if (text && d.name.toLowerCase() !== text.toLowerCase()) return null;
      return normalizeLocation(d, "destination");
    }
    if (t) {
      const candidates = [t.origin, t.destination].filter(Boolean);
      const matched = text
        ? candidates.find((c) => c.toLowerCase() === text.toLowerCase())
        : t.origin || t.destination || t.name;
      if (!matched) return null;
      return normalizeLocation(t, "transport-hub", matched);
    }
    if (p) {
      if (text && p.name.toLowerCase() !== text.toLowerCase()) return null;
      return normalizeLocation(p, "place");
    }
    return null;
  }
  // 1. Canonical destination (exact / slug / whole-word prefix).
  const dest = await findValidDestination(text);
  if (dest) return normalizeLocation(dest, "destination");
  // 2. Transport route point: exact origin/destination value (case-insensitive).
  const exact = new RegExp(`^${escapeRegex(text)}$`, "i");
  const transport = await Transport.findOne({
    $or: [{ origin: exact }, { destination: exact }],
  }).lean();
  if (transport) {
    const matched = exact.test(transport.origin || "") ? transport.origin : transport.destination;
    return normalizeLocation(transport, "transport-hub", matched);
  }
  // 3. Local place: exact name (case-insensitive).
  const place = await LocalPlace.findOne({ name: exact }).lean();
  if (place) return normalizeLocation(place, "place");
  return null;
}

async function validateOriginInput({ id, name } = {}) {
  const location = await findValidLocation({ id, name });
  if (!location) return { ...INVALID_ORIGIN, location: null };
  return { success: true, location };
}

async function validateLocationInput({ id, name } = {}) {
  const location = await findValidLocation({ id, name });
  if (!location) return { ...INVALID_DESTINATION, location: null };
  return { success: true, location };
}

/**
 * Suggestion search across all location sources. Substring matching is fine
 * for SUGGESTIONS — selection is what validates (by record id).
 */
async function searchLocations(raw, limit = 8) {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (!q) return [];
  const expression = new RegExp(escapeRegex(q), "i");
  const [destinations, transports, places] = await Promise.all([
    Destination.find({
      $or: [{ name: expression }, { province: expression }, { country: expression }],
    })
      .select("name province country latitude longitude")
      .limit(limit)
      .lean(),
    Transport.find({
      $or: [{ origin: expression }, { destination: expression }, { name: expression }],
    })
      .select("name origin destination latitude longitude")
      .limit(limit)
      .lean(),
    LocalPlace.find({
      $or: [{ name: expression }, { city: expression }, { location: expression }, { address: expression }],
    })
      .select("name city province location address latitude longitude module")
      .limit(limit)
      .lean(),
  ]);
  const seen = new Set();
  const out = [];
  const push = (location) => {
    if (!location) return;
    const key = location.name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(location);
  };
  for (const d of destinations) push(normalizeLocation(d, "destination"));
  for (const t of transports) {
    if (expression.test(t.origin || "")) push(normalizeLocation(t, "transport-hub", t.origin));
    if (out.length >= limit * 2) break;
    if (expression.test(t.destination || "")) push(normalizeLocation(t, "transport-hub", t.destination));
  }
  for (const p of places) push(normalizeLocation(p, "place"));
  return out.slice(0, limit);
}

/**
 * Strict date parsing. Accepts YYYY-MM-DD or a full ISO datetime
 * (e.g. 2026-10-07T00:00:00.000Z, as sent by some clients) and normalizes
 * to the canonical YYYY-MM-DD. The calendar date itself must be real —
 * 2026-02-30 is rejected (unlike `new Date()` leniency).
 */
function parseStrictDate(value) {
  if (typeof value !== "string") return null;
  const datePart = value.length > 10 ? value.slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  if (value.length > 10 && Number.isNaN(new Date(value).getTime())) return null;
  return datePart;
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Validate a departure/return pair. Order: presence → format → past → range.
 * Returns { success: true, startDate, endDate } or { success:false, code, message }.
 */
function validateTripDates({ startDate, endDate, requireEndDate = false, allowSameDay = false }) {
  if (!startDate || !String(startDate).trim()) {
    return { success: false, code: "DEPARTURE_DATE_REQUIRED", message: "Please select a departure date." };
  }
  const start = parseStrictDate(String(startDate).trim());
  if (!start) {
    return { success: false, code: "INVALID_DATE", message: "Please select a valid departure date." };
  }
  if (start < todayISO()) {
    return { success: false, code: "PAST_DATE", message: "Please select a future travel date." };
  }
  if (requireEndDate && (!endDate || !String(endDate).trim())) {
    return { success: false, code: "RETURN_DATE_REQUIRED", message: "Please select a return date." };
  }
  if (endDate && String(endDate).trim()) {
    const end = parseStrictDate(String(endDate).trim());
    if (!end) {
      return { success: false, code: "INVALID_DATE", message: "Please select a valid return date." };
    }
    if (end < start || (!allowSameDay && end === start)) {
      return { success: false, code: "INVALID_DATE_RANGE", message: "Return date must be after the departure date." };
    }
    return { success: true, startDate: start, endDate: end };
  }
  return { success: true, startDate: start, endDate: null };
}

module.exports = {
  INVALID_DESTINATION,
  INVALID_ORIGIN,
  findValidDestination,
  publicDestination,
  validateDestinationInput,
  findValidLocation,
  normalizeLocation,
  searchLocations,
  validateOriginInput,
  validateLocationInput,
  parseStrictDate,
  todayISO,
  validateTripDates,
};
