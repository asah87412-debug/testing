const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const definitions = require("../seed/verifiedListings");
const upsertVerifiedListings = require("../seed/upsertVerifiedListings");

const listings = upsertVerifiedListings.materializeListings(definitions);

test("verified listing catalog contains eight entries in each requested category", () => {
  assert.deepEqual(upsertVerifiedListings.validateListings(listings), {
    restaurants: 8,
    transports: 8,
    activity: 8,
    shopping: 8,
    hospital: 8,
    petrol: 8,
    atm: 8,
  });
});

test("every catalog listing has a distinct image and complete attribution", () => {
  const all = listings.flatMap((group) => group.items);
  assert.equal(all.length, 56);
  assert.equal(new Set(all.map((item) => item.image)).size, 56);
  for (const item of all) {
    assert.ok(item.imageDescription.toLocaleLowerCase().includes(item.name.toLocaleLowerCase()));
    assert.ok(item.imageSource);
    assert.ok(item.imageSourcePage);
    assert.ok(item.imageLicense);
    assert.ok(item.imageCredit);
  }
});

test("all generated category artwork is present in the backend static directory", () => {
  const publicDirectory = path.join(__dirname, "..", "public");
  const artworkListings = listings.flatMap((group) => group.items).filter(
    (item) => item.imageSource === "SuvYatra original illustration"
  );
  assert.equal(artworkListings.length, 36);
  for (const item of artworkListings) {
    assert.ok(
      fs.existsSync(path.join(publicDirectory, item.image.replace(/^\/+/, ""))),
      `Missing illustration for ${item.name}`
    );
  }
  assert.ok(
    fs.existsSync(path.join(publicDirectory, "catalog-images", "suvyatra-nepal-trip-planner.png")),
    "Missing project-owned Nepal trip planner illustration"
  );
});

test("fuel and ATM records retain their OpenStreetMap source and coordinates", () => {
  const localPlaces = listings.find((group) => group.collection === "places").items;
  for (const item of localPlaces.filter(({ module }) => module === "petrol" || module === "atm")) {
    assert.equal(item.dataSource, "OpenStreetMap");
    assert.match(item.dataSourceUrl, /^https:\/\/www\.openstreetmap\.org\/(?:node|way)\/\d+$/);
    assert.ok(Number.isFinite(item.latitude));
    assert.ok(Number.isFinite(item.longitude));
  }
});

test("category artwork is clearly marked as illustrative rather than an entity photograph", () => {
  const all = listings.flatMap((group) => group.items);
  for (const item of all.filter(({ imageRelevance }) => imageRelevance === "category")) {
    assert.match(item.imageDescription, /illustrative|illustration/i);
  }
});
