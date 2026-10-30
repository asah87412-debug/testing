const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_place_search_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer(t) {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([
    User.deleteMany({}),
    Restaurant.deleteMany({}),
    Transport.deleteMany({}),
    LocalPlace.deleteMany({}),
  ]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await Promise.all([
      User.deleteMany({}),
      Restaurant.deleteMany({}),
      Transport.deleteMany({}),
      LocalPlace.deleteMany({}),
    ]);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  return `http://127.0.0.1:${server.address().port}/api`;
}

test("restaurant search combines verified cuisine, city, and meal filters", async (t) => {
  const baseUrl = await startServer(t);
  const restaurants = await Restaurant.insertMany([
    {
      name: "Verified Dal Bhat",
      city: "Pokhara",
      cuisine: ["Nepali"],
      foodTypes: ["Vegetarian"],
      mealTimes: ["Lunch"],
      priceRange: "$",
      openingHours: {
        sun: "00:00-23:59",
        mon: "00:00-23:59",
        tue: "00:00-23:59",
        wed: "00:00-23:59",
        thu: "00:00-23:59",
        fri: "00:00-23:59",
        sat: "00:00-23:59",
      },
      isDemoData: false,
    },
    {
      name: "Verified Pasta",
      city: "Pokhara",
      cuisine: ["Italian"],
      foodTypes: ["Vegetarian"],
      mealTimes: ["Dinner"],
      priceRange: "$$",
      isDemoData: false,
    },
    { name: "Demo Only Cafe", city: "Pokhara", cuisine: ["Nepali"], isDemoData: true },
    { name: "Unmarked Legacy Cafe", city: "Pokhara", cuisine: ["Nepali"] },
  ]);

  const response = await fetch(
    `${baseUrl}/restaurants?search=DAL&city=Pokhara&cuisine=Nepali&mealTime=Lunch&priceRange=%24`
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((item) => item.name), ["Verified Dal Bhat"]);

  const all = await fetch(`${baseUrl}/restaurants?search=pokhara`);
  assert.deepEqual((await all.json()).map((item) => item.name), ["Verified Dal Bhat", "Verified Pasta"]);
  const openNow = await fetch(`${baseUrl}/restaurants?openNow=true`);
  assert.deepEqual((await openNow.json()).map((item) => item.name), ["Verified Dal Bhat"]);
  const naturalLanguage = await fetch(
    `${baseUrl}/restaurants?search=${encodeURIComponent("Nepali food in Pokhara")}`
  );
  assert.deepEqual((await naturalLanguage.json()).map((item) => item.name), ["Verified Dal Bhat"]);
  const filters = await fetch(`${baseUrl}/restaurants/filters`);
  const options = await filters.json();
  assert.ok(options.cuisines.includes("Nepali"));
  assert.ok(options.priceRanges.includes("$"));
  const details = await fetch(`${baseUrl}/restaurants/${restaurants[0]._id}`);
  assert.equal(details.status, 200);
  assert.equal((await details.json()).name, "Verified Dal Bhat");
  assert.equal((await fetch(`${baseUrl}/restaurants/${restaurants[2]._id}`)).status, 404);
});

test("transport search filters actual routes and refuses unsupported availability", async (t) => {
  const baseUrl = await startServer(t);
  const transports = await Transport.insertMany([
    { name: "Manang Jeep", type: "Jeep / 4WD", origin: "Pokhara", destination: "Manang", serviceMode: "shared", price: 3500, isDemoData: false },
    { name: "Demo Bus", type: "Tourist Bus", origin: "Kathmandu", destination: "Pokhara", isDemoData: true },
    { name: "Legacy Bus", type: "Public Bus", origin: "Kathmandu", destination: "Pokhara" },
  ]);

  const result = await fetch(`${baseUrl}/transports?origin=pok&destination=MAN&type=Jeep%20%2F%204WD`);
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).map((item) => item.name), ["Manang Jeep"]);
  const detail = await fetch(`${baseUrl}/transports/${transports[0]._id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).destination, "Manang");
  assert.equal((await fetch(`${baseUrl}/transports?available=true`)).status, 400);
});

test("activities and local services return only verified filtered database records", async (t) => {
  const baseUrl = await startServer(t);
  await LocalPlace.insertMany([
    { name: "Verified Rafting", module: "activity", category: "Rafting", city: "Pokhara", price: 2500, durationMinutes: 120, difficulty: "Moderate", isDemoData: false },
    { name: "Demo Rafting", module: "activity", category: "Rafting", city: "Pokhara", price: 1, isDemoData: true },
    {
      name: "Verified ATM",
      module: "atm",
      category: "ATM",
      city: "Pokhara",
      openingHours: {
        sun: "24/7", mon: "24/7", tue: "24/7", wed: "24/7",
        thu: "24/7", fri: "24/7", sat: "24/7",
      },
      supportedNetworks: ["Visa"],
      isDemoData: false,
    },
  ]);

  const activities = await fetch(`${baseUrl}/places?module=activity&category=Rafting&city=pokhara&maxPrice=3000&maxDuration=180`);
  assert.equal(activities.status, 200);
  const response = await activities.json();
  assert.equal(response.total, 1);
  assert.equal(response.items[0].name, "Verified Rafting");

  const atms = await fetch(`${baseUrl}/places?module=atm&category=ATM`);
  assert.deepEqual((await atms.json()).items.map((item) => item.name), ["Verified ATM"]);
  const openAtms = await fetch(`${baseUrl}/places?module=atm&openNow=true&open24Hours=true`);
  assert.deepEqual((await openAtms.json()).items.map((item) => item.name), ["Verified ATM"]);
  assert.equal((await fetch(`${baseUrl}/places?module=atm&nearMe=true`)).status, 400);
  const invalid = await fetch(`${baseUrl}/places?module=flights`);
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${baseUrl}/places?module=activity&minPrice=10&maxPrice=1`)).status, 400);
});

test("verified listing write endpoints require administrator authentication", async (t) => {
  const baseUrl = await startServer(t);
  const payloads = [
    ["/restaurants", { name: "Not a verified restaurant" }],
    ["/transports", { name: "Not a verified route" }],
    ["/places", { name: "Not a verified activity", module: "activity" }],
  ];
  for (const [path, body] of payloads) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 401);
  }

  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Regular Traveler",
      email: "place-search-traveler@example.com",
      password: "StrongPass123!",
    }),
  });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  await User.updateOne(
    { _id: registered.user._id },
    { $set: { emailVerified: true }, $unset: { emailVerificationOtpHash: 1, emailVerificationExpiresAt: 1 } }
  );
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "place-search-traveler@example.com", password: "StrongPass123!" }),
  });
  assert.equal(loginRes.status, 200);
  const account = await loginRes.json();
  const forbidden = await fetch(`${baseUrl}/places`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify({ name: "Not a verified activity", module: "activity" }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal(await LocalPlace.countDocuments({}), 0);
});
