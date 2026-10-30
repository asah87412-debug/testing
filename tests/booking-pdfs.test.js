const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const Restaurant = require("../models/Restaurant");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_booking_pdfs_test";
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
  // pdfkit emits ASCII punctuation (e.g. commas) as literal Tj strings rather
  // than hex runs, so commas never reach the decoder: strip them both sides.
  return parts.join("").replace(/,/g, "");
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
    Hotel.deleteMany({}),
    Transport.deleteMany({}),
    LocalPlace.deleteMany({}),
    Restaurant.deleteMany({}),
  ]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
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

async function seedCatalog() {
  const hotel = await Hotel.create({
    name: "Pdf Test Lakeside Hotel",
    location: "Lakeside",
    city: "Pokhara",
    province: "Gandaki",
    description: "A lakeside test stay.",
    pricePerNight: 4000,
    rating: 4.5,
    reviewCount: 120,
    amenities: ["WiFi", "Breakfast"],
    roomTypes: [{
      name: "Deluxe Lake View",
      capacityAdults: 2,
      capacityChildren: 1,
      totalRooms: 5,
      nightlyRate: 4500,
      bedConfiguration: "1 King Bed",
      breakfastIncluded: true,
      amenities: ["Balcony"],
    }],
    checkInTime: "13:00",
    checkOutTime: "11:00",
    policies: ["No smoking"],
    cancellationPolicy: "Free cancellation up to 48h.",
    contact: { phone: "+977-61-000000" },
    isDemoData: false,
    available: true,
  });
  const vehicle = await Transport.create({
    name: "Pdf Test Tourist Bus",
    type: "Tourist Bus",
    provider: "Pdf Travels",
    origin: "Kathmandu",
    destination: "Pokhara",
    departureTime: "07:00",
    arrivalTime: "14:00",
    durationMinutes: 420,
    price: 1500,
    capacity: 30,
    serviceMode: "shared",
    seatLabels: ["1A", "1B", "1C", "1D"],
    amenities: ["AC"],
    contact: { phone: "+977-1-000000" },
    isDemoData: false,
  });
  const activity = await LocalPlace.create({
    name: "Pdf Test Boating",
    module: "activity",
    description: "Test boating activity.",
    location: "Phewa Lake",
    city: "Pokhara",
    price: 800,
    durationMinutes: 60,
    capacityPerSlot: 20,
    slots: ["09:00"],
    meetingPoint: "Lakeside dock",
    minAge: 12,
    requirements: ["Swimming basics"],
    includedServices: ["Life jacket"],
    cancellationPolicy: "Same-day free cancel.",
    isDemoData: false,
  });
  const restaurant = await Restaurant.create({ name: "Pdf Test Restaurant", city: "Pokhara", isDemoData: false });
  return { hotel, vehicle, activity, restaurant };
}

async function downloadPdf(baseUrl, auth, id) {
  const res = await fetch(`${baseUrl}/api/bookings/${id}/pdf`, { headers: auth });
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
}

test("hotel, transport, and activity bookings each download a faithful PDF", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const traveller = await createUser("Pdf Traveller", "pdf-traveller@example.test");
    const adminReg = await createUser("Pdf Admin", "pdf-admin@example.test", "admin");
    const stranger = await createUser("Pdf Stranger", "pdf-stranger@example.test");
    const userAuth = authHeaders(traveller);
    const adminAuth = authHeaders(adminReg);
    const strangerAuth = authHeaders(stranger);
    const { hotel, vehicle, activity, restaurant } = await seedCatalog();
    const roomTypeId = String(hotel.roomTypes[0]._id);

    const hotelRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({
        itemType: "hotel", itemId: String(hotel._id), checkIn: dateOffset(7), checkOut: dateOffset(10),
        adults: 2, children: 1, rooms: 1, roomTypeId,
      }),
    });
    const hotelBooking = (await hotelRes.json()).booking;
    assert.equal(hotelRes.status, 201, JSON.stringify(hotelBooking));
    assert.equal(hotelBooking.amount, 4500 * 3 * 1);

    const transportRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({
        itemType: "transport", itemId: String(vehicle._id), checkIn: dateOffset(7),
        adults: 2, children: 0, seatNumbers: ["1A", "1B"],
      }),
    });
    const transportBooking = (await transportRes.json()).booking;
    assert.equal(transportRes.status, 201, JSON.stringify(transportBooking));
    assert.deepEqual(transportBooking.seatNumbers, ["1A", "1B"]);

    const activityRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({
        itemType: "activity", itemId: String(activity._id), checkIn: dateOffset(7),
        adults: 1, children: 1, serviceTime: "09:00", participantAges: [20, 14],
      }),
    });
    const activityBooking = (await activityRes.json()).booking;
    assert.equal(activityRes.status, 201, JSON.stringify(activityBooking));

    const restaurantRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({ itemType: "restaurant", itemId: String(restaurant._id), checkIn: dateOffset(7), adults: 2 }),
    });
    assert.equal(restaurantRes.status, 201);
    const restaurantBooking = (await restaurantRes.json()).booking;

    // Pay the hotel booking through the real approval flow (hotel gate).
    await fetch(`${baseUrl}/api/admin/bookings/${hotelBooking._id}/status`, {
      method: "PATCH", headers: adminAuth, body: JSON.stringify({ status: "confirmed" }),
    });
    await fetch(`${baseUrl}/api/bookings/${hotelBooking._id}/pay`, {
      method: "POST", headers: userAuth, body: JSON.stringify({ paymentMethod: "esewa" }),
    });
    const confirm = await fetch(`${baseUrl}/api/bookings/${hotelBooking._id}/confirm`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({ paymentReference: "PDFDEMO-1", amount: hotelBooking.amount }),
    });
    assert.equal(confirm.status, 200);

    const snapshot = async (id) => (await (await fetch(`${baseUrl}/api/bookings/${id}`, { headers: userAuth })).json()).booking;

    // --- Hotel PDF (paid) ---
    const hp = await downloadPdf(baseUrl, userAuth, hotelBooking._id);
    assert.equal(hp.status, 200);
    assert.match(hp.headers.get("content-type") || "", /application\/pdf/);
    const hDisposition = hp.headers.get("content-disposition") || "";
    assert.ok(hDisposition.includes(`SuvYatra_Hotel_${hotelBooking.bookingCode}.pdf`), hDisposition);
    const hText = pdfPlainText(hp.buffer);
    for (const needle of [
      "SuvYatra", "Hotel Booking Details", hotelBooking.bookingCode,
      "Pdf Test Lakeside Hotel", "Lakeside", "Pokhara", "Deluxe Lake View",
      "1 King Bed", "4500", "13500", "2 adults", "1 child",
      "13:00", "11:00", "Free cancellation up to 48h",
      "Paid", "esewa", "PDFDEMO-1", "pdf-traveller@example.test",
    ]) {
      assert.ok(hText.includes(needle.replace(/,/g, "")), `hotel PDF contains "${needle}"`);
    }

    // --- Transport PDF (pending: truthful statuses, no state change) ---
    const tp = await downloadPdf(baseUrl, userAuth, transportBooking._id);
    assert.equal(tp.status, 200);
    assert.ok((tp.headers.get("content-disposition") || "").includes(`SuvYatra_Transport_${transportBooking.bookingCode}.pdf`));
    const tText = pdfPlainText(tp.buffer);
    for (const needle of [
      "SuvYatra", "Transportation Booking Details", transportBooking.bookingCode,
      "Pdf Test Tourist Bus", "Tourist Bus", "Pdf Travels",
      "Kathmandu", "Pokhara", "07:00", "14:00",
      "1A", "1B", "1500", "3000", "Pending",
    ]) {
      assert.ok(tText.includes(needle.replace(/,/g, "")), `transport PDF contains "${needle}"`);
    }

    // --- Activity PDF (pending): locked until admin completion ---
    const apPending = await downloadPdf(baseUrl, userAuth, activityBooking._id);
    assert.equal(apPending.status, 403);
    assert.match(apPending.buffer.toString("utf8"), /admin completion/i);

    // Complete the activity through the real workflow: accept -> pay -> confirm -> complete.
    await fetch(`${baseUrl}/api/admin/bookings/${activityBooking._id}/status`, {
      method: "PATCH", headers: adminAuth, body: JSON.stringify({ status: "confirmed" }),
    });
    await fetch(`${baseUrl}/api/bookings/${activityBooking._id}/pay`, {
      method: "POST", headers: userAuth, body: JSON.stringify({ paymentMethod: "khalti" }),
    });
    const actConfirm = await fetch(`${baseUrl}/api/bookings/${activityBooking._id}/confirm`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({ paymentReference: "PDFDEMO-2", amount: activityBooking.amount }),
    });
    assert.equal(actConfirm.status, 200);
    // Paid but not completed: still locked (payment alone is insufficient).
    assert.equal((await downloadPdf(baseUrl, userAuth, activityBooking._id)).status, 403);
    const actComplete = await fetch(`${baseUrl}/api/admin/bookings/${activityBooking._id}/status`, {
      method: "PATCH", headers: adminAuth, body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(actComplete.status, 200);

    // --- Activity PDF (completed): full content ---
    const ap = await downloadPdf(baseUrl, userAuth, activityBooking._id);
    assert.equal(ap.status, 200);
    assert.ok((ap.headers.get("content-disposition") || "").includes(`SuvYatra_Activity_${activityBooking.bookingCode}.pdf`));
    const aText = pdfPlainText(ap.buffer);
    for (const needle of [
      "SuvYatra", "Activity Booking Details", activityBooking.bookingCode,
      "Pdf Test Boating", "Phewa Lake", "09:00", "Lakeside dock",
      "20, 14", "12", "800", "1600", "Completed", "Paid",
    ]) {
      assert.ok(aText.includes(needle.replace(/,/g, "")), `activity PDF contains "${needle}"`);
    }

    // --- Guards: wrong type, strangers, anonymous, rejected, and record immutability ---
    const restPdf = await downloadPdf(baseUrl, userAuth, restaurantBooking._id);
    assert.equal(restPdf.status, 403);
    const rejRes = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST", headers: userAuth,
      body: JSON.stringify({
        itemType: "activity", itemId: String(activity._id), checkIn: dateOffset(9),
        adults: 1, children: 0, serviceTime: "09:00", participantAges: [25],
      }),
    });
    assert.equal(rejRes.status, 201);
    const rejBooking = (await rejRes.json()).booking;
    await fetch(`${baseUrl}/api/admin/bookings/${rejBooking._id}/status`, {
      method: "PATCH", headers: adminAuth, body: JSON.stringify({ status: "rejected", reason: "Test rejection." }),
    });
    assert.equal((await downloadPdf(baseUrl, userAuth, rejBooking._id)).status, 403);
    for (const id of [hotelBooking._id, transportBooking._id, activityBooking._id]) {
      assert.equal((await downloadPdf(baseUrl, strangerAuth, id)).status, 403);
    }
    const anon = await fetch(`${baseUrl}/api/bookings/${hotelBooking._id}/pdf`);
    assert.equal(anon.status, 401);
    const after = await snapshot(hotelBooking._id);
    assert.equal(after.status, "confirmed");
    assert.equal(after.paymentStatus, "paid");
    assert.equal(after.amount, hotelBooking.amount);
    const afterTransport = await snapshot(transportBooking._id);
    assert.equal(afterTransport.status, "pending");
    assert.equal(afterTransport.paymentStatus, "not_configured");
    const afterActivity = await snapshot(activityBooking._id);
    assert.equal(afterActivity.status, "completed");
    assert.equal(afterActivity.paymentStatus, "paid");
    assert.equal(afterActivity.amount, activityBooking.amount);
  } finally {
    await stopServer(server);
  }
});
