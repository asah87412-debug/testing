const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const Hotel = require("../models/Hotel");
const Booking = require("../models/Booking");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_room_availability_test";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";
  await connectDB();
  await Promise.all([Hotel.deleteMany({}), Booking.deleteMany({})]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

function closeServer(t, server) {
  t.after(async () => {
    await Promise.all([Hotel.deleteMany({}), Booking.deleteMany({})]);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
}

function dateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function queryFor(checkIn, checkOut, { adults = 2, children = 1, rooms = 1 } = {}) {
  const params = new URLSearchParams({
    checkIn: checkIn.toISOString().slice(0, 10),
    checkOut: checkOut.toISOString().slice(0, 10),
    adults: String(adults),
    children: String(children),
    rooms: String(rooms),
  });
  return params.toString();
}

test("hotel search and detail availability match occupancy and overlapping bookings", async (t) => {
  const server = await startServer();
  closeServer(t, server);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/hotels`;
  const hotel = await Hotel.create({
    name: "Family Lodge",
    pricePerNight: 2500,
    isDemoData: false,
    roomTypes: [
      { name: "Family room", capacityAdults: 2, capacityChildren: 2, totalRooms: 2 },
      { name: "Single room", capacityAdults: 1, capacityChildren: 0, totalRooms: 4 },
    ],
  });
  const staggeredHotel = await Hotel.create({
    name: "Staggered Lodge",
    pricePerNight: 2200,
    isDemoData: false,
    roomTypes: [
      { name: "Twin room", capacityAdults: 2, capacityChildren: 2, totalRooms: 2 },
    ],
  });
  await Hotel.create({
    name: "Single-only Inn",
    pricePerNight: 1800,
    isDemoData: false,
    roomTypes: [{ name: "Single", capacityAdults: 1, capacityChildren: 0, totalRooms: 5 }],
  });
  const checkIn = dateOffset(10);
  const checkOut = dateOffset(12);
  await Booking.create({
    userId: new mongoose.Types.ObjectId(),
    itemType: "hotel",
    itemId: hotel._id,
    roomTypeId: hotel.roomTypes[0]._id,
    roomTypeName: "Family room",
    itemName: hotel.name,
    checkIn,
    checkOut,
    adults: 2,
    children: 1,
    rooms: 1,
    amount: 2500,
    status: "pending",
  });
  await Booking.create({
    userId: new mongoose.Types.ObjectId(),
    itemType: "hotel",
    itemId: hotel._id,
    roomTypeId: hotel.roomTypes[0]._id,
    roomTypeName: "Family room",
    itemName: hotel.name,
    checkIn,
    checkOut,
    adults: 2,
    children: 1,
    rooms: 1,
    amount: 2500,
    status: "cancelled",
  });
  await Booking.create([
    {
      userId: new mongoose.Types.ObjectId(),
      itemType: "hotel",
      itemId: staggeredHotel._id,
      roomTypeId: staggeredHotel.roomTypes[0]._id,
      roomTypeName: "Twin room",
      itemName: staggeredHotel.name,
      checkIn,
      checkOut: dateOffset(11),
      adults: 2,
      children: 0,
      rooms: 1,
      amount: 2200,
      status: "pending",
    },
    {
      userId: new mongoose.Types.ObjectId(),
      itemType: "hotel",
      itemId: staggeredHotel._id,
      roomTypeId: staggeredHotel.roomTypes[0]._id,
      roomTypeName: "Twin room",
      itemName: staggeredHotel.name,
      checkIn: dateOffset(11),
      checkOut,
      adults: 2,
      children: 0,
      rooms: 1,
      amount: 2200,
      status: "confirmed",
    },
  ]);

  const search = await fetch(`${baseUrl}?${queryFor(checkIn, checkOut)}`);
  assert.equal(search.status, 200);
  const results = await search.json();
  assert.deepEqual(results.map((record) => record.name), ["Family Lodge", "Staggered Lodge"]);
  assert.equal(results[0].roomTypes.find((room) => room.name === "Family room").availableRooms, 1);

  const staggeredStay = await fetch(`${baseUrl}?${queryFor(checkIn, dateOffset(12))}`);
  const staggeredResults = await staggeredStay.json();
  const staggeredResult = staggeredResults.find((record) => record._id === staggeredHotel._id.toString());
  assert.equal(staggeredResult.roomTypes[0].availableRooms, 1);

  const insufficientInventory = await fetch(`${baseUrl}?${queryFor(checkIn, checkOut, { adults: 2, children: 1, rooms: 2 })}`);
  assert.deepEqual(await insufficientInventory.json(), []);

  const adjacentStay = await fetch(`${baseUrl}?${queryFor(checkOut, dateOffset(13))}`);
  const adjacentResults = await adjacentStay.json();
  assert.deepEqual(adjacentResults.map((record) => record.name), ["Family Lodge", "Staggered Lodge"]);
  assert.equal(adjacentResults[0].roomTypes.find((room) => room.name === "Family room").availableRooms, 2);
  assert.equal(adjacentResults[1].roomTypes[0].availableRooms, 2);

  const childFreeSearch = await fetch(`${baseUrl}?${queryFor(checkIn, checkOut, { adults: 1, children: 0 })}`);
  assert.deepEqual((await childFreeSearch.json()).map((record) => record.name), ["Family Lodge", "Single-only Inn", "Staggered Lodge"]);

  const detail = await fetch(`${baseUrl}/${hotel._id}/availability?${queryFor(checkIn, checkOut)}`);
  assert.equal(detail.status, 200);
  const availability = await detail.json();
  assert.equal(availability.availableForSearch, true);
  assert.equal(availability.roomTypes.find((room) => room.name === "Family room").availableRooms, 1);

  const incomplete = await fetch(`${baseUrl}?checkIn=${checkIn.toISOString().slice(0, 10)}`);
  assert.equal(incomplete.status, 400);
});
