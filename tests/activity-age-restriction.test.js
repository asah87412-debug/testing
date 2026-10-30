const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const LocalPlace = require("../models/LocalPlace");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_activity_age_test";
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
  await Promise.all([User.deleteMany({}), Booking.deleteMany({}), Payment.deleteMany({}), LocalPlace.deleteMany({})]);
  await LocalPlace.create({
    name: "Adult Jump",
    module: "activity",
    city: "Pokhara",
    price: 8000,
    capacityPerSlot: 10,
    slots: ["10:00"],
    minAge: 18,
    isDemoData: false,
  });
  await LocalPlace.create({
    name: "Family Walk",
    module: "activity",
    city: "Pokhara",
    price: 1000,
    capacityPerSlot: 10,
    isDemoData: false,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

async function register(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Age Tester", email, password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

async function book(baseUrl, auth, activityId, extra) {
  return fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      itemType: "activity",
      itemId: String(activityId),
      checkIn: futureISO(9),
      serviceTime: "10:00",
      adults: 1,
      ...extra,
    }),
  });
}

test("unrestricted activity books without ages; 18+ blocks underage and tampered clients", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "age-open@example.test");
    const open = await LocalPlace.findOne({ name: "Family Walk" });
    const adult = await LocalPlace.findOne({ name: "Adult Jump" });

    // 1. No restriction -> books normally, no ages needed.
    const ok = await book(baseUrl, auth, open._id, {});
    assert.equal(ok.status, 201, JSON.stringify(await ok.json()));

    // 2. 18+ with no ages supplied -> blocked (tampered client).
    const missing = await book(baseUrl, auth, adult._id, {});
    assert.equal(missing.status, 400);

    // 3. 18+ underage -> blocked.
    const young = await book(baseUrl, auth, adult._id, { adults: 1, participantAges: [16] });
    assert.equal(young.status, 403);

    // 4. 18+ mixed party, one underage -> blocked.
    const mixed = await book(baseUrl, auth, adult._id, { adults: 2, participantAges: [25, 17] });
    assert.equal(mixed.status, 403);

    // 2b. 18+ eligible -> books, then pays and confirms (payment gate passes).
    const eligible = await book(baseUrl, auth, adult._id, { adults: 1, participantAges: [25] });
    const eligibleBody = await eligible.json();
    assert.equal(eligible.status, 201, JSON.stringify(eligibleBody));
    assert.deepEqual(eligibleBody.booking.participantAges, [25]);

    const pay = await fetch(`${baseUrl}/api/bookings/${eligibleBody.booking._id}/pay`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    assert.equal(pay.status, 200);
    const confirm = await fetch(`${baseUrl}/api/bookings/${eligibleBody.booking._id}/confirm`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentReference: "DEMOQR-AGE", amount: eligibleBody.booking.amount }),
    });
    const confirmed = await confirm.json();
    assert.equal(confirm.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.booking.paymentStatus, "paid");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("payment confirmation re-checks a tampered age record", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "age-tamper@example.test");
    const adult = await LocalPlace.findOne({ name: "Adult Jump" });
    const created = await book(baseUrl, auth, adult._id, { adults: 1, participantAges: [30] });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    // Attacker edits the stored ages after booking (simulates a bypass).
    await Booking.updateOne(
      { _id: createdBody.booking._id },
      { $set: { participantAges: [10] } }
    );
    const pay = await fetch(`${baseUrl}/api/bookings/${createdBody.booking._id}/pay`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentMethod: "khalti" }),
    });
    assert.equal(pay.status, 200);
    const confirm = await fetch(`${baseUrl}/api/bookings/${createdBody.booking._id}/confirm`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentReference: "DEMOQR-TAMPER", amount: createdBody.booking.amount }),
    });
    const confirmBody = await confirm.json();
    assert.equal(confirm.status, 403, JSON.stringify(confirmBody));
    assert.equal(confirmBody.code, "ACTIVITY_AGE_RESTRICTED");
    const reread = await Booking.findById(createdBody.booking._id).lean();
    assert.notEqual(reread.paymentStatus, "paid");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
