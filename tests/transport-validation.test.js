const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Transport = require("../models/Transport");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_transport_validation_test";
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
  await Promise.all([User.deleteMany({}), Booking.deleteMany({}), Payment.deleteMany({}), Transport.deleteMany({})]);
  await Transport.create({
    name: "Loop Bus",
    type: "bus",
    origin: "Pokhara",
    destination: "Pokhara",
    route: "Pokhara → Pokhara",
    serviceMode: "scheduled",
    price: 500,
    capacity: 20,
    isDemoData: false,
  });
  await Transport.create({
    name: "Lakeside Taxi",
    type: "taxi",
    origin: "Pokhara",
    destination: "Pokhara",
    route: "Pokhara local taxi",
    serviceMode: "private",
    price: 800,
    capacity: 4,
    isDemoData: false,
  });
  await Transport.create({
    name: "Fareless Rental",
    type: "car",
    origin: "Nepal",
    destination: "Nepal",
    route: "Nepal → Nepal",
    serviceMode: "rental",
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
    body: JSON.stringify({ name: "Transport Tester", email, password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

test("scheduled same-city route cannot be booked; private local hire can", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl, "transport-route@example.test");
    const loop = await Transport.findOne({ name: "Loop Bus" });
    const bad = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ itemType: "transport", itemId: String(loop._id), checkIn: futureISO(7), adults: 2 }),
    });
    const badBody = await bad.json();
    assert.equal(bad.status, 400, JSON.stringify(badBody));
    assert.match(badBody.message, /different/);

    const taxi = await Transport.findOne({ name: "Lakeside Taxi" });
    const good = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ itemType: "transport", itemId: String(taxi._id), checkIn: futureISO(7), adults: 2 }),
    });
    const goodBody = await good.json();
    assert.equal(good.status, 201, JSON.stringify(goodBody));
    assert.equal(goodBody.booking.location, "Pokhara → Pokhara");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fareless listings stay out of browse results but resolve by id", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const list = await (await fetch(`${baseUrl}/api/transports`)).json();
    assert.ok(!list.some((item) => item.name === "Fareless Rental"));
    assert.ok(list.every((item) => item.price !== undefined && item.price !== null));
    assert.ok(list.some((item) => item.name === "Loop Bus"));

    const fareless = await Transport.findOne({ name: "Fareless Rental" });
    const detail = await fetch(`${baseUrl}/api/transports/${fareless._id}`);
    assert.equal(detail.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
