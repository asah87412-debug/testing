const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_demo_payments_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([User.deleteMany({}), Booking.deleteMany({}), Payment.deleteMany({})]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

async function register(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Demo Payer", email, password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return session.token;
}

async function seedBooking(userId) {
  return Booking.create({
    userId,
    itemType: "hotel",
    itemName: "Demo Hotel",
    location: "Pokhara",
    checkIn: new Date("2026-11-01"),
    checkOut: new Date("2026-11-03"),
    guests: 2,
    adults: 2,
    amount: 5000,
    currency: "NPR",
    status: "pending",
    paymentStatus: "pending",
    bookingCode: `SUV-TEST-${Math.floor(Math.random() * 1e6)}`,
  });
}

for (const method of ["esewa", "khalti"]) {
  test(`demo ${method} QR flow: approval -> paid and persists`, async () => {
    const server = await startServer();
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const token = await register(baseUrl, `demo-${method}@example.com`);
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const adminToken = await register(baseUrl, `demo-${method}-admin@example.com`);
      await User.updateOne({ email: `demo-${method}-admin@example.com` }, { $set: { role: "admin" } });
      const adminAuth = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };
      const user = await User.findOne({ email: `demo-${method}@example.com` });
      const booking = await seedBooking(user._id);

      // 0. Payment before admin acceptance is blocked (server-side gate).
      const earlyPay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paymentMethod: method }),
      });
      const earlyBody = await earlyPay.json();
      assert.equal(earlyPay.status, 403, JSON.stringify(earlyBody));
      assert.equal(earlyBody.code, "HOTEL_AWAITING_APPROVAL");

      // 0b. Admin accepts the hotel booking; approval is recorded.
      const accept = await fetch(`${baseUrl}/api/admin/bookings/${booking._id}/status`, {
        method: "PATCH",
        headers: adminAuth,
        body: JSON.stringify({ status: "confirmed" }),
      });
      const accepted = await accept.json();
      assert.equal(accept.status, 200, JSON.stringify(accepted));
      assert.equal(accepted.booking.approvalStatus, "approved");

      // 1. Initiate: pending, NOT paid; ledger PENDING; QR payload returned.
      const pay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paymentMethod: method }),
      });
      const initiated = await pay.json();
      assert.equal(pay.status, 200, JSON.stringify(initiated));
      assert.equal(initiated.paymentInitiated, true);
      assert.equal(initiated.paymentConfirmed, false);
      assert.equal(initiated.booking.paymentStatus, "pending");
      assert.ok(String(initiated.qr.payload).includes(initiated.booking.bookingCode));
      assert.equal(initiated.qr.method, method);
      const ledgerPending = await Payment.findOne({ bookingId: booking._id });
      assert.equal(ledgerPending.status, "PENDING");
      assert.equal(ledgerPending.demo, true);

      // 2. Unsupported method is rejected (no silent fake method).
      const badMethod = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paymentMethod: "cash" }),
      });
      assert.equal(badMethod.status, 400);

      // 3. Confirm with demo reference: paid + booking confirmed.
      const confirm = await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paymentReference: "DEMOQR-TEST123" }),
      });
      const confirmed = await confirm.json();
      assert.equal(confirm.status, 200, JSON.stringify(confirmed));
      assert.equal(confirmed.paymentConfirmed, true);
      assert.equal(confirmed.booking.paymentStatus, "paid");
      assert.equal(confirmed.booking.status, "confirmed");
      assert.equal(confirmed.booking.paymentReference, "DEMOQR-TEST123");
      const ledgerPaid = await Payment.findOne({ bookingId: booking._id });
      assert.equal(ledgerPaid.status, "PAID");

      // 4. Already-paid booking cannot pay/confirm again (no second transaction).
      // Pay targets pending bookings, so a confirmed/paid booking is not found.
      const repay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paymentMethod: method }),
      });
      assert.ok([404, 409].includes(repay.status), `repay status ${repay.status}`);
      const reconfirm = await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paymentReference: "DEMOQR-AGAIN" }),
      });
      assert.equal(reconfirm.status, 404);

      // 5. Paid status persists on re-fetch (leave and come back).
      const reread = await Booking.findById(booking._id).lean();
      assert.equal(reread.paymentStatus, "paid");
      assert.equal(reread.status, "confirmed");
    } finally {
      server.close();
    }
  });
}

test("rejected hotel booking can never pay or confirm", async () => {
  const server = await startServer();
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = await register(baseUrl, "demo-rejected@example.com");
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const adminToken = await register(baseUrl, "demo-rejected-admin@example.com");
    await User.updateOne({ email: "demo-rejected-admin@example.com" }, { $set: { role: "admin" } });
    const adminAuth = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };
    const user = await User.findOne({ email: "demo-rejected@example.com" });
    const booking = await seedBooking(user._id);

    const reject = await fetch(`${baseUrl}/api/admin/bookings/${booking._id}/status`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ status: "rejected", reason: "No rooms left" }),
    });
    const rejected = await reject.json();
    assert.equal(reject.status, 200, JSON.stringify(rejected));
    assert.equal(rejected.booking.approvalStatus, "rejected");

    const pay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    assert.equal(pay.status, 404);
    const confirm = await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ paymentReference: "DEMOQR-NEVER" }),
    });
    assert.equal(confirm.status, 404);
  } finally {
    server.close();
  }
});
