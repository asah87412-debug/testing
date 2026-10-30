const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Trip = require("../models/Trip");
const TripPayment = require("../models/TripPayment");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const User = require("../models/User");
const PDFDocument = require("pdfkit");
const { createBookingRecord, HttpError } = require("../services/bookingService");
const authMiddleware = require("../middleware/auth");

// Demo/sandbox wallet + card methods supported across My Bookings payments.
const STANDBOOK_METHODS = ["esewa", "khalti", "imepay", "fonepay", "connectips", "prabhupay", "namastepay", "bank_card"];

// --- Completed-trip PDF helpers (actual booking data only; every section is
// optional and skipped gracefully when the record does not carry it). ---
function pdfText(value, fallback = "—") {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function pdfDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function pdfDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function pdfDurationNights(checkIn, checkOut) {
  const start = checkIn ? new Date(checkIn).getTime() : NaN;
  const end = checkOut ? new Date(checkOut).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const nights = Math.round((end - start) / 86400000);
  return `${nights} night${nights === 1 ? "" : "s"} · ${nights + 1} day${nights + 1 === 1 ? "" : "s"}`;
}

function pdfMoney(value, currency) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return null;
  return `${currency || "NPR"} ${Number(value).toLocaleString("en-IN")}`;
}

function pdfDuration(minutes) {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h}h ` : ""}${m ? `${m}m` : ""}`.trim() || null;
}

function buildTripPdf(booking, trip, user) {
  return new Promise((resolve, reject) => {
    // Uncompressed so booking references stay plain-text searchable;
    // buffered so page numbers can be stamped on every page at the end.
    const doc = new PDFDocument({ size: "A4", margin: 48, compress: false, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const selections = trip && trip.selections && typeof trip.selections === "object" && !Array.isArray(trip.selections)
      ? trip.selections
      : {};
    const selText = (value) => (value === undefined || value === null || String(value).trim() === "" ? null : String(value));

    // Header
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#047857").text("SuvYatra", { align: "left" });
    doc.font("Helvetica").fontSize(11).fillColor("#52657A")
      .text("AI-Based Trip Planner · Nepal", { align: "left" });
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0F172A")
      .text(pdfText(booking.itemName, "Completed Trip"), { align: "left" });
    doc.font("Helvetica").fontSize(10).fillColor("#52657A")
      .text(`Booking reference: ${pdfText(booking.bookingCode)}   ·   Booking ID: ${pdfText(booking._id)}`);
    doc.moveDown(0.6);
    doc.strokeColor("#A7F3D0").lineWidth(1)
      .moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.6);

    const section = (title) => {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#047857").text(title);
      doc.moveDown(0.25);
    };
    const row = (label, value) => {
      const text = selText(value);
      if (text === null) return;
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A").text(`${label}: `, { continued: true });
      doc.font("Helvetica").fontSize(10).text(text);
    };

    // Traveller
    section("Traveller");
    row("Name", user && user.name);
    row("Email", user && user.email);
    doc.moveDown(0.4);

    // Journey
    section("Journey");
    row("Origin", booking.origin || (trip && trip.origin));
    row("Destination", booking.location || (trip && trip.destination));
    if (selections.destinationProvince || selections.destinationCountry) {
      row("Region", [selections.destinationProvince, selections.destinationCountry].filter(Boolean).join(", "));
    }
    const checkIn = booking.checkIn || (trip && trip.startDate);
    const checkOut = booking.checkOut || (trip && trip.endDate);
    if (checkIn || checkOut) {
      row("Travel dates", `${checkIn ? pdfDate(checkIn) : "—"}  →  ${checkOut ? pdfDate(checkOut) : "—"}`);
    }
    const duration = pdfDurationNights(checkIn, checkOut)
      || (trip && trip.durationDays ? `${trip.durationDays} day${trip.durationDays === 1 ? "" : "s"}` : null);
    if (duration) row("Trip duration", duration);
    const partyBits = [];
    if (booking.adults !== undefined && booking.adults !== null) partyBits.push(`${booking.adults} adult${booking.adults === 1 ? "" : "s"}`);
    if (booking.children) partyBits.push(`${booking.children} ${booking.children === 1 ? "child" : "children"}`);
    if (booking.rooms) partyBits.push(`${booking.rooms} room${booking.rooms === 1 ? "" : "s"}`);
    if (selections.party && selections.party.participants) partyBits.push(`${selections.party.participants} participant(s)`);
    if (partyBits.length) row("Party", partyBits.join(" · "));
    doc.moveDown(0.4);

    // Accommodation
    const hotel = selections.hotel;
    if (hotel && typeof hotel === "object") {
      section("Accommodation");
      row("Hotel", hotel.name);
      row("Location", hotel.location);
      row("Room", hotel.room);
      row("Bed", hotel.bedConfiguration);
      if (hotel.breakfastIncluded) row("Breakfast", "Included");
      if (hotel.capacityAdults !== undefined || hotel.capacityChildren !== undefined) {
        row("Room fits", `Up to ${hotel.capacityAdults ?? "—"} adult(s) · ${hotel.capacityChildren ?? "—"} child(ren)`);
      }
      row("Rating", hotel.rating);
      if (hotel.checkIn || hotel.checkOut) row("Stay", `${hotel.checkIn ? pdfDate(hotel.checkIn) : "—"}  →  ${hotel.checkOut ? pdfDate(hotel.checkOut) : "—"}`);
      if (hotel.nights !== undefined || hotel.rooms !== undefined) {
        row("Nights / rooms", `${hotel.nights !== undefined ? `${hotel.nights} night(s)` : "—"} · ${hotel.rooms !== undefined ? `${hotel.rooms} room(s)` : "—"}`);
      }
      const rate = pdfMoney(hotel.nightlyRate);
      if (rate) row("Nightly rate", `${rate}/night`);
      const hotelTotal = pdfMoney(hotel.amount);
      if (hotelTotal) row("Hotel total", hotelTotal);
      doc.moveDown(0.4);
    } else if (booking.roomTypeName || booking.rooms) {
      section("Accommodation");
      row("Room type", booking.roomTypeName);
      row("Rooms", booking.rooms);
      doc.moveDown(0.4);
    }

    // Transportation
    const legs = [selections.outbound, selections.return, selections.local].filter((leg) => leg && typeof leg === "object" && (leg.name || leg.label));
    if (legs.length) {
      section("Transportation");
      for (const leg of legs) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A")
          .text(`· ${selText(leg.label) || selText(leg.name) || "Transport service"}`);
        const vehicleBits = [leg.vehicleType, leg.provider].filter((part) => part !== undefined && part !== null && String(part).trim() !== "").map(String);
        if (vehicleBits.length) {
          doc.font("Helvetica").fontSize(10).text(`  ${vehicleBits.join(" · ")}`);
        }
        if (leg.origin || leg.destination) row("  Route", `${leg.origin || "—"} → ${leg.destination || "—"}`);
        row("  Date", leg.date ? pdfDate(leg.date) : null);
        if (leg.departureTime || leg.arrivalTime) row("  Time", `${leg.departureTime || "—"} → ${leg.arrivalTime || "—"}`);
        row("  Duration", pdfDuration(leg.durationMinutes));
        if (leg.adults !== undefined || leg.children !== undefined) {
          row("  Passengers", `${leg.adults ?? 0} adult(s) · ${leg.children ?? 0} child(ren)`);
        }
        row("  Seats", Array.isArray(leg.seats) ? leg.seats.join(", ") : leg.seats);
        const unit = pdfMoney(leg.unitPrice);
        if (unit) row("  Fare", leg.priceBasis ? `${unit} (${leg.priceBasis})` : unit);
        const fare = pdfMoney(leg.amount);
        if (fare) row("  Leg total", fare);
      }
      doc.moveDown(0.4);
    }

    // Activities
    const activity = selections.activity;
    if (activity && typeof activity === "object") {
      section("Activities");
      const bits = [activity.name, activity.date ? pdfDate(activity.date) : null, activity.slot ? `@ ${activity.slot}` : null]
        .filter(Boolean).join(" · ");
      if (bits) {
        doc.font("Helvetica").fontSize(10).fillColor("#0F172A").text(`· ${bits}`);
      }
      row("  Location", activity.location);
      row("  Duration", pdfDuration(activity.durationMinutes));
      row("  Meeting point", activity.meetingPoint);
      row("  Participants", activity.participants);
      const unitPrice = pdfMoney(activity.unitPrice);
      if (unitPrice) row("  Price", `${unitPrice}/person`);
      const activityTotal = pdfMoney(activity.amount);
      if (activityTotal) row("  Activity total", activityTotal);
      doc.moveDown(0.4);
    }
    if (selections.restaurant && typeof selections.restaurant === "object") {
      section("Restaurant");
      row("Restaurant", selections.restaurant.name);
      row("Location", selections.restaurant.location);
      row("Category", selections.restaurant.category);
      row("Cuisine", Array.isArray(selections.restaurant.cuisine) ? selections.restaurant.cuisine.join(", ") : selections.restaurant.cuisine);
      row("Price range", selections.restaurant.priceRange);
      row("Reservation date", selections.restaurant.date ? pdfDate(selections.restaurant.date) : null);
      row("Guests", selections.restaurant.guests);
      doc.font("Helvetica").fontSize(10).fillColor("#52657A").text("Pay at venue · NPR 0 in trip total.");
      doc.moveDown(0.4);
    }

    // Planned stops in selection order (attractions then hidden gems).
    const stops = Array.isArray(selections.stops)
      ? selections.stops.filter((s) => s && s.name)
      : [];
    const fallbackStops = !stops.length && trip && Array.isArray(trip.plannedItems)
      ? trip.plannedItems.filter((item) => item && item.name)
      : [];
    if (stops.length || fallbackStops.length) {
      section("Planned stops (in order)");
      stops.forEach((stop, index) => {
        doc.font("Helvetica").fontSize(10).fillColor("#0F172A")
          .text(`${index + 1}. ${stop.name}${stop.kind ? ` (${stop.kind})` : ""}${stop.location ? ` · ${stop.location}` : ""}`);
      });
      fallbackStops.slice(0, 50).forEach((item, index) => {
        doc.font("Helvetica").fontSize(10).fillColor("#0F172A")
          .text(`${index + 1}. ${item.name}${item.category ? ` (${item.category})` : ""}${item.location ? ` · ${item.location}` : ""}`);
      });
      doc.moveDown(0.4);
    }

    // Day-by-day itinerary (saved trip plan, when present).
    const days = trip && Array.isArray(trip.itinerary) ? trip.itinerary.filter((d) => d && Array.isArray(d.items) && d.items.length > 0) : [];
    if (days.length) {
      section("Itinerary");
      for (const day of days) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A")
          .text(`Day ${day.day}${day.date ? ` · ${pdfDate(day.date)}` : ""}${day.focus ? ` — ${day.focus}` : ""}`);
        for (const item of day.items) {
          if (!item || !item.name) continue;
          doc.font("Helvetica").fontSize(10).text(`· ${item.name}${item.entityType ? ` (${item.entityType})` : ""}`);
        }
      }
      doc.moveDown(0.4);
    }

    // Cost breakdown (itemized) + payment
    section("Price breakdown");
    const totals = selections.totals && typeof selections.totals === "object" ? selections.totals : {};
    const hotelLine = pdfMoney(totals.hotel, totals.currency);
    if (hotelLine) row("Hotel", hotelLine);
    const transportLine = pdfMoney(totals.transportation, totals.currency);
    if (transportLine) row("Transportation", transportLine);
    const activitiesLine = pdfMoney(totals.activities, totals.currency);
    if (activitiesLine) row("Activities", activitiesLine);
    section("Cost & payment");
    row("Final trip cost", `${booking.currency || "NPR"} ${Number(booking.amount || 0).toLocaleString("en-IN")}`);
    row("Booking status", booking.status === "completed" ? "Completed" : pdfText(booking.status));
    row("Admin confirmation", booking.approvalStatus === "approved" ? "Confirmed" : pdfText(booking.approvalStatus));
    row("Payment status", booking.paymentStatus === "paid" ? "Paid" : pdfText(booking.paymentStatus));
    row("Payment method", booking.paymentMethod);
    row("Payment reference", booking.paymentReference);
    if (booking.paymentConfirmedAt) row("Paid at", pdfDateTime(booking.paymentConfirmedAt));
    if (booking.amountIsEstimate) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor("#52657A")
        .text("Amounts were estimated from listed rates at booking time.");
    }
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(9).fillColor("#94A3B8")
      .text(`Generated by SuvYatra on ${pdfDateTime(new Date())} · Booking status: ${pdfText(booking.status)}`, { align: "center" });
    // Page numbers on every page (content flows automatically across pages).
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(9).fillColor("#94A3B8")
        .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 32, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "center",
        });
    }
    doc.end();
  });
}

// --- Individual booking PDFs (hotel / transport / activity). Same branding,
// helpers, and download behavior as the trip PDF; every field optional and
// skipped gracefully. Read-only: never mutates bookings, payments, or trips.
function pdfCell(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function pdfStatusLabel(value) {
  const map = {
    pending: "Pending",
    confirmed: "Confirmed",
    accepted: "Accepted",
    rejected: "Rejected",
    cancelled: "Cancelled",
    completed: "Completed",
    approved: "Approved",
    paid: "Paid",
    failed: "Failed",
    refunded: "Refunded",
    not_configured: "Not configured",
  };
  const key = String(value || "").trim().toLowerCase();
  return map[key] || pdfText(value);
}

function pdfFilename(prefix, booking) {
  const ref = String(booking.bookingCode || booking._id).replace(/[^A-Za-z0-9_-]/g, "");
  return `SuvYatra_${prefix}_${ref}.pdf`;
}

function openServicePdf() {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: false, bufferPages: true });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { doc, done };
}

function pdfSection(doc, title) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#047857").text(title);
  doc.moveDown(0.25);
}

function pdfRow(doc, label, value) {
  const text = pdfCell(value);
  if (text === null) return;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A").text(`${label}: `, { continued: true });
  doc.font("Helvetica").fontSize(10).text(text);
}

function closeServicePdf(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(9).fillColor("#94A3B8")
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 32, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
  }
  doc.end();
}

function writeServicePdfHeader(doc, title, booking) {
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#047857").text("SuvYatra", { align: "left" });
  doc.font("Helvetica").fontSize(11).fillColor("#52657A").text("AI-Based Trip Planner · Nepal", { align: "left" });
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0F172A").text(title, { align: "left" });
  doc.font("Helvetica").fontSize(10).fillColor("#52657A")
    .text(`Booking reference: ${pdfText(booking.bookingCode)}   ·   Booking ID: ${pdfText(booking._id)}`);
  if (booking.createdAt) doc.text(`Booked on: ${pdfDateTime(booking.createdAt)}`);
  doc.moveDown(0.6);
  doc.strokeColor("#A7F3D0").lineWidth(1)
    .moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.6);
}

function writeServicePdfTraveller(doc, user) {
  pdfSection(doc, "Traveller");
  pdfRow(doc, "Name", user && user.name);
  pdfRow(doc, "Email", user && user.email);
  doc.moveDown(0.4);
}

function writeServicePdfCostPayment(doc, booking) {
  pdfSection(doc, "Cost & payment");
  pdfRow(doc, "Total charged", `${booking.currency || "NPR"} ${Number(booking.amount || 0).toLocaleString("en-IN")}`);
  pdfRow(doc, "Booking status", pdfStatusLabel(booking.status));
  if (booking.approvalStatus) pdfRow(doc, "Admin confirmation", pdfStatusLabel(booking.approvalStatus));
  pdfRow(doc, "Payment status", pdfStatusLabel(booking.paymentStatus));
  pdfRow(doc, "Payment method", booking.paymentMethod);
  pdfRow(doc, "Payment reference", booking.paymentReference);
  if (booking.paymentConfirmedAt) pdfRow(doc, "Paid at", pdfDateTime(booking.paymentConfirmedAt));
  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(9).fillColor("#94A3B8")
    .text(`Generated by SuvYatra on ${pdfDateTime(new Date())} · Booking status: ${pdfStatusLabel(booking.status)}`, { align: "center" });
}

async function findBookingCatalog(booking) {
  try {
    if (!mongoose.isValidObjectId(booking.itemId)) return null;
    if (booking.itemType === "hotel") return await Hotel.findById(booking.itemId).lean();
    if (booking.itemType === "transport") return await Transport.findById(booking.itemId).lean();
    if (booking.itemType === "activity") {
      return await LocalPlace.findOne({ _id: booking.itemId, module: "activity" }).lean();
    }
  } catch {
    return null;
  }
  return null;
}

function buildHotelPdf(booking, hotel, user) {
  const { doc, done } = openServicePdf();
  const finish = (err) => (err ? Promise.reject(err) : (closeServicePdf(doc), done));
  return Promise.resolve()
    .then(() => {
      writeServicePdfHeader(doc, "Hotel Booking Details", booking);
      writeServicePdfTraveller(doc, user);
      pdfSection(doc, "Hotel");
      pdfRow(doc, "Hotel", booking.itemName);
      const address = hotel
        ? [hotel.location, hotel.city, hotel.district, hotel.province].filter((p) => p && String(p).trim()).join(", ")
        : null;
      pdfRow(doc, "Address", address || booking.location);
      if (hotel) {
        pdfRow(doc, "Destination", hotel.destination);
        if (hotel.rating !== undefined) {
          pdfRow(doc, "Rating", `${hotel.rating}${hotel.reviewCount !== undefined ? ` (${hotel.reviewCount} reviews)` : ""}`);
        }
        pdfRow(doc, "Description", hotel.description);
      }
      pdfRow(doc, "Check-in", booking.checkIn ? pdfDate(booking.checkIn) : null);
      pdfRow(doc, "Check-out", booking.checkOut ? pdfDate(booking.checkOut) : null);
      const nights = pdfDurationNights(booking.checkIn, booking.checkOut);
      if (nights) pdfRow(doc, "Stay", nights);
      const room = hotel && Array.isArray(hotel.roomTypes)
        ? hotel.roomTypes.find((r) => String(r._id) === String(booking.roomTypeId))
        : null;
      pdfSection(doc, "Room");
      pdfRow(doc, "Room type", booking.roomTypeName || (room && room.name));
      pdfRow(doc, "Rooms", booking.rooms);
      const bed = (room && room.bedConfiguration) || null;
      pdfRow(doc, "Bed configuration", bed);
      if (room && (room.capacityAdults !== undefined || room.capacityChildren !== undefined)) {
        pdfRow(doc, "Room fits", `Up to ${room.capacityAdults ?? "—"} adult(s) · ${room.capacityChildren ?? "—"} child(ren)`);
      }
      if (room && room.breakfastIncluded) pdfRow(doc, "Breakfast", "Included");
      const amenities = (room && room.amenities && room.amenities.length ? room.amenities : hotel && hotel.amenities) || [];
      if (amenities.length) pdfRow(doc, "Amenities", amenities.slice(0, 8).join(", "));
      if (hotel) {
        pdfRow(doc, "Check-in time", hotel.checkInTime);
        pdfRow(doc, "Check-out time", hotel.checkOutTime);
        if (hotel.policies && hotel.policies.length) pdfRow(doc, "Policies", hotel.policies.slice(0, 4).join(" · "));
        pdfRow(doc, "Cancellation policy", hotel.cancellationPolicy);
        if (hotel.contact && (hotel.contact.phone || hotel.contact.email)) {
          pdfRow(doc, "Hotel contact", [hotel.contact.phone, hotel.contact.email].filter(Boolean).join(" · "));
        }
      }
      pdfSection(doc, "Guests");
      const party = [];
      if (booking.adults !== undefined && booking.adults !== null) party.push(`${booking.adults} adult${booking.adults === 1 ? "" : "s"}`);
      if (booking.children) party.push(`${booking.children} ${booking.children === 1 ? "child" : "children"}`);
      if (party.length) pdfRow(doc, "Party", party.join(" · "));
      pdfRow(doc, "Total guests", booking.guests);
      pdfSection(doc, "Pricing");
      const nightly = (room && room.nightlyRate !== undefined ? room.nightlyRate : hotel && hotel.pricePerNight);
      const nightlyLine = pdfMoney(nightly);
      if (nightlyLine) pdfRow(doc, "Nightly rate", `${nightlyLine}/night`);
      if (booking.amountIsEstimate) {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#52657A")
          .text("Total was estimated from the listed nightly rate at booking time.");
      }
      writeServicePdfCostPayment(doc, booking);
    })
    .then(() => finish(), (err) => finish(err));
}

function buildTransportPdf(booking, vehicle, user) {
  const { doc, done } = openServicePdf();
  const finish = (err) => (err ? Promise.reject(err) : (closeServicePdf(doc), done));
  return Promise.resolve()
    .then(() => {
      writeServicePdfHeader(doc, "Transportation Booking Details", booking);
      writeServicePdfTraveller(doc, user);
      pdfSection(doc, "Service");
      pdfRow(doc, "Service", booking.itemName);
      pdfRow(doc, "Vehicle type", vehicle && vehicle.type);
      pdfRow(doc, "Provider", vehicle && vehicle.provider);
      const route = vehicle && (vehicle.origin || vehicle.destination)
        ? `${vehicle.origin || "—"} → ${vehicle.destination || "—"}`
        : (vehicle && vehicle.route) || booking.location;
      pdfRow(doc, "Route", route);
      pdfRow(doc, "Description", vehicle && vehicle.description);
      pdfSection(doc, "Journey");
      pdfRow(doc, "Travel date", booking.checkIn ? pdfDate(booking.checkIn) : null);
      pdfRow(doc, "Service time", booking.serviceTime);
      if (vehicle) {
        if (vehicle.departureTime || vehicle.arrivalTime) {
          pdfRow(doc, "Time", `${vehicle.departureTime || "—"} → ${vehicle.arrivalTime || "—"}`);
        }
        pdfRow(doc, "Journey duration", pdfDuration(vehicle.durationMinutes));
        pdfRow(doc, "Pickup", vehicle.origin);
        pdfRow(doc, "Drop-off", vehicle.destination);
        if (vehicle.capacity) pdfRow(doc, "Vehicle capacity", vehicle.capacity);
        pdfRow(doc, "Service mode", vehicle.serviceMode);
      }
      pdfSection(doc, "Passengers");
      const party = [];
      if (booking.adults !== undefined && booking.adults !== null) party.push(`${booking.adults} adult${booking.adults === 1 ? "" : "s"}`);
      if (booking.children) party.push(`${booking.children} ${booking.children === 1 ? "child" : "children"}`);
      if (party.length) pdfRow(doc, "Party", party.join(" · "));
      pdfRow(doc, "Total passengers", booking.guests);
      if (booking.seatNumbers && booking.seatNumbers.length) {
        pdfRow(doc, "Seats", booking.seatNumbers.join(", "));
      }
      pdfSection(doc, "Pricing");
      const unit = pdfMoney(vehicle && vehicle.price);
      if (unit) {
        const basis = vehicle && ["shared", "scheduled"].includes(vehicle.serviceMode)
          ? "per person"
          : vehicle && vehicle.serviceMode ? "per vehicle" : null;
        pdfRow(doc, "Unit price", basis ? `${unit} (${basis})` : unit);
      }
      if (vehicle && vehicle.amenities && vehicle.amenities.length) {
        pdfRow(doc, "Amenities", vehicle.amenities.slice(0, 8).join(", "));
      }
      writeServicePdfCostPayment(doc, booking);
    })
    .then(() => finish(), (err) => finish(err));
}

function buildActivityPdf(booking, activity, user) {
  const { doc, done } = openServicePdf();
  const finish = (err) => (err ? Promise.reject(err) : (closeServicePdf(doc), done));
  return Promise.resolve()
    .then(() => {
      writeServicePdfHeader(doc, "Activity Booking Details", booking);
      writeServicePdfTraveller(doc, user);
      pdfSection(doc, "Activity");
      pdfRow(doc, "Activity", booking.itemName);
      pdfRow(doc, "Description", activity && activity.description);
      const place = activity
        ? [activity.location, activity.address, activity.city, activity.district, activity.province].filter((p) => p && String(p).trim()).join(", ")
        : null;
      pdfRow(doc, "Location", place || booking.location);
      if (activity) {
        pdfRow(doc, "Category", activity.category);
        pdfRow(doc, "Best season", activity.bestSeason);
      }
      pdfSection(doc, "Schedule");
      pdfRow(doc, "Date", booking.checkIn ? pdfDate(booking.checkIn) : null);
      pdfRow(doc, "Time slot", booking.serviceTime);
      if (activity) {
        pdfRow(doc, "Duration", pdfDuration(activity.durationMinutes));
        pdfRow(doc, "Meeting point", activity.meetingPoint);
      }
      pdfSection(doc, "Participants");
      const party = [];
      if (booking.adults !== undefined && booking.adults !== null) party.push(`${booking.adults} adult${booking.adults === 1 ? "" : "s"}`);
      if (booking.children) party.push(`${booking.children} ${booking.children === 1 ? "child" : "children"}`);
      if (party.length) pdfRow(doc, "Party", party.join(" · "));
      pdfRow(doc, "Total participants", booking.guests);
      if (booking.participantAges && booking.participantAges.length) {
        pdfRow(doc, "Participant ages", booking.participantAges.join(", "));
      }
      if (activity) {
        if (activity.minAge) pdfRow(doc, "Minimum age", activity.minAge);
        if (activity.requirements && activity.requirements.length) {
          pdfRow(doc, "Eligibility", activity.requirements.slice(0, 6).join(" · "));
        }
        if (activity.includedServices && activity.includedServices.length) {
          pdfRow(doc, "Included", activity.includedServices.slice(0, 8).join(", "));
        }
        pdfRow(doc, "Cancellation policy", activity.cancellationPolicy);
      }
      pdfSection(doc, "Pricing");
      const unit = pdfMoney(activity && activity.price);
      if (unit) pdfRow(doc, "Price per participant", unit);
      if (booking.amountIsEstimate) {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor("#52657A")
          .text("Total was estimated from the listed price at booking time.");
      }
      writeServicePdfCostPayment(doc, booking);
    })
    .then(() => finish(), (err) => finish(err));
}

// Completed-trip PDF download: the traveller's own completed trip only.
// Defined BEFORE the auth middleware below so native apps (which cannot set
// headers on a system download/open URL) may pass ?token=<accessToken>;
// browsers use the standard Authorization header via fetch+blob instead.
router.get("/:id/pdf", async (req, res, next) => {
  try {
    if (!req.headers.authorization && typeof req.query.token === "string" && req.query.token.trim()) {
      req.headers.authorization = `Bearer ${req.query.token.trim()}`;
    }
    return authMiddleware(req, res, next);
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const booking = await Booking.findById(req.params.id).populate({ path: "tripId" }).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (req.user.role !== "admin" && booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only download your own booking PDFs." });
    }
    if (!["trip", "hotel", "transport", "activity"].includes(booking.itemType)) {
      return res.status(403).json({ message: "A PDF is not available for this booking type." });
    }
    if (booking.itemType === "trip" && booking.status !== "completed") {
      return res.status(403).json({ message: "The trip PDF is available only after the admin marks the trip completed." });
    }
    // Activity PDFs unlock only on verified admin completion: payment alone,
    // a filled form alone, or a pending review must never enable them.
    if (booking.itemType === "activity" && booking.status !== "completed") {
      return res.status(403).json({ message: "The activity PDF will be available after admin completion." });
    }
    const user = await User.findById(booking.userId).select("name email").lean();
    let buffer;
    let filename;
    if (booking.itemType === "trip") {
      buffer = await buildTripPdf(booking, booking.tripId || null, user);
      filename = pdfFilename("Trip", booking);
    } else {
      // Individual service PDFs show the booking's own current status and
      // never change it: generation is strictly read-only.
      const catalog = await findBookingCatalog(booking);
      if (booking.itemType === "hotel") {
        buffer = await buildHotelPdf(booking, catalog, user);
        filename = pdfFilename("Hotel", booking);
      } else if (booking.itemType === "transport") {
        buffer = await buildTransportPdf(booking, catalog, user);
        filename = pdfFilename("Transport", booking);
      } else {
        buffer = await buildActivityPdf(booking, catalog, user);
        filename = pdfFilename("Activity", booking);
      }
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("Could not generate booking PDF:", error);
    return res.status(500).json({ message: "Could not generate the booking PDF." });
  }
});

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const query = req.user.role === "admin" ? {} : { userId: req.user._id };
    const bookings = await Booking.find(query).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ bookings });
  } catch (error) {
    console.error("Could not load bookings:", error);
    return res.status(500).json({ message: "Could not load bookings." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (req.user.role !== "admin" && booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only view your own bookings." });
    }
    return res.json({ booking });
  } catch (error) {
    console.error("Could not load booking:", error);
    return res.status(500).json({ message: "Could not load booking." });
  }
});

router.post("/", async (req, res) => {
  try {
    // Core creation/verification lives in services/bookingService so the
    // standalone flow and the complete-trip checkout share identical rules.
    const { booking, message } = await createBookingRecord(req.user._id, req.body || {});
    return res.status(201).json({ booking, message });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Please check your booking details." });
    }
    console.error("Could not create booking request:", error);
    return res.status(500).json({ message: "Could not save the booking request." });
  }
});

router.post("/:id/pay", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  const method = req.body?.paymentMethod;
  if (!STANDBOOK_METHODS.includes(method)) {
    return res.status(400).json({ message: "Choose a supported sandbox payment method: esewa, khalti, imepay, fonepay, connectips, prabhupay, namastepay, or bank_card." });
  }
  try {
    // Admin-accepted bookings move to "confirmed" while still unpaid, so both
    // freshly pending and accepted-awaiting-payment bookings may initiate pay.
    const query = { _id: req.params.id, status: { $in: ["pending", "confirmed"] } };
    if (req.user.role !== "admin") query.userId = req.user._id;
    const booking = await Booking.findOne(query);
    if (!booking) return res.status(404).json({ message: "Pending booking not found." });
    if (booking.paymentStatus === "paid") {
      return res.status(409).json({ message: "This booking is already paid. Payment confirmed.", booking });
    }
    // Complete-trip gate (server-side): a single trip booking can only
    // initiate payment after the admin confirms it. Standalone transport /
    // activity bookings are unaffected; standalone hotels have their own gate.
    const isTripRecord = booking.itemType === "trip" && !booking.paymentId;
    if (isTripRecord && (booking.status !== "confirmed" || booking.approvalStatus !== "approved")) {
      return res.status(403).json({
        code: "TRIP_AWAITING_APPROVAL",
        message: "This trip is awaiting admin confirmation. You can pay after the admin confirms it.",
        booking,
      });
    }
    // Hotel approval gate (server-side): standalone hotel bookings can only
    // initiate payment after admin acceptance. An unpaid "confirmed" hotel
    // booking implies admin acceptance (payment itself marks paid at once).
    const isStandaloneHotel =
      booking.itemType === "hotel" && !booking.tripId && !booking.paymentId;
    const hotelApproved =
      booking.approvalStatus === "approved" || booking.status === "confirmed";
    if (isStandaloneHotel && !hotelApproved) {
      return res.status(403).json({
        code: "HOTEL_AWAITING_APPROVAL",
        message: "This hotel booking is awaiting admin approval. You can pay after the admin accepts it.",
        booking,
      });
    }
    booking.paymentMethod = method;
    booking.paymentStatus = "pending"; // initiated, NOT confirmed
    booking.paymentInitiatedAt = new Date();
    booking.sandboxPayment = true;
    await booking.save();
    // QR payload for Nepal QR demo (FonePay-style string; sandbox only).
    const qrPayload = `SUVYATRA-SANDBOX|booking:${booking.bookingCode}|amount:${booking.amount}NPR|method:${method}`;
    // Standalone payment ledger: one PENDING record per booking until confirmed.
    let payment = await Payment.findOne({ bookingId: booking._id, status: "PENDING" });
    if (payment) {
      payment.method = method;
      payment.amount = booking.amount;
      payment.currency = booking.currency || "NPR";
      payment.qrPayload = qrPayload;
      await payment.save();
    } else {
      payment = await Payment.create({
        bookingId: booking._id,
        userId: booking.userId,
        amount: booking.amount,
        currency: booking.currency || "NPR",
        method,
        status: "PENDING",
        qrPayload,
        demo: true,
      });
    }
    return res.json({
      booking,
      payment,
      paymentInitiated: true,
      paymentConfirmed: false,
      message: "Sandbox payment initiated — not yet confirmed. Scan the QR or enter the reference, then confirm.",
      qr: {
        payload: qrPayload,
        amount: booking.amount,
        currency: booking.currency,
        bookingCode: booking.bookingCode,
        method,
        instructions: "Sandbox/test mode: no real money moves. Use any reference (e.g. last 6 digits) and press Confirm to simulate provider callback.",
      },
    });
  } catch (error) {
    console.error("Could not initiate payment:", error);
    return res.status(500).json({ message: "Could not initiate payment." });
  }
});

router.post("/:id/confirm", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  const reference = typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim().slice(0, 100) : "";
  try {
    const query = { _id: req.params.id, status: { $in: ["pending", "confirmed"] }, paymentStatus: "pending" };
    if (req.user.role !== "admin") query.userId = req.user._id;
    const booking = await Booking.findOne(query);
    if (!booking) {
      return res.status(404).json({ message: "No initiated sandbox payment found for this booking. Initiate payment first." });
    }
    // Same complete-trip gate as /pay: never confirm payment on a trip the
    // admin has not confirmed yet.
    const isTripRecord = booking.itemType === "trip" && !booking.paymentId;
    if (isTripRecord && (booking.status !== "confirmed" || booking.approvalStatus !== "approved")) {
      return res.status(403).json({
        code: "TRIP_AWAITING_APPROVAL",
        message: "This trip is awaiting admin confirmation and cannot be paid yet.",
      });
    }
    // Same hotel approval gate as /pay: never confirm an unapproved hotel.
    const isStandaloneHotel =
      booking.itemType === "hotel" && !booking.tripId && !booking.paymentId;
    const hotelApproved =
      booking.approvalStatus === "approved" || booking.status === "confirmed";
    if (isStandaloneHotel && !hotelApproved) {
      return res.status(403).json({
        code: "HOTEL_AWAITING_APPROVAL",
        message: "This hotel booking is awaiting admin approval and cannot be confirmed yet.",
      });
    }
    // Age restriction is re-verified before payment: the booking stores the
    // ages checked at creation, so a tampered client cannot pay for an
    // ineligible party by skipping the booking-time check.
    if (booking.itemType === "activity") {
      const activity = await LocalPlace.findOne({ _id: booking.itemId, module: "activity" }).select("minAge").lean();
      const minAge = activity && Number(activity.minAge) > 0 ? Math.floor(Number(activity.minAge)) : 0;
      const stored = Array.isArray(booking.participantAges) ? booking.participantAges.map(Number) : [];
      if (minAge > 0 && (stored.length === 0 || stored.some((age) => !Number.isFinite(age) || age < minAge))) {
        return res.status(403).json({
          code: "ACTIVITY_AGE_RESTRICTED",
          message: `This activity is restricted to participants aged ${minAge} and above.`,
        });
      }
    }
    // The frontend must send the amount it displayed; the server is the
    // source of truth — a mismatch aborts instead of marking paid.
    if (req.body?.amount !== undefined && Number(req.body.amount) !== Number(booking.amount)) {
      return res.status(400).json({ message: "Payment amount does not match this booking. Please restart the payment." });
    }
    booking.paymentStatus = "paid"; // simulated provider callback in sandbox
    booking.paymentReference = reference || `SANDBOX-${Date.now().toString().slice(-6)}`;
    booking.paymentConfirmedAt = new Date();
    // Trip-linked bookings (complete-trip services or trip records) wait for
    // admin approval after payment — never auto-confirmed. Standalone
    // single-service bookings are approved with the payment itself.
    // A trip the admin already confirmed keeps its confirmed status: paying
    // must never reset an approval back to pending.
    const isTripBooking = booking.itemType === "trip" || !!booking.tripId || !!booking.paymentId;
    const now = new Date();
    if (isTripBooking && booking.approvalStatus === "approved") {
      booking.status = "confirmed";
    } else if (isTripBooking) {
      booking.status = "pending";
      booking.approvalStatus = "pending";
      booking.submittedForApprovalAt = now;
      booking.approvalDeadline = new Date(now.getTime() + 120 * 60 * 1000);
    } else {
      booking.status = "confirmed";
      booking.approvalStatus = "approved";
      booking.approvedAt = now;
    }
    await booking.save();
    const payment = await Payment.findOneAndUpdate(
      { bookingId: booking._id, status: "PENDING" },
      {
        $set: {
          status: "PAID",
          reference: booking.paymentReference,
          method: booking.paymentMethod || "fonepay",
          amount: booking.amount,
          currency: booking.currency || "NPR",
        },
      },
      { new: true }
    );
    return res.json({
      booking,
      payment,
      paymentInitiated: true,
      paymentConfirmed: true,
      message: isTripBooking && booking.approvalStatus === "approved"
        ? "Sandbox payment confirmed for your approved trip (test mode)."
        : isTripBooking
          ? "Sandbox payment confirmed. The trip is now waiting for admin approval (test mode)."
          : "Sandbox payment confirmed and booking is now confirmed (test mode).",
    });
  } catch (error) {
    console.error("Could not confirm payment:", error);
    return res.status(500).json({ message: "Could not confirm payment." });
  }
});

router.get("/:id/payments", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const booking = await Booking.findById(req.params.id).select("userId").lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (req.user.role !== "admin" && booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only view your own bookings." });
    }
    const payments = await Payment.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean();
    return res.json({ payments });
  } catch (error) {
    console.error("Could not load payments:", error);
    return res.status(500).json({ message: "Could not load payments." });
  }
});

router.get("/:id/qr", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (req.user.role !== "admin" && booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only view your own bookings." });
    }
    const method = booking.paymentMethod || "fonepay";
    return res.json({
      qr: {
        payload: `SUVYATRA-SANDBOX|booking:${booking.bookingCode}|amount:${booking.amount}NPR|method:${method}`,
        amount: booking.amount,
        currency: booking.currency,
        bookingCode: booking.bookingCode,
        method,
        paymentInitiated: booking.paymentStatus === "pending" || booking.paymentStatus === "paid",
        paymentConfirmed: booking.paymentStatus === "paid",
      },
    });
  } catch (error) {
    console.error("Could not load payment QR:", error);
    return res.status(500).json({ message: "Could not load payment QR." });
  }
});

router.post("/:id/cancel", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const query = { _id: req.params.id, status: { $in: ["pending", "confirmed"] } };
    if (req.user.role !== "admin") query.userId = req.user._id;
    const booking = await Booking.findOneAndUpdate(
      query,
      { $set: { status: "cancelled" } },
      { new: true, runValidators: true }
    );
    if (!booking) {
      return res.status(404).json({ message: "Active booking not found. Only pending or confirmed bookings can be cancelled (inventory is restored automatically)." });
    }
    // A cancelled booking with a confirmed sandbox payment refunds the ledger record.
    let payment = null;
    if (booking.paymentStatus === "paid") {
      booking.paymentStatus = "refunded";
      await booking.save();
      payment = await Payment.findOneAndUpdate(
        { bookingId: booking._id, status: "PAID" },
        { $set: { status: "REFUNDED" } },
        { new: true }
      );
    }
    return res.json({ booking, payment, message: "Booking cancelled and inventory released." });
  } catch (error) {
    console.error("Could not cancel booking:", error);
    return res.status(500).json({ message: "Could not cancel booking." });
  }
});

// Hard delete a booking (My Bookings → Delete, after user confirmation).
// Ownership is enforced: users can only delete their own bookings.
// Deletes the payment ledger with it so no orphaned payment records remain,
// and unlinks the booking from its trip / parent checkout. Deleting a paid
// booking does NOT issue a refund — the frontend must warn about this.
router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking reference." });
  }
  try {
    const query = { _id: req.params.id };
    if (req.user.role !== "admin") query.userId = req.user._id;
    const booking = await Booking.findOne(query).lean();
    if (!booking) {
      return res.status(404).json({ message: "Booking not found." });
    }
    const wasPaid = booking.paymentStatus === "paid";
    await Payment.deleteMany({ bookingId: booking._id });
    if (booking.tripId) {
      await Trip.updateOne({ _id: booking.tripId }, { $pull: { bookingIds: booking._id } });
    }
    if (booking.paymentId) {
      await TripPayment.updateOne({ _id: booking.paymentId }, { $pull: { bookingIds: booking._id } });
    }
    await Booking.deleteOne({ _id: booking._id });
    return res.json({
      deleted: true,
      id: String(booking._id),
      wasPaid,
      message: wasPaid
        ? "Booking deleted. This does not automatically issue a refund."
        : "Booking deleted.",
    });
  } catch (error) {
    console.error("Could not delete booking:", error);
    return res.status(500).json({ message: "Could not delete booking." });
  }
});

module.exports = router;
