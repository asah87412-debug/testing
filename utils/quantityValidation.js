// Shared quantity validation for guest, room and participant counts.
// One consistent rule set used by hotel availability, bookings, trips and
// activity flows: whole numbers inside per-field caps.
//
// Caps: Adults 1-20, Children 0-20, Rooms 1-10, activity Participants 1-20.
// Tighter per-record limits (room capacity, slot capacity, transport and
// restaurant party size) are enforced separately by their own checks and
// are NOT overridden here.

const QUANTITY_LIMITS = {
  adults: { min: 1, max: 20 },
  children: { min: 0, max: 20 },
  rooms: { min: 1, max: 10 },
  participants: { min: 1, max: 20 },
};

function isWholeInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Hotel-style guest counts with a combined party cap (availability search
// and hotel bookings share the 20-guest ceiling).
function validateGuestCounts(adults, children, rooms, maxTotal = 20) {
  if (
    !isWholeInRange(adults, QUANTITY_LIMITS.adults.min, QUANTITY_LIMITS.adults.max) ||
    !isWholeInRange(children, QUANTITY_LIMITS.children.min, QUANTITY_LIMITS.children.max) ||
    !isWholeInRange(rooms, QUANTITY_LIMITS.rooms.min, QUANTITY_LIMITS.rooms.max) ||
    adults + children > maxTotal
  ) {
    return false;
  }
  return true;
}

// Standalone party size (activity bookings).
function validatePartySize(partySize, max = 20) {
  return Number.isInteger(partySize) && partySize >= 1 && partySize <= max;
}

// Normalize anything unexpected (query params, stored state, API data) into a
// safe integer inside [min, max]. Never NaN, never Infinity, never throws.
function normalizeQuantity(value, field) {
  const limits = QUANTITY_LIMITS[field] || { min: 0, max: 20 };
  const numeric = typeof value === "number" ? value : Number(String(value ?? ""));
  if (Number.isNaN(numeric)) return limits.min;
  if (numeric === Infinity) return limits.max;
  if (numeric === -Infinity) return limits.min;
  return Math.min(limits.max, Math.max(limits.min, Math.trunc(numeric)));
}

module.exports = {
  QUANTITY_LIMITS,
  isWholeInRange,
  validateGuestCounts,
  validatePartySize,
  normalizeQuantity,
};
