const Booking = require("../models/Booking");

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"];

function requestedRoomTypeMatches(roomType, adults, children, rooms) {
  return roomType.capacityAdults * rooms >= adults &&
    roomType.capacityChildren * rooms >= children;
}

async function addRoomAvailability(
  hotels,
  { checkIn, checkOut, adults, children, rooms },
  { includeUnavailable = false } = {}
) {
  if (!hotels.length) return [];
  const hotelIds = hotels.map((hotel) => hotel._id);
  const bookings = await Booking.find({
    itemType: "hotel",
    itemId: { $in: hotelIds },
    status: { $in: ACTIVE_BOOKING_STATUSES },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  }).select("itemId roomTypeId rooms checkIn checkOut").lean();

  const bookingsByType = new Map();
  const unassignedBookingsByHotel = new Map();
  for (const booking of bookings) {
    const hotelId = booking.itemId.toString();
    const interval = {
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      rooms: booking.rooms ?? 1,
    };
    if (!booking.roomTypeId) {
      const unassignedBookings = unassignedBookingsByHotel.get(hotelId) ?? [];
      unassignedBookings.push(interval);
      unassignedBookingsByHotel.set(hotelId, unassignedBookings);
      continue;
    }
    const key = `${hotelId}:${booking.roomTypeId.toString()}`;
    const typeBookings = bookingsByType.get(key) ?? [];
    typeBookings.push(interval);
    bookingsByType.set(key, typeBookings);
  }

  function maximumConcurrentRooms(typeBookings, unassignedBookings, totalRooms) {
    const rangeStart = checkIn.getTime();
    const rangeEnd = checkOut.getTime();
    const events = [];
    for (const booking of typeBookings) {
      events.push(
        { time: Math.max(rangeStart, booking.checkIn.getTime()), rooms: booking.rooms },
        { time: Math.min(rangeEnd, booking.checkOut.getTime()), rooms: -booking.rooms }
      );
    }
    for (const booking of unassignedBookings) {
      events.push(
        { time: Math.max(rangeStart, booking.checkIn.getTime()), rooms: totalRooms },
        { time: Math.min(rangeEnd, booking.checkOut.getTime()), rooms: -totalRooms }
      );
    }
    events.sort((left, right) => left.time - right.time || left.rooms - right.rooms);
    let occupiedRooms = 0;
    let maximumOccupiedRooms = 0;
    for (const event of events) {
      occupiedRooms += event.rooms;
      maximumOccupiedRooms = Math.max(maximumOccupiedRooms, occupiedRooms);
    }
    return maximumOccupiedRooms;
  }

  return hotels.map((hotel) => {
    const hotelId = hotel._id.toString();
    const unassignedBookings = unassignedBookingsByHotel.get(hotelId) ?? [];
    const roomTypes = (hotel.roomTypes ?? []).map((roomType) => {
      const bookedRooms = maximumConcurrentRooms(
        bookingsByType.get(`${hotelId}:${roomType._id}`) ?? [],
        unassignedBookings,
        roomType.totalRooms
      );
      const availableRooms = Math.max(0, roomType.totalRooms - bookedRooms);
      return {
        ...roomType,
        availableRooms,
        matchesOccupancy: requestedRoomTypeMatches(roomType, adults, children, rooms),
      };
    });
    const matchingRoomTypes = roomTypes.filter((roomType) =>
      roomType.matchesOccupancy && roomType.availableRooms >= rooms
    );
    return {
      ...hotel,
      roomTypes,
      availableForSearch: matchingRoomTypes.length > 0,
    };
  }).filter((hotel) => includeUnavailable || hotel.availableForSearch);
}

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  addRoomAvailability,
  requestedRoomTypeMatches,
};
