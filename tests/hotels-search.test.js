const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Hotel = require("../models/Hotel");
const SavedItem = require("../models/SavedItem");
const Destination = require("../models/Destination");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_hotels_search_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([User.deleteMany({}), Hotel.deleteMany({}), SavedItem.deleteMany({}), Destination.deleteMany({})]);
  // Trips require a real destination record (backend validates it).
  await Destination.create({ name: "Pokhara", slug: "pokhara", description: "Hotels search test destination." });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

function closeServer(t, server) {
  t.after(async () => {
    await Promise.all([User.deleteMany({}), Hotel.deleteMany({}), SavedItem.deleteMany({}), Destination.deleteMany({})]);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
}

async function registerAndLogin(baseUrl, name, email) {
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: "StrongPass123!" }),
  });
  assert.equal(registration.status, 201);
  const body = await registration.json();
  await User.updateOne(
    { _id: body.user._id },
    { $set: { emailVerified: true }, $unset: { emailVerificationOtpHash: 1, emailVerificationExpiresAt: 1 } }
  );
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "StrongPass123!" }),
  });
  assert.equal(login.status, 200);
  return login.json();
}

test("hotel search combines verified fields and price filters", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/hotels`;
  await Hotel.insertMany([
    {
      name: "River Lodge",
      city: "Pokhara",
      district: "Kaski",
      province: "Gandaki",
      location: "Lakeside",
      pricePerNight: 3500,
      propertyTypes: ["Resort"],
      amenities: ["Parking", "Breakfast"],
      travelerTypes: ["Family"],
      specialFeatures: ["Lake View"],
      isDemoData: false,
    },
    {
      name: "Old Town Stay",
      city: "Kathmandu",
      province: "Bagmati",
      location: "Thamel",
      pricePerNight: 6500,
      propertyTypes: ["Hotel"],
      amenities: ["Wi-Fi"],
      isDemoData: false,
    },
    {
      name: "Demo Sample",
      city: "Pokhara",
      pricePerNight: 900,
      isDemoData: true,
    },
  ]);

  const response = await fetch(
    `${baseUrl}?search=LAKESIDE&province=Gandaki&propertyType=resort&facility=parking&minPrice=2000&maxPrice=5000`
  );
  assert.equal(response.status, 200);
  const hotels = await response.json();
  assert.deepEqual(hotels.map((hotel) => hotel.name), ["River Lodge"]);
  assert.equal(hotels[0].isDemoData, false);

  const naturalSearch = await fetch(`${baseUrl}?search=${encodeURIComponent("Resorts near Lakeside")}`);
  assert.deepEqual((await naturalSearch.json()).map((hotel) => hotel.name), ["River Lodge"]);

  const facets = await fetch(`${baseUrl}/filters`);
  assert.equal(facets.status, 200);
  const options = await facets.json();
  assert.ok(options.cities.includes("Pokhara"));
  assert.ok(options.propertyTypes.includes("Resort"));
  assert.ok(options.facilities.includes("Parking"));

  const invalidPrice = await fetch(`${baseUrl}?minPrice=invalid`);
  assert.equal(invalidPrice.status, 400);
});

test("hotel details use a validated database ID and expose stored fields", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/hotels`;
  const hotel = await Hotel.create({
    name: "Verified Lodge",
    city: "Pokhara",
    pricePerNight: 3200,
    images: ["https://example.test/lodge.jpg"],
    amenities: ["Breakfast"],
    isDemoData: false,
    isDemoData: false,
  });
  const response = await fetch(`${baseUrl}/${hotel._id}`);
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.name, "Verified Lodge");
  assert.equal((await fetch(`${baseUrl}/invalid-id`)).status, 400);
});

test("saved hotel records require authentication and are scoped to the current user", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const unauthorized = await fetch(`${baseUrl}/saved-items`);
  assert.equal(unauthorized.status, 401);

  const account = await registerAndLogin(baseUrl, "Test Traveler", "hotel-saved@example.com");
  const savedResponse = await fetch(`${baseUrl}/saved-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify({
      userId: new mongoose.Types.ObjectId().toString(),
      itemType: "hotel",
      itemId: new mongoose.Types.ObjectId().toString(),
      name: "My saved stay",
    }),
  });
  assert.equal(savedResponse.status, 201);
  const item = await savedResponse.json();
  assert.equal(item.userId, account.user._id);
  const savedList = await fetch(`${baseUrl}/saved-items`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  assert.deepEqual((await savedList.json()).map((saved) => saved._id), [item._id]);
});

test("trip planner stores the selected hotel and protects trips by account", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const unauthenticated = await fetch(`${baseUrl}/trips`);
  assert.equal(unauthenticated.status, 401);

  const account = await registerAndLogin(baseUrl, "Trip Traveler", "hotel-trip@example.com");
  const hotel = await Hotel.create({
    name: "Itinerary Hotel",
    location: "Lakeside",
    city: "Pokhara",
    latitude: 28.21,
    longitude: 83.96,
    isDemoData: false,
  });
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 10);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 3);
  const createdResponse = await fetch(`${baseUrl}/trips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify({
      name: "Pokhara stay",
      destination: "Pokhara",
      hotelId: hotel._id,
      plannedItems: [{
        itemId: new mongoose.Types.ObjectId().toString(),
        category: "activity",
        name: "Verified rafting",
        location: "Pokhara",
        latitude: 28.2,
        longitude: 83.9,
      }],
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.hotelId, hotel._id.toString());
  assert.equal(created.hotelName, hotel.name);
  assert.equal(created.hotelLatitude, hotel.latitude);
  assert.equal(created.plannedItems[0].name, "Verified rafting");
  assert.equal(created.plannedItems[0].latitude, 28.2);

  const ownerTrips = await fetch(`${baseUrl}/trips`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  assert.deepEqual((await ownerTrips.json()).map((trip) => trip._id), [created._id]);
});
