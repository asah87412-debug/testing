const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Trip = require("../models/Trip");
const TripPayment = require("../models/TripPayment");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const Destination = require("../models/Destination");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_trip_checkout_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

function dateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([
    User.deleteMany({}),
    Booking.deleteMany({}),
    Trip.deleteMany({}),
    TripPayment.deleteMany({}),
    Hotel.deleteMany({}),
    Transport.deleteMany({}),
    LocalPlace.deleteMany({}),
    Destination.deleteMany({}),
  ]);
  // Trips require a real destination record (backend validates it).
  await Destination.create({ name: "Pokhara", slug: "pokhara", description: "Trip checkout test destination." });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

async function register(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Trip Payer", email, password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return session.token;
}

async function seedInventory() {
  const hotel = await Hotel.create({
    name: "Checkout Test Hotel",
    location: "Pokhara",
    pricePerNight: 4000,
    isDemoData: false,
    roomTypes: [{ name: "Deluxe", capacityAdults: 2, capacityChildren: 0, totalRooms: 5, nightlyRate: 4000 }],
  });
  const transport = await Transport.create({
    name: "Checkout Test Bus",
    origin: "Kathmandu",
    destination: "Pokhara",
    price: 2000,
    capacity: 30,
    isDemoData: false,
  });
  const activity1 = await LocalPlace.create({
    name: "Checkout Paragliding",
    module: "activity",
    location: "Pokhara",
    price: 4000,
    isDemoData: false,
  });
  const activity2 = await LocalPlace.create({
    name: "Checkout Boating",
    module: "activity",
    location: "Pokhara",
    price: 1000,
    isDemoData: false,
  });
  return { hotel, transport, activity1, activity2 };
}

async function createTrip(baseUrl, auth, start, end) {
  const response = await fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Trip to Pokhara", destination: "Pokhara", startDate: start, endDate: end, adults: 2 }),
  });
  const trip = await response.json();
  assert.equal(response.status, 201, JSON.stringify(trip));
  return trip._id || trip.trip?._id;
}

function checkoutItems(seed, dates) {
  return [
    {
      itemType: "hotel",
      itemId: String(seed.hotel._id),
      checkIn: dates.start,
      checkOut: dates.end,
      adults: 2,
      children: 0,
      guests: 2,
      rooms: 1,
      roomTypeId: String(seed.hotel.roomTypes[0]._id),
    },
    {
      itemType: "transport",
      itemId: String(seed.transport._id),
      checkIn: dates.start,
      adults: 2,
      children: 0,
      guests: 2,
    },
    {
      itemType: "activity",
      itemId: String(seed.activity1._id),
      checkIn: dates.mid,
      adults: 2,
      children: 0,
      guests: 2,
    },
    {
      itemType: "activity",
      itemId: String(seed.activity2._id),
      checkIn: dates.mid,
      adults: 2,
      children: 0,
      guests: 2,
    },
  ];
}

test("complete-trip one-payment flow: 12000 + 2000 + 8000 + 2000 = 24000", async () => {
  const server = await startServer();
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = await register(baseUrl, "trip-payer@example.com");
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const seed = await seedInventory();
    const dates = { start: dateOffset(7), end: dateOffset(10), mid: dateOffset(8) };
    const tripId = await createTrip(baseUrl, auth, dates.start, dates.end);

    // 1. Checkout: one parent record + pending bookings, dynamic total.
    const checkout = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items: checkoutItems(seed, dates), paymentMethod: "esewa" }),
    });
    const created = await checkout.json();
    assert.equal(checkout.status, 201, JSON.stringify(created));
    assert.equal(created.tripPayment.paymentStatus, "PENDING");
    assert.equal(created.tripPayment.paymentMethod, "esewa");
    assert.ok(created.tripPayment.checkoutCode.startsWith("SUV-"));
    assert.ok(created.tripPayment.paymentId.startsWith("PAY-"));
    assert.equal(created.bookings.length, 4);
    for (const booking of created.bookings) {
      assert.equal(booking.status, "pending");
      assert.notEqual(booking.paymentStatus, "paid");
      assert.equal(String(booking.paymentId), String(created.tripPayment._id));
    }
    const byType = {};
    for (const booking of created.bookings) {
      byType[booking.itemType] = (byType[booking.itemType] || 0) + booking.amount;
    }
    assert.equal(byType.hotel, 12000); // 4000 x 3 nights x 1 room
    assert.equal(byType.transport, 2000);
    assert.equal(byType.activity, 10000); // 4000x2 + 1000x2
    assert.equal(created.tripPayment.totalAmount, 24000);
    const categories = Object.fromEntries(
      created.tripPayment.breakdown.map((line) => [line.category, line.amount])
    );
    assert.equal(categories.Hotel, 12000);
    assert.equal(categories.Transportation, 2000);
    assert.equal(categories.Activities, 10000);
    assert.ok(String(created.qr.payload).includes(created.tripPayment.checkoutCode));
    assert.ok(String(created.qr.payload).includes("24000"));

    // 2. Retry checkout with identical items: no duplicate bookings.
    const retry = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items: checkoutItems(seed, dates), paymentMethod: "khalti" }),
    });
    const retried = await retry.json();
    assert.equal(retry.status, 201, JSON.stringify(retried));
    assert.equal(String(retried.tripPayment._id), String(created.tripPayment._id));
    assert.equal(retried.bookings.length, 4);
    const bookingCount = await Booking.countDocuments({ tripId });
    assert.equal(bookingCount, 4);
    assert.equal(retried.tripPayment.paymentMethod, "khalti");

    // 3. Pay: PENDING single QR for the grand total (still nothing confirmed).
    const pay = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/pay`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentMethod: "khalti" }),
    });
    const initiated = await pay.json();
    assert.equal(pay.status, 200, JSON.stringify(initiated));
    assert.equal(initiated.tripPayment.paymentStatus, "PENDING");
    assert.equal(initiated.qr.amount, 24000);
    const stillPending = await Booking.find({ tripId }).lean();
    assert.ok(stillPending.every((b) => b.paymentStatus !== "paid" && b.status === "pending"));

    // 4. Confirm: ONE success confirms ALL linked bookings with one reference.
    const confirm = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/confirm`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentReference: "DEMOQR-TRIP123" }),
    });
    const confirmed = await confirm.json();
    assert.equal(confirm.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.paymentConfirmed, true);
    assert.equal(confirmed.tripPayment.paymentStatus, "PAID");
    assert.equal(confirmed.tripPayment.referenceId, "DEMOQR-TRIP123");
    assert.equal(confirmed.bookings.length, 4);
    for (const booking of confirmed.bookings) {
      assert.equal(booking.paymentStatus, "paid");
      // Payment never auto-approves: bookings wait for the admin decision.
      assert.equal(booking.status, "pending");
      assert.equal(booking.approvalStatus, "pending");
      assert.ok(booking.submittedForApprovalAt);
      assert.ok(booking.approvalDeadline);
      assert.equal(booking.paymentReference, "DEMOQR-TRIP123");
      assert.equal(booking.paymentMethod, "khalti");
    }
    assert.equal(confirmed.tripPayment.approvalStatus, "pending");
    const trip = await Trip.findById(tripId).lean();
    assert.equal(trip.paymentStatus, "paid");
    assert.equal(trip.totalAmount, 24000);

    // 5. Paid trip cannot pay or confirm again.
    const repay = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/pay`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    assert.equal(repay.status, 409);
    const reconfirm = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/confirm`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentReference: "DEMOQR-AGAIN" }),
    });
    assert.equal(reconfirm.status, 409);

    // 6. Trip summary carries the checkout for grouped My Bookings views.
    const summary = await fetch(`${baseUrl}/api/trips/${tripId}/summary`, { headers: auth });
    const summaryJson = await summary.json();
    assert.equal(summary.status, 200, JSON.stringify(summaryJson));
    assert.equal(summaryJson.checkout.paymentStatus, "PAID");
    assert.equal(summaryJson.checkout.totalAmount, 24000);
    assert.equal(summaryJson.totals.total, 24000);
  } finally {
    server.close();
  }
});

test("failed trip payment keeps pending bookings and retries without duplicates", async () => {
  const server = await startServer();
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = await register(baseUrl, "trip-retry@example.com");
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const seed = await seedInventory();
    const dates = { start: dateOffset(7), end: dateOffset(10), mid: dateOffset(8) };
    const tripId = await createTrip(baseUrl, auth, dates.start, dates.end);
    const items = checkoutItems(seed, dates).slice(0, 2); // hotel + transport = 14000

    const checkout = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items, paymentMethod: "esewa" }),
    });
    const created = await checkout.json();
    assert.equal(checkout.status, 201, JSON.stringify(created));
    assert.equal(created.tripPayment.totalAmount, 14000);

    // Explicit failure: trip NOT paid, services NOT confirmed, items kept.
    const fail = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/fail`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ reason: "Demo QR expired." }),
    });
    const failed = await fail.json();
    assert.equal(fail.status, 200, JSON.stringify(failed));
    assert.equal(failed.tripPayment.paymentStatus, "FAILED");
    const kept = await Booking.find({ tripId }).lean();
    assert.equal(kept.length, 2);
    assert.ok(kept.every((b) => b.status === "pending" && b.paymentStatus !== "paid"));
    const tripFailed = await Trip.findById(tripId).lean();
    assert.equal(tripFailed.paymentStatus, "failed");

    // Retry: same checkout record flips back to PENDING, still 2 bookings.
    const pay = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/pay`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentMethod: "khalti" }),
    });
    const retried = await pay.json();
    assert.equal(pay.status, 200, JSON.stringify(retried));
    assert.equal(String(retried.tripPayment._id), String(created.tripPayment._id));
    assert.equal(retried.tripPayment.paymentStatus, "PENDING");
    assert.equal(await Booking.countDocuments({ tripId }), 2);

    const confirm = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/confirm`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentReference: "DEMOQR-RETRY" }),
    });
    const confirmed = await confirm.json();
    assert.equal(confirm.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.tripPayment.paymentStatus, "PAID");
    assert.ok(confirmed.bookings.every((b) => b.paymentStatus === "paid" && b.status === "pending" && b.approvalStatus === "pending"));
  } finally {
    server.close();
  }
});

test("checkout rejects bad input and guards ownership", async () => {
  const server = await startServer();
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = await register(baseUrl, "trip-guard@example.com");
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const seed = await seedInventory();
    const dates = { start: dateOffset(7), end: dateOffset(10), mid: dateOffset(8) };
    const tripId = await createTrip(baseUrl, auth, dates.start, dates.end);
    const items = checkoutItems(seed, dates).slice(0, 1);

    const badMethod = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items, paymentMethod: "cash" }),
    });
    assert.equal(badMethod.status, 400);

    const empty = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items: [], paymentMethod: "esewa" }),
    });
    assert.equal(empty.status, 400);

    const otherToken = await register(baseUrl, "trip-stranger@example.com");
    const stranger = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items, paymentMethod: "esewa" }),
    });
    assert.equal(stranger.status, 404);

    const missing = await fetch(`${baseUrl}/api/trip-checkout/000000000000000000000000/checkout`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items, paymentMethod: "esewa" }),
    });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});
