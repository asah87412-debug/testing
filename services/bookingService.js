const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Trip = require("../models/Trip");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const Restaurant = require("../models/Restaurant");
const LocalPlace = require("../models/LocalPlace");
const { addRoomAvailability, requestedRoomTypeMatches } = require("./hotelAvailability");
const { validateGuestCounts, validatePartySize } = require("../utils/quantityValidation");
const {
  utcDayRange,
  seatLabelsForTransport,
  normalizeSeatLabel,
  bookedSeatsForTransport,
  reservedTablesForRestaurant,
  slotUsageForActivity,
} = require("./inventory");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Create one service booking for a user with full inventory verification.
 * Shared by standalone POST /bookings and the complete-trip checkout, so
 * both flows enforce identical availability, capacity, and pricing rules.
 *
 * @param {ObjectId|string} userId owner of the booking
 * @param {object} body itemType, itemId, dates, party, roomTypeId, seats,
 *   table, serviceTime, tripId, paymentId, amount hints
 * @returns {{booking: object, message: string}} the saved booking (Mongoose doc)
 * @throws {HttpError} with .status for client errors
 */
async function createBookingRecord(userId, body) {
  const {
    itemType,
    itemId,
    itemName,
    location,
    checkIn,
    checkOut,
    guests = 1,
    adults,
    children = 0,
    rooms = 1,
    roomTypeId,
    amount,
  } = body || {};

  if (!["hotel", "transport", "restaurant", "activity", "trip"].includes(itemType)) {
    throw new HttpError(409, "This service cannot be booked in SuvYatra yet. Choose hotel, transport, restaurant, activity, or a saved trip.");
  }
  const serviceTime = typeof body?.serviceTime === "string" ? body.serviceTime.trim().slice(0, 20) : "";
  const tripId = mongoose.isValidObjectId(body?.tripId) ? body.tripId : undefined;
  const tripPaymentId = mongoose.isValidObjectId(body?.paymentId) ? body.paymentId : undefined;
  const requestedSeats = Array.isArray(body?.seatNumbers)
    ? [...new Set(body.seatNumbers.map(normalizeSeatLabel).filter(Boolean))].slice(0, 12)
    : [];
  const requestedTable = typeof body?.tableLabel === "string" ? body.tableLabel.trim().slice(0, 20) : "";
  const adultCount = adults === undefined ? guests : adults;
  if (!validateGuestCounts(adultCount, children, rooms)) {
    throw new HttpError(400, "Enter at least one adult, no more than 20 guests, and between 1 and 10 rooms.");
  }
  const startDate = checkIn ? new Date(checkIn) : undefined;
  const endDate = checkOut ? new Date(checkOut) : undefined;
  // Complete-trip records allow same-day travel (end == start); per-service
  // bookings below still require end > start.
  const endBeforeStart = itemType === "trip"
    ? (startDate && endDate && endDate < startDate)
    : (startDate && endDate && endDate <= startDate);
  if (
    (checkIn && Number.isNaN(startDate.getTime())) ||
    (checkOut && Number.isNaN(endDate.getTime())) ||
    (startDate && startDate < new Date(new Date().setHours(0, 0, 0, 0))) ||
    (startDate && endDate && endBeforeStart)
  ) {
    throw new HttpError(400, "Choose valid future booking dates.");
  }

  let bookingName = typeof itemName === "string" ? itemName.trim() : "";
  let bookingLocation = typeof location === "string" ? location.trim() : "";
  // Complete-trip record ("Plan My Trip" → My Bookings): links the saved
  // trip plan itself, with its destination/dates/party/total — no per-item
  // inventory to verify (that happens when services are booked).
  if (itemType === "trip") {
    if (!mongoose.isValidObjectId(body?.tripId)) {
      throw new HttpError(400, "A complete-trip booking must link to your saved trip.");
    }
    const trip = await Trip.findOne({ _id: body.tripId, userId }).lean();
    if (!trip) {
      throw new HttpError(404, "Trip plan not found. Bookings can only be linked to your own trips.");
    }
    // One trip record per saved trip — re-saving returns the existing one.
    const existing = await Booking.findOne({ userId, itemType: "trip", tripId: trip._id }).sort({ createdAt: -1 });
    if (existing) return { booking: existing, message: "This trip is already in My Bookings." };
    const tripAmount = Number.isFinite(Number(amount)) ? Number(amount) : Number(trip.totalAmount) || 0;
    if (tripAmount < 0 || tripAmount > 10000000) {
      throw new HttpError(400, "Booking details or estimated amount are invalid.");
    }
    const booking = await Booking.create({
      userId,
      itemType: "trip",
      tripId: trip._id,
      itemName: bookingName || `Complete trip to ${trip.destination || "Nepal"}`,
      location: bookingLocation || trip.destination || "Nepal",
      origin: trip.origin || undefined,
      originDetails: trip.originDetails || undefined,
      checkIn: startDate || trip.startDate || undefined,
      checkOut: endDate || trip.endDate || undefined,
      guests: adultCount + children,
      adults: adultCount,
      children,
      rooms,
      amount: Math.round(tripAmount),
      currency: "NPR",
      paymentStatus: "not_configured",
      amountIsEstimate: true,
      status: "pending",
    });
    await Trip.updateOne({ _id: trip._id }, { $addToSet: { bookingIds: booking._id } });
    return { booking, message: "Complete trip saved to My Bookings. Continue to sandbox payment when ready." };
  }
  // Snapshot of the source listing image so the booking always renders an
  // image in My Bookings / confirmations, independent of later changes.
  let sourceImage = {};
  let bookingAmount = Number(amount);
  let amountIsEstimate = itemType !== "hotel";
  let hotelId;
  let selectedRoomTypeId;
  let selectedRoomTypeName;
  let selectedSeats = [];
  let selectedTable = "";
  let storedParticipantAges = [];

  if (itemType === "hotel") {
    if (!mongoose.isValidObjectId(itemId)) {
      throw new HttpError(400, "Select a listed hotel before booking.");
    }
    if (!startDate || !endDate) {
      throw new HttpError(400, "Select valid check-in and check-out dates.");
    }
    try {
      const hotel = await Hotel.findOne({ _id: itemId, available: { $ne: false } }).lean();
      if (!hotel) throw new HttpError(404, "This hotel is not currently available.");
      if (hotel.isDemoData !== false) {
        throw new HttpError(409, "This is a demo hotel listing and cannot be used to create a booking request.");
      }
      if (!mongoose.isValidObjectId(roomTypeId)) {
        throw new HttpError(400, "Select a room type before requesting a hotel booking.");
      }
      const roomType = (hotel.roomTypes ?? []).find((type) => type._id.toString() === roomTypeId);
      if (!roomType || !requestedRoomTypeMatches(roomType, adultCount, children, rooms)) {
        throw new HttpError(409, "The selected room type cannot accommodate this occupancy.");
      }
      const [hotelWithAvailability] = await addRoomAvailability([hotel], {
        checkIn: startDate,
        checkOut: endDate,
        adults: adultCount,
        children,
        rooms,
      });
      const availableRoomType = hotelWithAvailability?.roomTypes.find((type) =>
        type._id.toString() === roomTypeId && type.matchesOccupancy
      );
      if (!availableRoomType || availableRoomType.availableRooms < rooms) {
        throw new HttpError(409, "That room type is no longer available for the selected dates and occupancy. Search again or choose another room type.");
      }
      const nights = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
      const nightlyRate = Number(roomType.nightlyRate ?? hotel.pricePerNight);
      if (!Number.isFinite(nightlyRate) || nightlyRate <= 0) {
        throw new HttpError(409, "This hotel does not have a confirmed rate yet.");
      }
      bookingName = hotel.name;
      bookingLocation = hotel.location || hotel.city || "";
      sourceImage = {
        image: hotel.image,
        images: Array.isArray(hotel.images) ? hotel.images.filter(Boolean) : [],
        imageSource: hotel.imageSource,
        imageSourcePage: hotel.imageSourcePage,
        imageLicense: hotel.imageLicense,
        imageCredit: hotel.imageCredit,
        imageDescription: hotel.imageDescription,
        imageRelevance: hotel.imageRelevance,
      };
      bookingAmount = Math.round(nightlyRate * nights * rooms);
      amountIsEstimate = true;
      hotelId = hotel._id;
      selectedRoomTypeId = roomType._id;
      selectedRoomTypeName = roomType.name;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Could not verify hotel booking:", error);
      throw new HttpError(500, "Could not verify this hotel's booking details.");
    }
  }

  if (itemType === "transport") {
    if (!mongoose.isValidObjectId(itemId)) {
      throw new HttpError(400, "Select a listed transport option before booking.");
    }
    if (!startDate) {
      throw new HttpError(400, "Select a valid future travel date.");
    }
    const partySize = adultCount + children;
    if (partySize < 1 || partySize > 12) {
      throw new HttpError(400, "Transport bookings support 1–12 passengers.");
    }
    try {
      const transport = await Transport.findById(itemId).lean();
      if (!transport) throw new HttpError(404, "This transport option is not available.");
      if (transport.isDemoData !== false) {
        throw new HttpError(409, "This is a demo transport listing and cannot be booked.");
      }
      // A scheduled/shared service whose origin and destination are the same
      // place is not a real route (local-hire rentals/taxis are exempt, since
      // same-city pickup genuinely is the service).
      const routeOrigin = typeof transport.origin === "string" ? transport.origin.trim().toLowerCase() : "";
      const routeDestination = typeof transport.destination === "string" ? transport.destination.trim().toLowerCase() : "";
      if (
        routeOrigin && routeOrigin === routeDestination &&
        ["scheduled", "shared"].includes((transport.serviceMode || "").toLowerCase())
      ) {
        throw new HttpError(400, "Origin and destination must be different for this transport service.");
      }
      // Real seat inventory: per-seat when the service defines a seat map,
      // otherwise per-head against capacity. Same UTC day = same departure.
      const { dayStart, dayEnd } = utcDayRange(startDate);
      const seatMap = seatLabelsForTransport(transport);
      selectedSeats = [];
      if (seatMap) {
        if (requestedSeats.length > 0) {
          const unknown = requestedSeats.filter((seat) => !seatMap.includes(seat));
          if (unknown.length > 0) {
            throw new HttpError(400, `Seat ${unknown.join(", ")} does not exist on this service.`);
          }
          if (requestedSeats.length !== partySize) {
            throw new HttpError(400, `Select exactly one seat per passenger (${partySize} seat(s) needed).`);
          }
          selectedSeats = requestedSeats;
        } else if (partySize <= seatMap.length) {
          // Auto-assign the first free seats when the client sends a headcount only.
          const { bookedSeats } = await bookedSeatsForTransport(transport._id, dayStart, dayEnd);
          const taken = new Set(bookedSeats);
          selectedSeats = seatMap.filter((seat) => !taken.has(seat)).slice(0, partySize);
        }
        const { bookedSeats } = await bookedSeatsForTransport(transport._id, dayStart, dayEnd);
        const taken = new Set(bookedSeats);
        const clash = selectedSeats.filter((seat) => taken.has(seat));
        if (clash.length > 0) {
          throw new HttpError(409, `Seat ${clash.join(", ")} was just booked. Please choose different seats.`);
        }
        if (selectedSeats.length + bookedSeats.length > seatMap.length) {
          throw new HttpError(409, `Only ${Math.max(0, seatMap.length - bookedSeats.length)} seat(s) left on this service for the selected date.`);
        }
      } else {
        const { bookedGuestCount } = await bookedSeatsForTransport(transport._id, dayStart, dayEnd);
        const capacity = Number(transport.capacity) || 0;
        if (capacity > 0 && bookedGuestCount + partySize > capacity) {
          throw new HttpError(409, `Only ${Math.max(0, capacity - bookedGuestCount)} seat(s) left on this service for the selected date.`);
        }
      }
      const unitPrice = Number(transport.price) || 0;
      const perPerson = ["shared", "scheduled"].includes(transport.serviceMode);
      bookingAmount = perPerson ? Math.round(unitPrice * partySize) : Math.round(unitPrice || 0);
      if (!Number.isFinite(bookingAmount) || bookingAmount < 0 || bookingAmount > 10000000) {
        throw new HttpError(409, "This transport option does not have a confirmed fare yet.");
      }
      if (bookingAmount <= 0) {
        throw new HttpError(409, `“${transport.name}” does not have a confirmed fare yet. Please choose another transport service.`);
      }
      bookingName = transport.name;
      bookingLocation = [transport.origin, transport.destination].filter(Boolean).join(" → ") || transport.route || "";
      sourceImage = {
        image: transport.image,
        images: Array.isArray(transport.images) ? transport.images.filter(Boolean) : [],
        imageSource: transport.imageSource,
        imageSourcePage: transport.imageSourcePage,
        imageLicense: transport.imageLicense,
        imageCredit: transport.imageCredit,
        imageDescription: transport.imageDescription,
        imageRelevance: transport.imageRelevance,
      };
      amountIsEstimate = false;
      hotelId = transport._id;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Could not verify transport booking:", error);
      throw new HttpError(500, "Could not verify this transport option.");
    }
  }

  if (itemType === "restaurant") {
    if (!mongoose.isValidObjectId(itemId)) {
      throw new HttpError(400, "Select a listed restaurant before reserving.");
    }
    if (!startDate) {
      throw new HttpError(400, "Select a valid future reservation date.");
    }
    const partySize = adultCount + children;
    if (partySize < 1 || partySize > 12) {
      throw new HttpError(400, "Restaurant reservations support 1–12 guests.");
    }
    try {
      const restaurant = await Restaurant.findById(itemId).lean();
      if (!restaurant) throw new HttpError(404, "This restaurant is not available.");
      if (restaurant.isDemoData !== false) {
        throw new HttpError(409, "This is a demo restaurant listing and cannot be reserved.");
      }
      // Table inventory: same date + same time slot double-booking is rejected.
      const { dayStart, dayEnd } = utcDayRange(startDate);
      const tables = Array.isArray(restaurant.tables) ? restaurant.tables : [];
      if (tables.length > 0) {
        const fitting = tables.filter((table) => Number(table.seats) >= partySize);
        if (fitting.length === 0) {
          throw new HttpError(409, "No table at this restaurant fits your party size for the selected time.");
        }
        const reserved = await reservedTablesForRestaurant(restaurant._id, dayStart, dayEnd, serviceTime);
        const reservedSet = new Set(reserved.map((label) => String(label).toUpperCase()));
        if (requestedTable) {
          const match = tables.find((table) => String(table.label).toUpperCase() === requestedTable.toUpperCase());
          if (!match) {
            throw new HttpError(400, `Table ${requestedTable} does not exist at this restaurant.`);
          }
          if (Number(match.seats) < partySize) {
            throw new HttpError(409, `Table ${match.label} seats ${match.seats} and cannot fit ${partySize} guests.`);
          }
          if (reservedSet.has(String(match.label).toUpperCase())) {
            throw new HttpError(409, `Table ${match.label} is already reserved for that date and time.`);
          }
          selectedTable = match.label;
        } else {
          const free = fitting.find((table) => !reservedSet.has(String(table.label).toUpperCase()));
          if (!free) {
            throw new HttpError(409, "All suitable tables are reserved for that date and time. Try another time.");
          }
          selectedTable = free.label;
        }
      } else if (requestedTable) {
        throw new HttpError(400, "This restaurant does not offer table selection.");
      }
      bookingName = restaurant.name;
      bookingLocation = restaurant.location || restaurant.city || "";
      sourceImage = {
        image: restaurant.image,
        images: Array.isArray(restaurant.images) ? restaurant.images.filter(Boolean) : [],
        imageSource: restaurant.imageSource,
        imageSourcePage: restaurant.imageSourcePage,
        imageLicense: restaurant.imageLicense,
        imageCredit: restaurant.imageCredit,
        imageDescription: restaurant.imageDescription,
        imageRelevance: restaurant.imageRelevance,
      };
      bookingAmount = 0; // pay at venue; recorded as reservation, not a charge.
      amountIsEstimate = true;
      hotelId = restaurant._id;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Could not verify restaurant reservation:", error);
      throw new HttpError(500, "Could not verify this restaurant.");
    }
  }

  if (itemType === "activity") {
    if (!mongoose.isValidObjectId(itemId)) {
      throw new HttpError(400, "Select a listed activity before booking.");
    }
    if (!startDate) {
      throw new HttpError(400, "Select a valid future activity date.");
    }
    const partySize = adultCount + children;
    if (!validatePartySize(partySize, 20)) {
      throw new HttpError(400, "Activity bookings support 1-20 participants.");
    }
    try {
      const activity = await LocalPlace.findOne({ _id: itemId, module: "activity" }).lean();
      if (!activity) throw new HttpError(404, "This activity is not available.");
      if (activity.isDemoData !== false) {
        throw new HttpError(409, "This is a demo activity listing and cannot be booked.");
      }
      // Prevent overbooking: per-slot capacity comes from the activity record,
      // falling back to a conservative default when the listing has none.
      const { dayStart, dayEnd } = utcDayRange(startDate);
      if (Array.isArray(activity.slots) && activity.slots.length > 0) {
        if (!serviceTime || !activity.slots.includes(serviceTime)) {
          throw new HttpError(400, `Select one of the scheduled slots: ${activity.slots.join(", ")}.`);
        }
      }
      const bookedCount = await slotUsageForActivity(activity._id, dayStart, dayEnd, serviceTime || undefined);
      const SLOT_CAPACITY = Number(activity.capacityPerSlot) > 0 ? Number(activity.capacityPerSlot) : 20;
      if (bookedCount + partySize > SLOT_CAPACITY) {
        throw new HttpError(409, `Only ${Math.max(0, SLOT_CAPACITY - bookedCount)} slot(s) left for this activity at the selected time.`);
      }
      // Age restriction is activity data (LocalPlace.minAge), enforced here —
      // never by display labels alone. Every participant must qualify.
      const minAge = Number(activity.minAge) > 0 ? Math.floor(Number(activity.minAge)) : 0;
      const rawAges = Array.isArray(body?.participantAges) ? body.participantAges : [];
      const participantAges = rawAges.map((value) => Number(value));
      if (minAge > 0) {
        if (participantAges.length !== partySize || participantAges.some((age) => !Number.isFinite(age) || age < 0 || age > 120)) {
          throw new HttpError(400, `This activity is restricted to participants aged ${minAge} and above. Provide every participant's age.`);
        }
        const underage = participantAges.filter((age) => age < minAge).length;
        if (underage > 0) {
          throw new HttpError(403, `This activity is restricted to participants aged ${minAge} and above. ${underage} participant(s) do not meet the age requirement.`);
        }
      }
      storedParticipantAges = participantAges.length === partySize ? participantAges : [];
      const unitPrice = Number(activity.price) || 0;
      bookingAmount = Math.round(unitPrice * partySize);
      if (!Number.isFinite(bookingAmount) || bookingAmount < 0 || bookingAmount > 10000000) {
        throw new HttpError(409, "This activity does not have a confirmed price yet.");
      }
      bookingName = activity.name;
      bookingLocation = activity.location || activity.city || "";
      sourceImage = {
        image: activity.image,
        images: Array.isArray(activity.images) ? activity.images.filter(Boolean) : [],
        imageSource: activity.imageSource,
        imageSourcePage: activity.imageSourcePage,
        imageLicense: activity.imageLicense,
        imageCredit: activity.imageCredit,
        imageDescription: activity.imageDescription,
        imageRelevance: activity.imageRelevance,
      };
      amountIsEstimate = false;
      hotelId = activity._id;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Could not verify activity booking:", error);
      throw new HttpError(500, "Could not verify this activity.");
    }
  }

  const amountRequired = itemType !== "restaurant";
  if (!bookingName || bookingName.length > 160 || !Number.isFinite(bookingAmount) || (amountRequired ? bookingAmount <= 0 : bookingAmount < 0) || bookingAmount > 10000000) {
    throw new HttpError(400, "Booking details or estimated amount are invalid.");
  }
  if (bookingLocation.length > 200) {
    throw new HttpError(400, "Booking location is too long.");
  }

  const isHotel = itemType === "hotel";
  let linkedTripId;
  if (tripId) {
    const trip = await Trip.findOne({ _id: tripId, userId }).select("_id").lean();
    if (!trip) {
      throw new HttpError(404, "Trip plan not found. Bookings can only be linked to your own trips.");
    }
    linkedTripId = trip._id;
  }
  const booking = await Booking.create({
    userId,
    itemType,
    itemId: hotelId,
    roomTypeId: selectedRoomTypeId,
    roomTypeName: selectedRoomTypeName,
    seatNumbers: itemType === "transport" ? selectedSeats : [],
    tableLabel: itemType === "restaurant" ? selectedTable || undefined : undefined,
    participantAges: itemType === "activity" && storedParticipantAges.length ? storedParticipantAges : undefined,
    tripId: linkedTripId,
    paymentId: tripPaymentId,
    itemName: bookingName,
    location: bookingLocation,
    image: sourceImage.image || undefined,
    images: sourceImage.images && sourceImage.images.length ? sourceImage.images : undefined,
    imageSource: sourceImage.imageSource,
    imageSourcePage: sourceImage.imageSourcePage,
    imageLicense: sourceImage.imageLicense,
    imageCredit: sourceImage.imageCredit,
    imageDescription: sourceImage.imageDescription,
    imageRelevance: ["entity", "category"].includes(sourceImage.imageRelevance) ? sourceImage.imageRelevance : undefined,
    checkIn: startDate,
    checkOut: isHotel ? endDate : undefined,
    serviceTime: serviceTime || undefined,
    guests: adultCount + children,
    adults: adultCount,
    children,
    rooms: isHotel ? rooms : 1,
    amount: bookingAmount,
    currency: "NPR",
    paymentStatus: "not_configured",
    amountIsEstimate,
    status: "pending",
  });
  if (linkedTripId) {
    await Trip.updateOne({ _id: linkedTripId }, { $addToSet: { bookingIds: booking._id } });
  }
  const messages = {
    hotel: "Booking request saved as pending after checking room inventory. Provider confirmation is still required, and pending requests remain included in availability until canceled.",
    transport: "Transport booking saved as pending after checking seat inventory. Continue to sandbox payment to confirm.",
    restaurant: "Restaurant reservation recorded as pending. No prepayment is taken; pay at the venue. The restaurant record is stored in My Bookings.",
    activity: "Activity booking saved as pending after checking slot capacity. Continue to sandbox payment to confirm.",
  };
  return { booking, message: messages[itemType] || "Booking saved as pending." };
}

module.exports = { createBookingRecord, HttpError };
