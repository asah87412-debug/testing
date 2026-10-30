const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const Destination = require("../models/Destination");
const Restaurant = require("../models/Restaurant");
const LocalPlace = require("../models/LocalPlace");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const User = require("../models/User");
const Trip = require("../models/Trip");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_trip_planner_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer(t) {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([
    Destination.deleteMany({}),
    Restaurant.deleteMany({}),
    LocalPlace.deleteMany({}),
    Hotel.deleteMany({}),
    Transport.deleteMany({}),
    User.deleteMany({}),
    Trip.deleteMany({}),
  ]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await Promise.all([
      Destination.deleteMany({}),
      Restaurant.deleteMany({}),
      LocalPlace.deleteMany({}),
      Hotel.deleteMany({}),
      Transport.deleteMany({}),
      User.deleteMany({}),
      Trip.deleteMany({}),
    ]);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  return `http://127.0.0.1:${server.address().port}/api`;
}

test("generates a multi-day itinerary from verified destination listings only", async (t) => {
  const baseUrl = await startServer(t);
  await Promise.all([
    Destination.create({
      name: "Pokhara",
      slug: "pokhara-trip-planner-test",
      image: "https://images.example.test/pokhara.jpg",
      description: "Pokhara destination",
    }),
    Destination.create({
      name: "Kathmandu",
      slug: "kathmandu-trip-planner-test",
      image: "https://images.example.test/kathmandu.jpg",
    }),
    LocalPlace.create({
      name: "Pokhara Paragliding",
      module: "activity",
      city: "Pokhara",
      category: "Paragliding",
      price: 7000,
      durationMinutes: 90,
      image: "https://images.example.test/paragliding.jpg",
      isDemoData: false,
    }),
    Restaurant.create({
      name: "Pokhara Local Restaurant",
      city: "Pokhara",
      cuisine: ["Nepali"],
      image: "https://images.example.test/restaurant.jpg",
      isDemoData: false,
    }),
    Hotel.create({
      name: "Pokhara Verified Hotel",
      city: "Pokhara",
      pricePerNight: 4000,
      image: "https://images.example.test/hotel.jpg",
      isDemoData: false,
      available: true,
    }),
    Transport.create({
      name: "Pokhara Local Taxi",
      origin: "Pokhara",
      destination: "Sarangkot",
      type: "Taxi",
      image: "https://images.example.test/taxi.jpg",
      isDemoData: false,
    }),
    LocalPlace.create({
      name: "Unverified Pokhara Activity",
      module: "activity",
      city: "Pokhara",
      image: "https://images.example.test/unverified.jpg",
      isDemoData: true,
    }),
  ]);

  const response = await fetch(`${baseUrl}/trips/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination: "Pokhara",
      durationDays: 2,
      adults: 2,
      children: 1,
      interests: ["adventure"],
    }),
  });
  const { plan } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(plan.days.length, 2);
  assert.ok(plan.days.every((day) =>
    ["Morning", "Afternoon", "Evening"].every((period) => typeof day.guidance[period] === "string")));
  assert.equal(plan.adults, 2);
  assert.equal(plan.children, 1);
  const items = plan.days.flatMap((day) => day.items);
  assert.ok(items.some((item) => item.name === "Pokhara Paragliding"));
  assert.ok(items.some((item) => item.name === "Pokhara Local Restaurant"));
  assert.ok(items.every((item) => item.entityId && item.image));
  assert.equal(items.some((item) => item.name === "Kathmandu"), false);
  assert.equal(items.some((item) => item.name === "Unverified Pokhara Activity"), false);
  assert.equal(plan.recommendations.hotels[0].name, "Pokhara Verified Hotel");
  assert.equal(plan.recommendations.transport[0].name, "Pokhara Local Taxi");
  assert.equal(plan.recommendations.weather.available, false);
  assert.equal(plan.recommendations.costSummary.total, 11000);
  assert.equal(plan.recommendations.costSummary.accommodation, 4000);
  assert.equal(plan.recommendations.costSummary.perPerson, 11000 / 3);
  assert.equal(plan.recommendations.restaurants[0].name, "Pokhara Local Restaurant");
  assert.equal(plan.warnings.length, 0);
  assert.ok(plan.dataAvailability.some((note) => /forecasts and live road directions/i.test(note)));

  const existingIds = plan.days[0].items.map((item) => item.entityId);
  const refreshedResponse = await fetch(`${baseUrl}/trips/plan/day`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination: "Pokhara",
      durationDays: 1,
      adults: 2,
      children: 1,
      interests: ["adventure"],
      excludeEntityIds: existingIds,
    }),
  });
  const { day: refreshedDay } = await refreshedResponse.json();
  assert.equal(refreshedResponse.status, 200);
  assert.ok(refreshedDay.items.every((item) => !existingIds.includes(item.entityId)));
  assert.ok(refreshedDay.items.length > 0);

  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Planner Test",
      email: "trip-planner@example.test",
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
    body: JSON.stringify({ email: "trip-planner@example.test", password: "StrongPass123!" }),
  });
  assert.equal(loginRes.status, 200);
  const account = await loginRes.json();

  const savedResponse = await fetch(`${baseUrl}/trips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify({
      name: plan.name,
      destination: plan.destination,
      durationDays: plan.durationDays,
      adults: plan.adults,
      children: plan.children,
      budget: plan.budget,
      interests: plan.interests,
      itinerary: plan.days,
      recommendations: plan.recommendations,
      dataAvailability: plan.dataAvailability,
      warnings: plan.warnings,
    }),
  });
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 201, JSON.stringify(saved));
  assert.equal(saved.userId, account.user._id);
  assert.equal(saved.itinerary[0].items[0].image, plan.days[0].items[0].image);
  assert.equal(saved.recommendations.hotels[0].entityId, plan.recommendations.hotels[0].entityId);
  assert.equal(saved.recommendations.restaurants[0].entityId, plan.recommendations.restaurants[0].entityId);
  assert.equal(saved.dataAvailability.length, plan.dataAvailability.length);
  assert.equal((await fetch(`${baseUrl}/trips`)).status, 401);

  const editedDays = saved.itinerary.map((day, index) => ({
    ...day,
    items: index === 0 ? day.items.slice(1) : day.items,
  }));
  const editResponse = await fetch(`${baseUrl}/trips/${saved._id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + account.token,
    },
    body: JSON.stringify({
      itinerary: editedDays,
      recommendations: plan.recommendations,
    }),
  });
  const editedTrip = await editResponse.json();
  assert.equal(editResponse.status, 200, JSON.stringify(editedTrip));
  assert.equal(editedTrip.itinerary[0].items.length, editedDays[0].items.length);
  assert.equal(
    editedTrip.recommendations.costSummary.listedActivityCosts,
    editedTrip.itinerary.flatMap((day) => day.items)
      .filter((item) => item.entityType === "activity" && Number.isFinite(item.estimatedCost))
      .reduce((total, item) => total + item.estimatedCost, 0)
  );
});

test("parses a natural-language trip request and rejects missing destinations or invalid durations", async (t) => {
  const baseUrl = await startServer(t);
  await Promise.all([
    Destination.create({
      name: "Pokhara",
      slug: "pokhara-natural-language-test",
      image: "https://images.example.test/pokhara.jpg",
    }),
    LocalPlace.create({
      name: "Pokhara Hiking Trail",
      module: "activity",
      city: "Pokhara",
      isDemoData: false,
    }),
  ]);
  const response = await fetch(`${baseUrl}/trips/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Plan a 5-day trip to Pokhara for 2 people under NPR 50,000 with adventure activities",
    }),
  });
  const { plan } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(plan.destination, "Pokhara");
  assert.equal(plan.durationDays, 5);
  assert.equal(plan.adults, 2);
  assert.equal(plan.budget.amount, 50000);
  assert.deepEqual(plan.interests, ["adventure"]);
  assert.equal(plan.days.length, 5);
  assert.ok(plan.days.every((day) => day.guidance.Morning && day.guidance.Afternoon && day.guidance.Evening));
  assert.ok(plan.days.flatMap((day) => day.items).some((item) =>
    item.name === "Pokhara Hiking Trail" && item.image === undefined));

  const noDestination = await fetch(`${baseUrl}/trips/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationDays: 2 }),
  });
  assert.equal(noDestination.status, 400);

  const invalidDuration = await fetch(`${baseUrl}/trips/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination: "Pokhara", durationDays: 60 }),
  });
  assert.equal(invalidDuration.status, 400);
});
