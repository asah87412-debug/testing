const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Trip = require("../models/Trip");
const Destination = require("../models/Destination");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_booking_flow_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

function futureISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([User.deleteMany({}), Booking.deleteMany({}), Payment.deleteMany({}), Trip.deleteMany({}), Destination.deleteMany({}), Transport.deleteMany({}), LocalPlace.deleteMany({})]);
  await Destination.create({ name: "Pokhara", slug: "pokhara", description: "Booking flow test destination." });
  await Destination.create({ name: "Kathmandu", slug: "kathmandu", description: "Booking flow test origin." });
  await Transport.create({
    name: "Priceless Test Taxi",
    origin: "Kathmandu",
    destination: "Kathmandu",
    type: "Taxi",
    serviceMode: "private",
    isDemoData: false,
  });
  await LocalPlace.create({
    name: "Slotted Test Flight",
    module: "activity",
    city: "Kathmandu",
    price: 5000,
    slots: ["06:30", "07:30"],
    isDemoData: false,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function register(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Flow Tester", email, password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

test("complete-trip booking is saved and listed in My Bookings", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "flow-trip@example.test");
    const trip = await (await fetch(`${baseUrl}/api/trips`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: "Trip to Pokhara", destination: "Pokhara", origin: "Kathmandu", startDate: futureISO(7), endDate: futureISO(10), adults: 2 }),
    })).json();
    // Origin without a record still validates? Kathmandu IS a destination record — accepted.
    const bookingRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ itemType: "trip", tripId: trip._id, amount: 25000, adults: 2 }),
    });
    const created = await bookingRes.json();
    assert.equal(bookingRes.status, 201, JSON.stringify(created));
    assert.equal(created.booking.itemType, "trip");
    assert.equal(created.booking.origin, "Kathmandu");
    assert.equal(created.booking.amount, 25000);

    // Appears in My Bookings.
    const list = await (await fetch(`${baseUrl}/api/bookings`, { headers: auth })).json();
    assert.ok(list.bookings.some((b) => b._id === created.booking._id));

    // Re-saving the same trip does not duplicate.
    const again = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ itemType: "trip", tripId: trip._id, amount: 25000, adults: 2 }),
    });
    assert.equal(again.status, 201);
    assert.equal(await Booking.countDocuments({ itemType: "trip", tripId: trip._id }), 1);

    // Gibberish origin is rejected on trip creation.
    const badTrip = await fetch(`${baseUrl}/api/trips`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: "Trip", destination: "Pokhara", origin: "sfdfdgfqfg", startDate: futureISO(7), endDate: futureISO(10) }),
    });
    const badBody = await badTrip.json();
    assert.equal(badTrip.status, 400, JSON.stringify(badBody));
    assert.equal(badBody.code, "INVALID_ORIGIN");
  } finally {
    await stopServer(server);
  }
});

test("booking delete removes ledger + links and enforces ownership", async () => {  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "flow-owner@example.test");
    const otherAuth = await register(baseUrl, "flow-stranger@example.test");
    const booking = await Booking.create({
      userId: (await User.findOne({ email: "flow-owner@example.test" }))._id,
      itemType: "activity",
      itemName: "Delete Me",
      location: "Pokhara",
      checkIn: new Date(futureISO(7)),
      guests: 1, adults: 1,
      amount: 1000, currency: "NPR",
      status: "pending", paymentStatus: "not_configured",
      bookingCode: "SVY-DELTEST1",
    });

    // Stranger cannot delete.
    const denied = await fetch(`${baseUrl}/api/bookings/${booking._id}`, { method: "DELETE", headers: otherAuth });
    assert.equal(denied.status, 404);

    // Pay + confirm, then delete (paid with warning, ledger cleaned).
    await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
      method: "POST", headers: { ...auth },
      body: JSON.stringify({ paymentMethod: "prabhupay" }),
    });
    // Tampered amount is rejected — never marked paid.
    const tampered = await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
      method: "POST", headers: { ...auth },
      body: JSON.stringify({ paymentReference: "DEL-REF-X", amount: 1 }),
    });
    assert.equal(tampered.status, 400, JSON.stringify(await tampered.json()));
    assert.equal((await Booking.findById(booking._id).lean()).paymentStatus, "pending");
    const hodrs = { ...auth };
    await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
      method: "POST", headers: hodrs, body: JSON.stringify({ paymentReference: "DEL-REF-1", amount: 1000 }),
    });
    assert.equal((await Payment.countDocuments({ bookingId: booking._id })), 1);
    const del = await fetch(`${baseUrl}/api/bookings/${booking._id}`, { method: "DELETE", headers: auth });
    const delBody = await del.json();
    assert.equal(del.status, 200, JSON.stringify(delBody));
    assert.equal(delBody.deleted, true);
    assert.equal(delBody.wasPaid, true);
    assert.equal(await Booking.countDocuments({ _id: booking._id }), 0);
    assert.equal(await Payment.countDocuments({ bookingId: booking._id }), 0);

    // Deleted booking stays deleted after re-fetch.
    const list = await (await fetch(`${baseUrl}/api/bookings`, { headers: auth })).json();
    assert.ok(!list.bookings.some((b) => b._id === String(booking._id)));
  } finally {
    await stopServer(server);
  }
});

test("zero-fare transport is rejected with a fare-specific error", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "flow-fare@example.test");
    const taxi = await Transport.findOne({ name: "Priceless Test Taxi" });
    const res = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ itemType: "transport", itemId: String(taxi._id), checkIn: futureISO(7), adults: 2 }),
    });
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.match(body.message, /confirmed fare/);
    assert.equal(await Booking.countDocuments({}), 0);
  } finally {
    await stopServer(server);
  }
});

test("scheduled activity without a slot is rejected listing the slots", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "flow-slot@example.test");
    const activity = await LocalPlace.findOne({ name: "Slotted Test Flight" });
    const missing = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ itemType: "activity", itemId: String(activity._id), checkIn: futureISO(7), adults: 2 }),
    });
    const missingBody = await missing.json();
    assert.equal(missing.status, 400, JSON.stringify(missingBody));
    assert.equal(missingBody.message, "Select one of the scheduled slots: 06:30, 07:30.");
    // With a valid slot the same booking succeeds.
    const ok = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ itemType: "activity", itemId: String(activity._id), checkIn: futureISO(7), adults: 2, serviceTime: "06:30" }),
    });
    const okBody = await ok.json();
    assert.equal(ok.status, 201, JSON.stringify(okBody));
    assert.equal(okBody.booking.serviceTime, "06:30");
  } finally {
    await stopServer(server);
  }
});
