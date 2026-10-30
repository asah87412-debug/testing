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

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_trip_approvals_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

function dateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
    Hotel.deleteMany({}),
    Transport.deleteMany({}),
    LocalPlace.deleteMany({}),
    Destination.deleteMany({}),
  ]);
  await Destination.create({ name: "Pokhara", slug: "pokhara", description: "Approvals test destination." });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function register(baseUrl, name, email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return session;
}

async function seedInventory() {
  const hotel = await Hotel.create({
    name: "Approval Test Hotel",
    location: "Pokhara",
    pricePerNight: 4000,
    isDemoData: false,
    roomTypes: [{ name: "Deluxe", capacityAdults: 2, capacityChildren: 0, totalRooms: 5, nightlyRate: 4000 }],
  });
  const transport = await Transport.create({
    name: "Approval Test Bus",
    origin: "Kathmandu",
    destination: "Pokhara",
    price: 2000,
    capacity: 30,
    isDemoData: false,
  });
  return { hotel, transport };
}

// Full user flow up to paid (not yet approved): trip -> checkout -> pay -> confirm.
async function buildPaidTrip(baseUrl, auth, seed, email) {
  const start = dateOffset(7);
  const end = dateOffset(10);
  const tripRes = await fetch(`${baseUrl}/api/trips`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ name: "Trip to Pokhara", destination: "Pokhara", startDate: start, endDate: end, adults: 2 }),
  });
  const trip = await tripRes.json();
  assert.equal(tripRes.status, 201, JSON.stringify(trip));
  const tripId = trip._id;
  const checkoutRes = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      items: [
        { itemType: "hotel", itemId: String(seed.hotel._id), checkIn: start, checkOut: end, adults: 2, children: 0, guests: 2, rooms: 1, roomTypeId: String(seed.hotel.roomTypes[0]._id) },
        { itemType: "transport", itemId: String(seed.transport._id), checkIn: start, adults: 2, children: 0, guests: 2 },
      ],
      paymentMethod: "esewa",
    }),
  });
  const checkout = await checkoutRes.json();
  assert.equal(checkoutRes.status, 201, JSON.stringify(checkout));
  const confirm = await fetch(`${baseUrl}/api/trip-checkout/${tripId}/confirm`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ paymentReference: `DEMOQR-${email}` }),
  });
  const confirmed = await confirm.json();
  assert.equal(confirm.status, 200, JSON.stringify(confirmed));
  return { tripId, checkout: confirmed.tripPayment };
}

test("paid trip waits for admin approval; admin accepts", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const user = await register(baseUrl, "Trip Traveler", "approval-user@example.test");
    const userAuth = { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" };
    const adminReg = await register(baseUrl, "Trip Admin", "approval-admin@example.test");
    await User.updateOne({ _id: adminReg.user._id }, { $set: { role: "admin" } });
    const adminAuth = { Authorization: `Bearer ${adminReg.token}`, "Content-Type": "application/json" };
    const seed = await seedInventory();
    const { tripId, checkout } = await buildPaidTrip(baseUrl, userAuth, seed, "accept");

    // Deadline is ~120 minutes after backend submission time.
    const stored = await TripPayment.findById(checkout._id).lean();
    assert.equal(stored.approvalStatus, "pending");
    const windowMs = new Date(stored.approvalDeadline).getTime() - new Date(stored.submittedForApprovalAt).getTime();
    assert.ok(Math.abs(windowMs - 120 * 60 * 1000) < 60000, `deadline window ${windowMs}`);

    // Queue: admin sees it, user is forbidden, anonymous is unauthorized.
    const queue = await fetch(`${baseUrl}/api/admin/approvals`, { headers: adminAuth });
    const queueBody = await queue.json();
    assert.equal(queue.status, 200, JSON.stringify(queueBody));
    assert.equal(queueBody.total, 1);
    assert.equal(queueBody.approvals[0].checkoutCode, checkout.checkoutCode);
    assert.equal(queueBody.approvals[0].bookings.length, 2);
    assert.equal(queue.status === 200 && queueBody.approvals[0].user.email, "approval-user@example.test");
    assert.equal(await (await fetch(`${baseUrl}/api/admin/approvals`, { headers: userAuth })).status, 403);
    assert.equal(await (await fetch(`${baseUrl}/api/admin/approvals`)).status, 401);

    // User cannot approve their own trip.
    const selfApprove = await fetch(`${baseUrl}/api/admin/approvals/checkout/${checkout._id}/accept`, { method: "POST", headers: userAuth });
    assert.equal(selfApprove.status, 403);

    // Admin accepts with confirmation semantics.
    const accept = await fetch(`${baseUrl}/api/admin/approvals/checkout/${checkout._id}/accept`, { method: "POST", headers: adminAuth });
    assert.equal(accept.status, 200, JSON.stringify(await accept.json()));
    const afterCheckout = await TripPayment.findById(checkout._id).lean();
    assert.equal(afterCheckout.approvalStatus, "approved");
    assert.ok(afterCheckout.approvedAt);
    assert.equal(String(afterCheckout.approvedBy), String(adminReg.user._id));
    const afterBookings = await Booking.find({ paymentId: checkout._id }).lean();
    assert.ok(afterBookings.length === 2 && afterBookings.every((b) => b.approvalStatus === "approved" && b.status === "accepted"));
    assert.equal((await Trip.findById(tripId).lean()).status, "accepted");

    // Decided trips leave the queue; double decision is rejected.
    const queueAfter = await (await fetch(`${baseUrl}/api/admin/approvals`, { headers: adminAuth })).json();
    assert.equal(queueAfter.total, 0);
    const again = await fetch(`${baseUrl}/api/admin/approvals/checkout/${checkout._id}/accept`, { method: "POST", headers: adminAuth });
    assert.equal(again.status, 404);

    // User sees the accepted status from the backend.
    const mine = await (await fetch(`${baseUrl}/api/bookings`, { headers: userAuth })).json();
    assert.ok(mine.bookings.every((b) => b.status === "accepted" && b.approvalStatus === "approved"));
  } finally {
    await stopServer(server);
  }
});

test("admin rejects with a reason; unpaid trips never queue; no refund claimed", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const user = await register(baseUrl, "Reject Traveler", "reject-user@example.test");
    const userAuth = { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" };
    const adminReg = await register(baseUrl, "Reject Admin", "reject-admin@example.test");
    await User.updateOne({ _id: adminReg.user._id }, { $set: { role: "admin" } });
    const adminAuth = { Authorization: `Bearer ${adminReg.token}`, "Content-Type": "application/json" };
    const seed = await seedInventory();
    const { checkout } = await buildPaidTrip(baseUrl, userAuth, seed, "reject");

    const reject = await fetch(`${baseUrl}/api/admin/approvals/checkout/${checkout._id}/reject`, {
      method: "POST", headers: adminAuth,
      body: JSON.stringify({ reason: "Hotel overbooked for those dates." }),
    });
    assert.equal(reject.status, 200, JSON.stringify(await reject.json()));
    const after = await TripPayment.findById(checkout._id).lean();
    assert.equal(after.approvalStatus, "rejected");
    assert.equal(after.rejectionReason, "Hotel overbooked for those dates.");
    assert.equal(after.paymentStatus, "PAID");
    const afterBookings = await Booking.find({ paymentId: checkout._id }).lean();
    assert.ok(afterBookings.every((b) => b.status === "rejected" && b.approvalStatus === "rejected" && b.paymentStatus === "paid"));

    // User sees rejected + reason, payment untouched.
    const mine = await (await fetch(`${baseUrl}/api/bookings`, { headers: userAuth })).json();
    const first = mine.bookings[0];
    assert.equal(first.status, "rejected");
    assert.equal(first.rejectionReason, "Hotel overbooked for those dates.");

    // Unpaid checkout never appears in the approval queue.
    const start = dateOffset(7);
    const end = dateOffset(10);
    const tripRes = await fetch(`${baseUrl}/api/trips`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({ name: "Unpaid Trip", destination: "Pokhara", startDate: start, endDate: end, adults: 2 }),
    });
    const tripId = (await tripRes.json())._id;
    await fetch(`${baseUrl}/api/trip-checkout/${tripId}/checkout`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({
        items: [{ itemType: "transport", itemId: String(seed.transport._id), checkIn: start, adults: 2, children: 0, guests: 2 }],
        paymentMethod: "esewa",
      }),
    });
    const queue = await (await fetch(`${baseUrl}/api/admin/approvals`, { headers: adminAuth })).json();
    assert.equal(queue.total, 0);
  } finally {
    await stopServer(server);
  }
});
