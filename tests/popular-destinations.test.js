const test = require("node:test");
const assert = require("node:assert/strict");
const destinations = require("../seed/popularDestinations");

test("popular destination catalogue includes the existing three plus six complete Nepal entries", () => {
  assert.equal(destinations.length, 9);
  assert.deepEqual(
    destinations.slice(0, 3).map((destination) => destination.name),
    ["Pokhara", "Kathmandu", "Manang"]
  );
  assert.deepEqual(
    destinations.slice(3).map((destination) => destination.name),
    ["Chitwan National Park", "Lumbini", "Bhaktapur", "Ilam", "Bandipur", "Janakpur"]
  );
  for (const destination of destinations) {
    assert.ok(destination.slug);
    assert.ok(destination.province);
    assert.ok(destination.description);
    assert.ok(destination.highlights.length >= 3);
    assert.ok(destination.tags.includes("popular"));
  }
});
