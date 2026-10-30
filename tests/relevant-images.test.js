const test = require("node:test");
const assert = require("node:assert/strict");
const {
  exactMatchScore,
  getCategorySearch,
  resolveRelevantImages,
} = require("../services/relevantImages");

function commonsResult(title, description = "A licensed travel photograph.") {
  return {
    title,
    imageinfo: [{
      thumburl: `https://thumb.wikimedia.org/wikipedia/commons/${encodeURIComponent(title)}.jpg`,
      url: `https://upload.wikimedia.org/wikipedia/commons/${encodeURIComponent(title)}.jpg`,
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        AttributionRequired: { value: "true" },
        Artist: { value: "<a>Test photographer</a>" },
        ImageDescription: { value: description },
      },
    }],
  };
}

function mockFetch(respond) {
  return async (url) => {
    const query = new URL(url).searchParams.get("gsrsearch");
    return {
      ok: true,
      json: async () => ({ query: { pages: respond(query) } }),
    };
  };
}

test("exact entity matching rejects unrelated images and preserves license attribution", async () => {
  const entity = { name: "Phewa Lake", type: "destination", location: "Pokhara, Nepal" };
  assert.equal(exactMatchScore(entity, { title: "File:Everest Nepal.jpg", description: "" }), 0);
  assert.equal(
    exactMatchScore(
      { name: "Hotel Pokhara View", type: "hotel" },
      { title: "File:Aerial View of Pokhara from Hotel.jpg", description: "Pokhara" }
    ),
    0
  );
  const images = await resolveRelevantImages(
    entity,
    mockFetch(() => [
      commonsResult("File:Random Nepal.jpg"),
      commonsResult("File:Phewa Lake of Pokhara city.jpg", "Phewa Lake, Pokhara"),
    ])
  );
  assert.equal(images.length, 1);
  assert.match(images[0].uri, /Phewa/);
  assert.equal(images[0].source, "Wikimedia Commons");
  assert.equal(images[0].license, "CC BY-SA 4.0");
  assert.equal(images[0].credit, "Test photographer");
  assert.equal(images[0].relevance, "entity");
});

test("exact image matches avoid extra Commons searches", async () => {
  let requests = 0;
  const images = await resolveRelevantImages(
    { name: "Bhaktapur Durbar Square", type: "destination", location: "Bhaktapur, Nepal" },
    mockFetch(() => {
      requests += 1;
      return [commonsResult("File:Bhaktapur Durbar Square Nepal.jpg", "Bhaktapur, Nepal")];
    })
  );
  assert.equal(images.length, 1);
  assert.equal(requests, 1);
});

test("category fallback is restricted to the entity category and location", async () => {
  const entity = { name: "Sunrise Lodge", type: "hotel", location: "Kathmandu, Nepal" };
  const images = await resolveRelevantImages(
    entity,
    mockFetch((query) => query.startsWith("hotel Nepal")
      ? [commonsResult("File:Hotel exterior in Kathmandu.jpg")]
      : [])
  );
  assert.equal(images.length, 1);
  assert.equal(images[0].relevance, "category");
  assert.match(images[0].description, /licensed travel photograph/i);
  assert.match(getCategorySearch(entity).query, /Kathmandu/);
});

test("category fallback rejects images from outside the requested location", async () => {
  const images = await resolveRelevantImages(
    { name: "Hotel Peace Palace", type: "hotel", location: "Kathmandu, Nepal" },
    mockFetch(() => [commonsResult("File:Hotel in San Francisco.jpg", "Hotel exterior, San Francisco")])
  );
  assert.deepEqual(images, []);
});

test("a passing mention of a hotel in an image description is not hotel imagery", async () => {
  const images = await resolveRelevantImages(
    { name: "Hotel Middle Path", type: "hotel", location: "Manang, Nepal" },
    mockFetch(() => [
      commonsResult(
        "File:Nepal 2018-03-27 (27972379108).jpg",
        "Namche Bazaar. Taboche seen on the way to Hotel Everest View."
      ),
    ])
  );
  assert.deepEqual(images, []);
});

test("a destination name in an unrelated farming-scene title is rejected", async () => {
  const images = await resolveRelevantImages(
    { name: "Pokhara Lakeside", type: "destination", location: "Pokhara, Nepal" },
    mockFetch(() => [
      commonsResult("File:Ploughing Over Pokhara Lakeside (113301941).jpeg"),
    ])
  );
  assert.deepEqual(images, []);
});

test("a city match rejects wildlife filenames and selects a city image", async () => {
  const images = await resolveRelevantImages(
    { name: "Kathmandu", type: "destination", location: "Kathmandu Valley, Nepal" },
    mockFetch(() => [
      commonsResult("File:Ambulyx placida Godavari Kathmandu Valley Nepal male dorsal.jpg"),
      commonsResult("File:Kathmandu 3.jpg", "Kathmandu valley as seen from Battisputali, Kathmandu, Nepal."),
    ])
  );
  assert.ok(images.length > 0);
  assert.ok(images.every((image) => !/Ambulyx|moth/i.test(image.sourcePage)));
  assert.ok(images.some((image) => /Kathmandu_3\.jpg/.test(image.sourcePage)));
});

test("an activity match must depict the activity rather than a related document", async () => {
  const images = await resolveRelevantImages(
    { name: "Trekking", type: "activity", location: "Nepal" },
    mockFetch(() => [
      commonsResult("File:1981 NEPAL trekking permit, p.2.tif"),
    ])
  );
  assert.deepEqual(images, []);
});

test("images without an approved reusable license are rejected", async () => {
  const unlicensed = commonsResult(
    "File:Rara Lake Nepal.jpg",
    "Rara Lake, Nepal"
  );
  unlicensed.imageinfo[0].extmetadata.LicenseShortName.value = "Fair use";
  const images = await resolveRelevantImages(
    { name: "Rara Lake", type: "destination", location: "Rara, Nepal" },
    mockFetch(() => [unlicensed])
  );
  assert.deepEqual(images, []);
});

test("transport category fallbacks cannot substitute a different vehicle type", async () => {
  const images = await resolveRelevantImages(
    { name: "Jeep sample", type: "transport", location: "Pokhara, Nepal" },
    mockFetch(() => [commonsResult("File:Tourist bus in Pokhara, Nepal.jpg")])
  );
  assert.deepEqual(images, []);
});

test("transport can use a licensed, clearly labeled category image when no local image exists", async () => {
  const images = await resolveRelevantImages(
    { name: "Jeep", type: "transport", location: "Pokhara, Nepal" },
    mockFetch((query) => query === "jeep"
      ? [commonsResult("File:Offroad Jeep 05760 2.jpg", "Offroad moving Jeep with splashed mud.")]
      : [])
  );
  assert.equal(images.length, 1);
  assert.match(images[0].sourcePage, /Offroad_Jeep/);
  assert.equal(images[0].relevance, "category");
});

test("vehicle mentions in plates or parking-location titles are not vehicle images", async () => {
  const unsuitable = [
    commonsResult("File:Nepal motorcycle plate (2000).jpg"),
    commonsResult("File:TOURIST BUS PARK POKHARA NEPAL FEB 2013.jpg"),
    commonsResult("File:POKHARA BUS STATION NEPAL FEB 2013.jpg"),
    commonsResult("File:Nepal License Plate - Private Car.png"),
  ];
  const cases = [
    { name: "Motorbike", location: "Pokhara, Nepal" },
    { name: "Tourist Bus", location: "Pokhara, Nepal" },
    { name: "Private Car", location: "Kathmandu, Nepal" },
  ];
  for (const entity of cases) {
    const images = await resolveRelevantImages(
      { ...entity, type: "transport" },
      mockFetch(() => unsuitable)
    );
    assert.deepEqual(images, [], `${entity.name} must not resolve to a plate or terminal photo`);
  }
});

test("incidental vehicle mentions in a street-scene title are not vehicle imagery", async () => {
  const images = await resolveRelevantImages(
    { name: "Bike Rental", type: "transport", location: "Kathmandu, Nepal" },
    mockFetch(() => [
      commonsResult(
        "File:Rain runoff and sewer, people step carefully, even motorcycle riders drive carefully in Boudha streets.jpg"
      ),
    ])
  );
  assert.deepEqual(images, []);
});

test("activity lookup does not fall back to an unrelated Nepal image", async () => {
  const images = await resolveRelevantImages(
    { name: "Paragliding", type: "activity", location: "Pokhara, Nepal" },
    mockFetch(() => [commonsResult("File:White water rafting in Nepal.jpg")])
  );
  assert.deepEqual(images, []);
});

test("entity lookup retries Wikimedia rate limits", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    if (requests === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => "0" },
      };
    }
    return {
      ok: true,
      json: async () => ({
        query: { pages: [commonsResult("File:Retry Village Nepal.jpg")] },
      }),
    };
  };
  const images = await resolveRelevantImages(
    { name: "Retry Village", type: "destination", location: "Nepal" },
    fetchImpl
  );
  assert.equal(requests, 2);
  assert.equal(images.length, 1);
});
