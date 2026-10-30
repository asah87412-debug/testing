const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const Trip = require("../models/Trip");
const Destination = require("../models/Destination");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_trip_validation_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

function futureISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await Promise.all([User.deleteMany({}), Trip.deleteMany({}), Destination.deleteMany({}), Transport.deleteMany({}), LocalPlace.deleteMany({})]);
  await Destination.create([
    { name: "Pokhara", slug: "pokhara", description: "Validation test destination." },
    { name: "Chitwan National Park", slug: "chitwan-national-park", description: "Validation test destination." },
  ]);
  await Transport.create({
    name: "Airport Transfer Test",
    origin: "Tribhuvan Airport",
    destination: "Thamel, Kathmandu",
    type: "Taxi",
    price: 1500,
    isDemoData: false,
  });
  await LocalPlace.create({
    name: "Thamel Market",
    module: "shopping",
    city: "Kathmandu",
    isDemoData: false,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function register(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Validation Tester", email: "trip-validation@example.test", password: "StrongPass123!" }),
  });
  const session = await response.json();
  assert.equal(response.status, 201, JSON.stringify(session));
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

test("destination validate endpoint accepts real places and rejects gibberish", async () => {
  const { baseUrl, server } = await startServer();
  try {
    for (const name of ["Pokhara", "Chitwan", "Chitwan National Park"]) {
      const ok = await fetch(`${baseUrl}/api/destinations/validate?name=${encodeURIComponent(name)}`);
      const body = await ok.json();
      assert.equal(ok.status, 200, `${name}: ${JSON.stringify(body)}`);
      assert.equal(body.success, true);
      assert.ok(body.destination.name);
    }
    for (const name of ["sjfbfbfj", "asdfgh", "xyz123", ""]) {
      const bad = await fetch(`${baseUrl}/api/destinations/validate?name=${encodeURIComponent(name)}`);
      const body = await bad.json();
      assert.equal(bad.status, 400, `${name}: ${JSON.stringify(body)}`);
      assert.equal(body.code, "INVALID_DESTINATION");
      assert.equal(body.message, "Please select a valid Nepal destination.");
    }
  } finally {
    await stopServer(server);
  }
});

test("POST /trips rejects invalid destinations and invalid dates", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const auth = await register(baseUrl);
    const post = (body) => fetch(`${baseUrl}/api/trips`, {
      method: "POST", headers: auth, body: JSON.stringify(body),
    });

    // Gibberish destination is rejected before anything is stored.
    const bad = await post({ name: "Trip", destination: "sjfbfbfj", startDate: futureISO(7), endDate: futureISO(10) });
    const badBody = await bad.json();
    assert.equal(bad.status, 400, JSON.stringify(badBody));
    assert.equal(badBody.code, "INVALID_DESTINATION");
    assert.equal(await Trip.countDocuments(), 0);

    // Past start date rejected.
    const past = await post({ name: "Trip", destination: "Pokhara", startDate: "2020-01-01", endDate: futureISO(10) });
    assert.equal(past.status, 400, JSON.stringify(await past.json()));

    // Impossible calendar date rejected (strict round-trip, not new Date()).
    const impossible = await post({ name: "Trip", destination: "Pokhara", startDate: "2026-02-30", endDate: futureISO(10) });
    assert.equal(impossible.status, 400);

    // End before start rejected.
    const reversed = await post({ name: "Trip", destination: "Pokhara", startDate: futureISO(10), endDate: futureISO(7) });
    assert.equal(reversed.status, 400);

    // Valid trip stores the canonical destination name.
    const good = await post({ name: "Trip to Chitwan", destination: "Chitwan", startDate: futureISO(7), endDate: futureISO(10), adults: 2 });
    const goodBody = await good.json();
    assert.equal(good.status, 201, JSON.stringify(goodBody));
    assert.equal(goodBody.destination, "Chitwan National Park");
  } finally {
    await stopServer(server);
  }
});

test("POST /trips/plan rejects unknown destinations", async () => {
  const { baseUrl, server } = await startServer();
  try {
    const bad = await fetch(`${baseUrl}/api/trips/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "sjfbfbfj", durationDays: 2 }),
    });
    const body = await bad.json();
    assert.equal(bad.status, 400, JSON.stringify(body));
    assert.equal(body.code, "INVALID_DESTINATION");
  } finally {
    await stopServer(server);
  }
});

test("origin suggestions resolve real places; gibberish is rejected everywhere", async () => {
  const { baseUrl, server } = await startServer();
  try {
    // Suggestions surface the airport + market records.
    const search = await fetch(`${baseUrl}/api/locations/search?q=Thamel`);
    const suggestions = (await search.json()).locations;
    assert.equal(search.status, 200);
    assert.ok(suggestions.some((l) => l.name === "Thamel, Kathmandu"), JSON.stringify(suggestions));
    assert.ok(suggestions.every((l) => l.refId && l.name));

    // Selecting a suggestion validates by record id + selected text (the
    // frontend always sends both; a mismatched pair must not validate).
    const picked = suggestions.find((l) => l.name === "Thamel, Kathmandu");
    const valid = await fetch(
      `${baseUrl}/api/locations/validate?id=${picked.refId}&name=${encodeURIComponent(picked.name)}`
    );
    const validBody = await valid.json();
    assert.equal(valid.status, 200, JSON.stringify(validBody));
    assert.equal(validBody.location.name, "Thamel, Kathmandu");

    const mismatched = await fetch(
      `${baseUrl}/api/locations/validate?id=${picked.refId}&name=${encodeURIComponent("Tribhuvan Airport")}`
    );
    // Same record, other endpoint selected text is honest — resolves to that endpoint.
    const mismatchedBody = await mismatched.json();
    assert.equal(mismatched.status, 200, JSON.stringify(mismatchedBody));
    assert.equal(mismatchedBody.location.name, "Tribhuvan Airport");

    const forged = await fetch(
      `${baseUrl}/api/locations/validate?id=${picked.refId}&name=${encodeURIComponent("sfdfdgfqfg")}`
    );
    assert.equal(forged.status, 400, JSON.stringify(await forged.json()));

    // Gibberish is rejected with a clean structured error.
    for (const name of ["sfdfdgfqfg", "asdfgh", "xyz123", "qwerty"]) {
      const bad = await fetch(`${baseUrl}/api/locations/validate?name=${encodeURIComponent(name)}`);
      const body = await bad.json();
      assert.equal(bad.status, 400, `${name}: ${JSON.stringify(body)}`);
      assert.equal(body.code, "INVALID_ORIGIN");
      assert.equal(body.message, "Please select a valid origin.");
    }

    // Trip creation rejects a gibberish origin and accepts a validated one.
    const auth = await register(baseUrl);
    const post = (body) => fetch(`${baseUrl}/api/trips`, {
      method: "POST", headers: auth, body: JSON.stringify(body),
    });
    const rejected = await post({
      name: "Trip", destination: "Pokhara", origin: "sfdfdgfqfg",
      startDate: futureISO(7), endDate: futureISO(10),
    });
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 400, JSON.stringify(rejectedBody));
    assert.equal(rejectedBody.code, "INVALID_ORIGIN");
    assert.equal(await Trip.countDocuments(), 0);

    const accepted = await post({
      name: "Trip", destination: "Pokhara", origin: picked.name,
      originDetails: { refId: picked.refId },
      startDate: futureISO(7), endDate: futureISO(10),
    });
    const acceptedBody = await accepted.json();
    assert.equal(accepted.status, 201, JSON.stringify(acceptedBody));
    assert.equal(acceptedBody.origin, "Thamel, Kathmandu");
    assert.equal(acceptedBody.originDetails.refId, picked.refId);

    // The planner endpoint rejects a gibberish origin too.
    const plan = await fetch(`${baseUrl}/api/trips/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "Pokhara", durationDays: 2, origin: "sfdfdgfqfg" }),
    });
    const planBody = await plan.json();
    assert.equal(plan.status, 400, JSON.stringify(planBody));
    assert.equal(planBody.code, "INVALID_ORIGIN");
  } finally {
    await stopServer(server);
  }
});
