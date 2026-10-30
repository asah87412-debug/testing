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

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_trip_lifecycle_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

function dateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// pdfkit stores page text as hex runs (sometimes kern-split), so decode every
// <hex> run back to text before asserting on PDF content.
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
  ]);
  await Destination.create({ name: "Pokhara", slug: "pokhara", description: "Lifecycle test destination." });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

// Registration goes through email-OTP verification (needs SMTP), so tests
// create verified users directly and sign the same JWT shape as login.
async function createUser(name, email, role = "user") {
  const user = await User.create({
    name,
    email,
    password: "StrongPass123!",
    provider: "Email",
    emailVerified: true,
    role,
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  return { user, token };
}

function authHeaders(session) {
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

async function submitTrip(baseUrl, userAuth, amount = 5000) {
  const tripRes = await fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: userAuth,
    body: JSON.stringify({
      name: "Trip to Pokhara",
      destination: "Pokhara",
      startDate: dateOffset(7),
      endDate: dateOffset(10),
      adults: 2,
      children: 0,
      selections: {
        party: { adults: 2, children: 0, rooms: 1 },
        totals: { hotel: 3000, transportation: 1500, activities: 500, total: amount, currency: "NPR" },
      },
      totalAmount: amount,
    }),
  });
  const trip = await tripRes.json();
  assert.equal(tripRes.status, 201, JSON.stringify(trip));
  assert.ok(trip.selections, "trip stores the selections snapshot");

  const bookingRes = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: userAuth,
    body: JSON.stringify({
      itemType: "trip",
      tripId: trip._id,
      checkIn: dateOffset(7),
      checkOut: dateOffset(10),
      adults: 2,
      children: 0,
      rooms: 1,
      amount,
    }),
  });
  const created = await bookingRes.json();
  assert.equal(bookingRes.status, 201, JSON.stringify(created));
  return { trip, booking: created.booking };
}

test("complete trip lifecycle: submit → confirm → pay → complete → PDF", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const traveller = await createUser("Trip Traveller", "lifecycle-traveller@example.test");
    const adminReg = await createUser("Lifecycle Admin", "lifecycle-admin@example.test", "admin");
    const stranger = await createUser("Stranger", "lifecycle-stranger@example.test");
    const userAuth = authHeaders(traveller);
    const adminAuth = authHeaders(adminReg);
    const strangerAuth = authHeaders(stranger);

    // 1-2. Submit trip without paying; it appears as pending.
    const { trip, booking } = await submitTrip(baseUrl, userAuth);
    assert.equal(booking.status, "pending");
    assert.equal(booking.approvalStatus, "pending");
    assert.equal(booking.paymentStatus, "not_configured");

    const list = await (await fetch(`${baseUrl}/api/bookings`, { headers: userAuth })).json();
    const listed = list.bookings.find((b) => b._id === booking._id);
    assert.ok(listed, "trip appears in My Bookings");
    assert.equal(listed.status, "pending");

    // 3. Payment is unavailable before admin confirmation.
    const earlyPay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    assert.equal(earlyPay.status, 403, "pay blocked before admin confirmation");
    const earlyBody = await earlyPay.json();
    assert.equal(earlyBody.code, "TRIP_AWAITING_APPROVAL");

    // Admin sees the UNPAID trip in approvals and confirms it.
    const queue = await (await fetch(`${baseUrl}/api/admin/approvals`, { headers: adminAuth })).json();
    const queued = queue.approvals.find((a) => a.kind === "booking" && String(a._id) === String(booking._id));
    assert.ok(queued, "unpaid trip queues for admin confirmation");

    const accept = await fetch(`${baseUrl}/api/admin/approvals/booking/${booking._id}/accept`, {
      method: "POST",
      headers: adminAuth,
    });
    assert.equal(accept.status, 200, JSON.stringify(await accept.json()));

    const afterAccept = await (await fetch(`${baseUrl}/api/bookings/${booking._id}`, { headers: userAuth })).json();
    assert.equal(afterAccept.booking.status, "confirmed");
    assert.equal(afterAccept.booking.approvalStatus, "approved");
    assert.notEqual(afterAccept.booking.paymentStatus, "paid", "confirming never marks paid");

    // 4. Pay Now: per-booking QR + amount, then verified confirm.
    const pay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    const payBody = await pay.json();
    assert.equal(pay.status, 200, JSON.stringify(payBody));
    assert.equal(payBody.paymentConfirmed, false, "pay only initiates");
    assert.ok(String(payBody.qr.payload).includes(booking.bookingCode), "QR names this booking");
    assert.equal(payBody.qr.amount, booking.amount, "QR carries this booking's amount");

    const wrongAmount = await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentReference: "WRONG", amount: booking.amount + 1 }),
    });
    assert.equal(wrongAmount.status, 400, "amount mismatch aborts");

    const confirm = await fetch(`${baseUrl}/api/bookings/${booking._id}/confirm`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentReference: "DEMOQR-ABC123", amount: booking.amount }),
    });
    const confirmBody = await confirm.json();
    assert.equal(confirm.status, 200, JSON.stringify(confirmBody));
    assert.equal(confirmBody.paymentConfirmed, true);

    // 5. Payment verified: status stays confirmed (never auto-completed).
    const afterPay = await (await fetch(`${baseUrl}/api/bookings/${booking._id}`, { headers: userAuth })).json();
    assert.equal(afterPay.booking.paymentStatus, "paid");
    assert.equal(afterPay.booking.status, "confirmed", "payment does not auto-complete");

    // Duplicate payment is rejected.
    const doublePay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    assert.equal(doublePay.status, 409, "duplicate payment rejected");

    // 6. Admin completes only after verified payment.
    const complete = await fetch(`${baseUrl}/api/admin/bookings/${booking._id}/status`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(complete.status, 200, JSON.stringify(await complete.json()));
    const afterComplete = await (await fetch(`${baseUrl}/api/bookings/${booking._id}`, { headers: userAuth })).json();
    assert.equal(afterComplete.booking.status, "completed");
    assert.equal(afterComplete.booking.approvalStatus, "approved", "completing finalizes approval");

    // 7-8. Download Trip PDF: real file, actual booking data.
    const pdf = await fetch(`${baseUrl}/api/bookings/${booking._id}/pdf`, { headers: userAuth });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);
    const disposition = pdf.headers.get("content-disposition") || "";
    assert.ok(disposition.includes(".pdf"), "meaningful filename header");
    assert.ok(disposition.includes(booking.bookingCode), "filename names this booking");
    const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
    assert.ok(pdfBuffer.subarray(0, 5).toString() === "%PDF-", "response is a real PDF");
    const pdfText = pdfPlainText(pdfBuffer);
    assert.ok(pdfText.includes("SuvYatra"), "PDF names SuvYatra");
    assert.ok(pdfText.includes(booking.bookingCode), "PDF carries the booking reference");
    assert.ok(pdfText.includes("Pokhara"), "PDF carries the actual destination");

    // 9. Other users cannot download it; admins can.
    assert.equal((await fetch(`${baseUrl}/api/bookings/${booking._id}/pdf`, { headers: strangerAuth })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/bookings/${booking._id}/pdf`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bookings/${booking._id}/pdf`, { headers: adminAuth })).status, 200);
  } finally {
    await stopServer(server);
  }
});

test("rejected and unpaid trips: not payable, not completable, no PDF", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const traveller = await createUser("Rejected Traveller", "lifecycle-rej@example.test");
    const adminReg = await createUser("Reject Admin", "lifecycle-rejadmin@example.test", "admin");
    const userAuth = authHeaders(traveller);
    const adminAuth = authHeaders(adminReg);

    // Rejected path.
    const { booking } = await submitTrip(baseUrl, userAuth, 4000);
    const reject = await fetch(`${baseUrl}/api/admin/approvals/booking/${booking._id}/reject`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({ reason: "Test rejection." }),
    });
    assert.equal(reject.status, 200);
    const rejectedPay = await fetch(`${baseUrl}/api/bookings/${booking._id}/pay`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentMethod: "khalti" }),
    });
    assert.equal(rejectedPay.status, 404, "rejected booking is not payable");
    const rejectedComplete = await fetch(`${baseUrl}/api/admin/bookings/${booking._id}/status`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(rejectedComplete.status, 409, "rejected booking is not completable");
    assert.equal((await fetch(`${baseUrl}/api/bookings/${booking._id}/pdf`, { headers: userAuth })).status, 403);

    // Unpaid confirmed trip: not completable, no PDF yet.
    const second = await submitTrip(baseUrl, userAuth, 3000);
    await fetch(`${baseUrl}/api/admin/approvals/booking/${second.booking._id}/accept`, {
      method: "POST",
      headers: adminAuth,
    });
    const earlyComplete = await fetch(`${baseUrl}/api/admin/bookings/${second.booking._id}/status`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(earlyComplete.status, 409, "unpaid trip is not completable");
    assert.equal((await fetch(`${baseUrl}/api/bookings/${second.booking._id}/pdf`, { headers: userAuth })).status, 403);

    // Admin Confirm button path (PATCH status): approves the trip so Pay unlocks.
    const third = await submitTrip(baseUrl, userAuth, 2500);
    const patchConfirm = await fetch(`${baseUrl}/api/admin/bookings/${third.booking._id}/status`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ status: "confirmed" }),
    });
    assert.equal(patchConfirm.status, 200, JSON.stringify(await patchConfirm.json()));
    const afterPatch = await (await fetch(`${baseUrl}/api/bookings/${third.booking._id}`, { headers: userAuth })).json();
    assert.equal(afterPatch.booking.status, "confirmed");
    assert.equal(afterPatch.booking.approvalStatus, "approved", "PATCH confirm approves the trip");
    const payAfterPatch = await fetch(`${baseUrl}/api/bookings/${third.booking._id}/pay`, {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ paymentMethod: "khalti" }),
    });
    assert.equal(payAfterPatch.status, 200, "pay unlocks after PATCH confirm");
  } finally {
    await stopServer(server);
  }
});

test("completing finalizes a stale pending approval (legacy stuck rows)", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const traveller = await createUser("Stale Traveller", "lifecycle-stale@example.test");
    const adminReg = await createUser("Stale Admin", "lifecycle-staleadmin@example.test", "admin");
    const userAuth = authHeaders(traveller);
    const adminAuth = authHeaders(adminReg);

    const { booking } = await submitTrip(baseUrl, userAuth, 3500);
    // Simulate the legacy inconsistent row: confirmed + paid, approval pending.
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { status: "confirmed", approvalStatus: "pending", paymentStatus: "paid" } }
    );
    const complete = await fetch(`${baseUrl}/api/admin/bookings/${booking._id}/status`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(complete.status, 200, JSON.stringify(await complete.json()));
    const after = await (await fetch(`${baseUrl}/api/bookings/${booking._id}`, { headers: userAuth })).json();
    assert.equal(after.booking.status, "completed");
    assert.equal(after.booking.approvalStatus, "approved", "stale pending approval is finalized on complete");
    assert.equal(after.booking.paymentStatus, "paid");
  } finally {
    await stopServer(server);
  }
});
