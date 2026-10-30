const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Hotel = require("../models/Hotel");
const Booking = require("../models/Booking");
const LoginActivity = require("../models/LoginActivity");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_admin_bookings_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([
    User.deleteMany({}),
    Hotel.deleteMany({}),
    Booking.deleteMany({}),
    LoginActivity.deleteMany({}),
  ]);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

async function register(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test Traveler",
      email,
      password: "StrongPass123!",
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  await User.updateOne(
    { _id: body.user._id },
    {
      $set: { emailVerified: true },
      $unset: { emailVerificationOtpHash: 1, emailVerificationExpiresAt: 1 },
    }
  );
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "StrongPass123!" }),
  });
  const session = await login.json();
  assert.equal(login.status, 200, JSON.stringify(session));
  return session;
}

function closeServer(t, server) {
  t.after(async () => {
    await Promise.all([User.deleteMany({}), Hotel.deleteMany({}), Booking.deleteMany({}), LoginActivity.deleteMany({})]);
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
}

test("restricts login activity to admins", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await register(baseUrl, "traveler@example.com");

  const unauthorized = await fetch(`${baseUrl}/api/admin/login-activity`);
  assert.equal(unauthorized.status, 401);

  const forbidden = await fetch(`${baseUrl}/api/admin/login-activity`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  assert.equal(forbidden.status, 403);

  await User.findByIdAndUpdate(account.user._id, { role: "admin" });
  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "traveler@example.com", password: "StrongPass123!" }),
  });
  const adminAccount = await adminLogin.json();
  assert.equal(adminLogin.status, 200);

  const allowed = await fetch(`${baseUrl}/api/admin/login-activity?limit=10`, {
    headers: { Authorization: `Bearer ${adminAccount.token}` },
  });
  const activity = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.ok(activity.events.length >= 1);
  assert.equal(Object.hasOwn(activity.events[0], "password"), false);
});

test("restricts registered-user data to admins and returns safe signup timestamps", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await register(baseUrl, "registered@example.com");

  const userRecord = await User.findById(account.user._id);
  assert.ok(userRecord.createdAt instanceof Date);

  const unauthorized = await fetch(`${baseUrl}/api/admin/registered-users`);
  assert.equal(unauthorized.status, 401);

  const userRequest = await fetch(`${baseUrl}/api/admin/registered-users`, {
    headers: { Authorization: "Bearer " + account.token },
  });
  assert.equal(userRequest.status, 403);

  await User.findByIdAndUpdate(account.user._id, { role: "admin" });
  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "registered@example.com",
      password: "StrongPass123!",
    }),
  });
  const adminSession = await adminLogin.json();
  assert.equal(adminLogin.status, 200);

  const allowed = await fetch(`${baseUrl}/api/admin/registered-users`, {
    headers: { Authorization: "Bearer " + adminSession.token },
  });
  const result = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(result.total, 1);
  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].name, account.user.name);
  assert.equal(result.users[0].email, "registered@example.com");
  assert.equal(
    new Date(result.users[0].createdAt).toISOString(),
    userRecord.createdAt.toISOString()
  );
  assert.deepEqual(Object.keys(result.users[0]).sort(), [
    "_id",
    "createdAt",
    "email",
    "name",
  ]);
  assert.equal(JSON.stringify(result).includes("password"), false);
  assert.equal(JSON.stringify(result).includes("Otp"), false);
  assert.ok(adminSession.token);
});

test("scopes bookings to their owner and uses the database hotel price", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = await register(baseUrl, "owner@example.com");
  const other = await register(baseUrl, "other@example.com");
  const hotel = await Hotel.create({
    name: "Verified Hotel",
    city: "Pokhara",
    location: "Lakeside",
    pricePerNight: 2000,
    roomTypes: [{ name: "Family room", capacityAdults: 2, capacityChildren: 2, totalRooms: 3 }],
    isDemoData: false,
    available: true,
  });
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 1);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);

  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      itemType: "hotel",
      itemId: hotel._id,
      itemName: "Client supplied name",
      amount: 1,
      paymentMethod: "esewa",
      adults: 2,
      children: 1,
      rooms: 2,
      roomTypeId: hotel.roomTypes[0]._id,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
    }),
  });
  const created = await response.json();
  assert.equal(response.status, 201, JSON.stringify(created));
  assert.equal(created.booking.itemName, hotel.name);
  assert.equal(created.booking.amount, 8000);
  assert.equal(created.booking.guests, 3);
  assert.equal(created.booking.rooms, 2);
  assert.equal(created.booking.roomTypeName, "Family room");
  assert.equal(created.booking.amountIsEstimate, true);
  assert.equal(created.booking.status, "pending");
  assert.equal(created.booking.paymentStatus, "not_configured");
  assert.match(created.message, /checking room inventory/);

  const unavailableRoomRequest = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      itemType: "hotel",
      itemId: hotel._id,
      roomTypeId: hotel.roomTypes[0]._id,
      adults: 2,
      children: 1,
      rooms: 2,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
    }),
  });
  assert.equal(unavailableRoomRequest.status, 409);

  const demoHotel = await Hotel.create({
    name: "Demo Hotel",
    pricePerNight: 2000,
    available: true,
    isDemoData: true,
  });
  const demoBooking = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      itemType: "hotel",
      itemId: demoHotel._id,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
    }),
  });
  assert.equal(demoBooking.status, 409);

  const otherBookings = await fetch(`${baseUrl}/api/bookings`, {
    headers: { Authorization: `Bearer ${other.token}` },
  });
  assert.deepEqual((await otherBookings.json()).bookings, []);

  const otherBooking = await fetch(`${baseUrl}/api/bookings/${created.booking._id}`, {
    headers: { Authorization: `Bearer ${other.token}` },
  });
  assert.equal(otherBooking.status, 403);
});
