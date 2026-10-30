// Generic inventory helpers for seat/table/slot booking (destination-agnostic).
// No destination names appear here: everything is driven by database records.
const Booking = require("../models/Booking");

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"];

function utcDayRange(date) {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { dayStart, dayEnd };
}

// Seat labels for a transport service, e.g. ["1A","1B","1C","1D","2A",...].
// Uses explicit seatLabels when set, otherwise generates from seatMap.
// Returns null when the service has no seat-level inventory (whole-vehicle booking).
function seatLabelsForTransport(transport) {
  if (Array.isArray(transport.seatLabels) && transport.seatLabels.length > 0) {
    return [...transport.seatLabels];
  }
  const rows = Number(transport.seatMap?.rows) || 0;
  const perRow = Number(transport.seatMap?.seatsPerRow) || 0;
  if (!Number.isInteger(rows) || !Number.isInteger(perRow) || rows < 1 || perRow < 1) {
    return null;
  }
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ".slice(0, perRow);
  const labels = [];
  for (let row = 1; row <= rows; row += 1) {
    for (const letter of letters) labels.push(`${row}${letter}`);
  }
  const capacity = Number(transport.capacity) || labels.length;
  return labels.slice(0, Math.min(labels.length, capacity));
}

function normalizeSeatLabel(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

async function bookedSeatsForTransport(transportId, dayStart, dayEnd) {
  const existing = await Booking.find({
    itemType: "transport",
    itemId: transportId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    checkIn: { $gte: dayStart, $lt: dayEnd },
  }).select("seatNumbers guests").lean();
  const seats = new Set();
  let guestCount = 0;
  for (const booking of existing) {
    guestCount += Number(booking.guests) || 0;
    for (const seat of booking.seatNumbers || []) {
      if (seat) seats.add(String(seat).toUpperCase());
    }
  }
  return { bookedSeats: [...seats], bookedGuestCount: guestCount };
}

async function reservedTablesForRestaurant(restaurantId, dayStart, dayEnd, serviceTime) {
  const filter = {
    itemType: "restaurant",
    itemId: restaurantId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    checkIn: { $gte: dayStart, $lt: dayEnd },
  };
  if (serviceTime) filter.serviceTime = serviceTime;
  const existing = await Booking.find(filter).select("tableLabel").lean();
  return existing.map((booking) => booking.tableLabel).filter(Boolean);
}

async function slotUsageForActivity(activityId, dayStart, dayEnd, serviceTime) {
  const filter = {
    itemType: "activity",
    itemId: activityId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    checkIn: { $gte: dayStart, $lt: dayEnd },
  };
  if (serviceTime) filter.serviceTime = serviceTime;
  const existing = await Booking.find(filter).select("guests").lean();
  return existing.reduce((sum, booking) => sum + (Number(booking.guests) || 0), 0);
}

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  utcDayRange,
  seatLabelsForTransport,
  normalizeSeatLabel,
  bookedSeatsForTransport,
  reservedTablesForRestaurant,
  slotUsageForActivity,
};
