const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Trip = require("../models/Trip");
const TripPayment = require("../models/TripPayment");
const Destination = require("../models/Destination");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_trip_details_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

function dateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// pdfkit stores page text as hex runs (sometimes kern-split).
function pdfPlainText(buffer) {
  const raw = buffer.toString("latin1");
  const parts = [];
  const pattern = /<([0-9A-Fa-f]+)>/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    if (match[1].length % 2 === 0) parts.push(Buffer.from(match[1], "hex").toString("latin1"));
  }
  return parts.join("");
}

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([
    User.deleteMany({}),
    Booking.deleteMany({}),
    Trip.deleteMany({}),
    TripPayment.deleteMany({}),
    Destination.deleteMany({}),
    Transport.deleteMany({}),
    LocalPlace.deleteMany({}),
  ]);
  await Destination.create({ name: "Pokhara", slug: "pokhara", description: "Details test destination.", province: "Gandaki" });
  const hub = await Transport.create({
    name: "Details Test Bus", origin: "Kathmandu", destination: "Pokhara",
    price: 2000, capacity: 30, isDemoData: false,
  });
  const boating = await LocalPlace.create({
    name: "Phewa Lake Boating", module: "activity", location: "Pokhara",
    price: 800, isDemoData: false,
  });
  const sunrise = await LocalPlace.create({
    name: "Begnas Sunrise Tour", module: "activity", location: "Pokhara",
    price: 1500, isDemoData: false,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server, hub, boating, sunrise };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function createUser(name, email, role = "user") {
  const user = await User.create({ name, email, password: "StrongPass123!", provider: "Email", emailVerified: true, role });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  return { user, token };
}

function authHeaders(session) {
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

const SELECTIONS = {
  startDate: "PLACEHOLDER",
  endDate: "PLACEHOLDER",
  destination: "Pokhara",
  destinationProvince: "Gandaki",
  destinationCountry: "Nepal",
  origin: "Kathmandu",
  party: { adults: 2, children: 1, rooms: 1, participants: 3 },
  hotel: {
    name: "Lakeside Paradise Hotel", location: "Lakeside, Pokhara", room: "Deluxe Lake View",
    bedConfiguration: "1 King Bed", breakfastIncluded: true,
    capacityAdults: 2, capacityChildren: 1, rating: 4.5,
    checkIn: "PLACEHOLDER", checkOut: "PLACEHOLDER",
    nights: 3, rooms: 1, nightlyRate: 6500, amount: 19500,
  },
  outbound: {
    label: "Outbound · Details Test Bus", name: "Details Test Bus", vehicleType: "Tourist Bus",
    provider: "Details Travels", origin: "Kathmandu", destination: "Pokhara",
    date: "PLACEHOLDER", departureTime: "07:00", arrivalTime: "14:00", durationMinutes: 420,
    serviceMode: "scheduled", unitPrice: 2000, priceBasis: "per person × 3",
    adults: 2, children: 1, detail: "Seats 1A, 1B, 1C", seats: ["1A", "1B", "1C"], amount: 6000,
  },
  return: {
    label: "Return · Details Test Bus", name: "Details Test Bus",
    origin: "Pokhara", destination: "Kathmandu", date: "PLACEHOLDER",
    adults: 2, children: 1, unitPrice: 2000, serviceMode: "scheduled", amount: 6000,
  },
  local: {
    label: "Local transport · Lakeside Taxi", name: "Lakeside Taxi", vehicleType: "Taxi",
    origin: "Lakeside", destination: "Sarangkot", date: "PLACEHOLDER",
    adults: 2, children: 1, unitPrice: 2500, serviceMode: "private", amount: 2500,
  },
  activity: {
    name: "Phewa Lake Boating", location: "Phewa Lake", date: "PLACEHOLDER",
    slot: "09:00", durationMinutes: 60, meetingPoint: "Lakeside dock",
    unitPrice: 800, participants: 3, amount: 2400,
  },
  restaurant: {
    name: "Thakali Kitchen", location: "Lakeside", category: "Local",
    cuisine: ["Nepali", "Thakali"], priceRange: "NPR 500-800",
    date: "PLACEHOLDER", guests: 3,
  },
  stops: [
    { kind: "attraction", name: "Phewa Lake", location: "Gandaki" },
    { kind: "attraction", name: "Begnas Lake", location: "Gandaki" },
    { kind: "hidden gem", name: "Secret Viewpoint", location: "Gandaki" },
  ],
  totals: { hotel: 19500, transportation: 14500, activities: 2400, total: 36400, currency: "NPR" },
};

test("every Step 1-14 detail is saved, served to My Bookings, and printed in the PDF", async () => {
  const { baseUrl, server, hub, boating, sunrise } = await startServer();
  try {
    const traveller = await createUser("Details Traveller", "details-traveller@example.test");
    const adminReg = await createUser("Details Admin", "details-admin@example.test", "admin");
    const stranger = await createUser("Details Stranger", "details-stranger@example.test");
    const userAuth = authHeaders(traveller);
    const adminAuth = authHeaders(adminReg);
    const strangerAuth = authHeaders(stranger);

    const start = dateOffset(7);
    const end = dateOffset(10);
    const selections = JSON.parse(JSON.stringify(SELECTIONS)
      .replaceAll('"checkIn": "PLACEHOLDER"', `"checkIn": "${start}"`)
      .replaceAll('"checkOut": "PLACEHOLDER"', `"checkOut": "${end}"`));
    // Fill every remaining PLACEHOLDER date with the trip start date.
    const fillDates = (node) => {
      if (Array.isArray(node)) return node.map(fillDates);
      if (node && typeof node === "object") {
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = fillDates(v);
        return out;
      }
      return node === "PLACEHOLDER" ? start : node;
    };
    const filled = fillDates(selections);
    filled.startDate = start;
    filled.endDate = end;

    // 1. Submit the trip with everything Steps 1-14 collect.
    const tripRes = await fetch(`${baseUrl}/api/trips`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({
        name: "Trip to Pokhara",
        destination: "Pokhara",
        origin: "Kathmandu",
        originDetails: { refId: String(hub._id) },
        startDate: start,
        endDate: end,
        adults: 2,
        children: 1,
        plannedItems: [
          { itemId: "000000000000000000000001", category: "destination", name: "Phewa Lake", location: "Gandaki" },
          { itemId: "000000000000000000000002", category: "destination", name: "Begnas Lake", location: "Gandaki" },
          { itemId: "000000000000000000000003", category: "destination", name: "Secret Viewpoint", location: "Gandaki" },
        ],
        itinerary: [
          { day: 1, date: start, focus: "Arrival", items: [{ entityId: String(boating._id), name: "Phewa Lake Boating", entityType: "activity" }] },
          { day: 2, date: end, focus: "Explore", items: [{ entityId: String(sunrise._id), name: "Begnas Sunrise Tour", entityType: "activity" }] },
        ],
        selections: filled,
        totalAmount: 36400,
      }),
    });
    const trip = await tripRes.json();
    assert.equal(tripRes.status, 201, JSON.stringify(trip));

    // 2. Saved in MongoDB completely, in order.
    const savedTrip = await Trip.findById(trip._id).lean();
    assert.equal(savedTrip.destination, "Pokhara");
    assert.equal(savedTrip.origin, "Kathmandu");
    assert.equal(savedTrip.selections.hotel.name, "Lakeside Paradise Hotel");
    assert.equal(savedTrip.selections.outbound.seats.join(","), "1A,1B,1C");
    assert.equal(savedTrip.selections.activity.slot, "09:00");
    assert.equal(savedTrip.selections.restaurant.cuisine.join(","), "Nepali,Thakali");
    assert.deepEqual(savedTrip.selections.stops.map((s) => s.name), ["Phewa Lake", "Begnas Lake", "Secret Viewpoint"]);
    assert.deepEqual(savedTrip.plannedItems.map((p) => p.name), ["Phewa Lake", "Begnas Lake", "Secret Viewpoint"]);
    assert.equal(savedTrip.itinerary.length, 2);
    assert.equal(savedTrip.itinerary[0].items[0].name, "Phewa Lake Boating");
    assert.equal(savedTrip.itinerary[1].items[0].name, "Begnas Sunrise Tour");
    assert.equal(savedTrip.totalAmount, 36400);

    const bookingRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({
        itemType: "trip", tripId: trip._id, checkIn: start, checkOut: end,
        adults: 2, children: 1, rooms: 1, amount: 36400,
      }),
    });
    const created = await bookingRes.json();
    assert.equal(bookingRes.status, 201, JSON.stringify(created));
    const bookingId = created.booking._id;

    // 3-6. Full lifecycle to Completed.
    await fetch(`${baseUrl}/api/admin/approvals/booking/${bookingId}/accept`, { method: "POST", headers: adminAuth });
    await fetch(`${baseUrl}/api/bookings/${bookingId}/pay`, { method: "POST", headers: userAuth, body: JSON.stringify({ paymentMethod: "esewa" }) });
    const confirm = await fetch(`${baseUrl}/api/bookings/${bookingId}/confirm`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({ paymentReference: "DETAILS-1", amount: 36400 }),
    });
    assert.equal(confirm.status, 200);
    await fetch(`${baseUrl}/api/admin/bookings/${bookingId}/status`, {
      method: "PATCH", headers: adminAuth, body: JSON.stringify({ status: "completed" }),
    });

    // 3. My Bookings APIs serve every saved field.
    const bookingDoc = await (await fetch(`${baseUrl}/api/bookings/${bookingId}`, { headers: userAuth })).json();
    assert.equal(bookingDoc.booking.status, "completed");
    assert.equal(bookingDoc.booking.approvalStatus, "approved");
    assert.equal(bookingDoc.booking.paymentStatus, "paid");
    assert.equal(bookingDoc.booking.amount, 36400);
    assert.equal(bookingDoc.booking.adults, 2);
    const tripDoc = await (await fetch(`${baseUrl}/api/trips/${trip._id}`, { headers: userAuth })).json();
    for (const key of ["hotel", "outbound", "return", "local", "activity", "restaurant", "stops", "totals", "party"]) {
      assert.ok(tripDoc.selections && tripDoc.selections[key] !== undefined, `GET /trips serves selections.${key} for My Bookings`);
    }
    assert.deepEqual(tripDoc.selections.stops.map((s) => s.name), ["Phewa Lake", "Begnas Lake", "Secret Viewpoint"]);

    // 7-8. PDF contains the same complete record.
    const pdf = await fetch(`${baseUrl}/api/bookings/${bookingId}/pdf`, { headers: userAuth });
    assert.equal(pdf.status, 200);
    assert.ok((pdf.headers.get("content-disposition") || "").includes(bookingDoc.booking.bookingCode));
    const text = pdfPlainText(Buffer.from(await pdf.arrayBuffer()));
    // Locale formatting inserts commas (6,500); strip them for amount checks.
    const flat = text.replace(/,/g, "");
    const mustContain = [
      "SuvYatra", bookingDoc.booking.bookingCode, "Pokhara", "Kathmandu",
      "Lakeside Paradise Hotel", "Deluxe Lake View", "6500",
      "Details Test Bus", "Kathmandu", "1A", "Lakeside Taxi", "Sarangkot",
      "Phewa Lake Boating", "09:00", "Thakali Kitchen", "Thakali",
      "Phewa Lake", "Begnas Lake", "Secret Viewpoint",
      "Begnas Sunrise Tour", "Day 1", "Day 2", "Arrival",
      "36400", "19500", "details-traveller@example.test",
      "Completed", "Confirmed", "Paid",
    ];
    for (const needle of mustContain) {
      const haystack = /^\d+$/.test(needle) ? flat : text;
      assert.ok(haystack.includes(needle), `PDF contains "${needle}"`);
    }
    assert.ok(
      text.indexOf("Phewa Lake") < text.lastIndexOf("Begnas Lake") &&
      text.lastIndexOf("Begnas Lake") < text.lastIndexOf("Secret Viewpoint"),
      "PDF preserves stop order"
    );

    // 10. Authorization holds.
    assert.equal((await fetch(`${baseUrl}/api/bookings/${bookingId}/pdf`, { headers: strangerAuth })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/trips/${trip._id}`, { headers: strangerAuth })).status, 404);
  } finally {
    await stopServer(server);
  }
});
