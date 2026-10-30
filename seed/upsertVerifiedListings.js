const Restaurant = require("../models/Restaurant");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const definitions = require("./verifiedListings");
const imageSources = require("./listingImageSources");

const models = {
  restaurants: Restaurant,
  transports: Transport,
  places: LocalPlace,
};

function catalogKey(collection, item) {
  const slug = item.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `suvyatra:v1:${collection}:${item.module ? `${item.module}:` : ""}${slug}`;
}

function assetPath(key) {
  return `/catalog-images/${key.replace(/:/g, "-")}.png`;
}

function materializeListings(groups) {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const key = catalogKey(group.collection, item);
      const source = imageSources[key];
      const image = source?.uri ?? assetPath(key);
      const location = item.location ?? item.city ?? "Nepal";
      const imageDescription = source
        ? `${item.name}, ${location}: ${source.description}`
        : `${item.name}, ${location}: original ${item.module ?? item.type ?? group.collection.replace(/s$/, "")} category illustration; not a photograph of the named place or business.`;
      return {
        ...item,
        image,
        images: [image],
        imageSource: source?.source ?? "SuvYatra original illustration",
        imageSourcePage: source?.sourcePage ?? image,
        imageLicense: source?.license ?? "CC BY 4.0",
        imageCredit: source?.credit ?? "SuvYatra",
        imageDescription,
        imageRelevance: source?.relevance ?? (source ? "entity" : "category"),
        dataSource: item.dataSource ?? "SuvYatra curated directory",
      };
    }),
  }));
}

const listings = materializeListings(definitions);

function validateListings(groups) {
  const counts = new Map();
  const imageUrls = new Set();
  const keys = new Set();

  for (const group of groups) {
    if (!models[group.collection]) {
      throw new Error(`Unsupported verified listing collection "${group.collection}".`);
    }
    for (const item of group.items) {
      const category = group.collection === "places" ? item.module : group.collection;
      counts.set(category, (counts.get(category) ?? 0) + 1);
      const key = catalogKey(group.collection, item);
      if (keys.has(key)) throw new Error(`Duplicate verified listing key "${key}".`);
      keys.add(key);

      if (
        typeof item.image !== "string" ||
        !(/^https:\/\//i.test(item.image) || /^\/catalog-images\/[a-z0-9-]+\.png$/i.test(item.image)) ||
        !Array.isArray(item.images) ||
        item.images.length !== 1 ||
        item.images[0] !== item.image ||
        !item.imageSource ||
        !( /^https:\/\//i.test(item.imageSourcePage ?? "") ||
          (item.imageSource === "SuvYatra original illustration" && item.imageSourcePage === item.image) ) ||
        !item.imageLicense ||
        !item.imageCredit ||
        !item.imageDescription?.toLocaleLowerCase().includes(item.name.toLocaleLowerCase()) ||
        !["entity", "category"].includes(item.imageRelevance)
      ) {
        throw new Error(`Listing "${item.name}" is missing complete image and attribution metadata.`);
      }
      if (imageUrls.has(item.image)) {
        throw new Error(`Image URL is assigned to more than one listing: ${item.image}`);
      }
      imageUrls.add(item.image);
    }
  }

  const categories = ["restaurants", "transports", "activity", "shopping", "petrol", "hospital", "atm"];
  for (const category of categories) {
    if (counts.get(category) !== 8) {
      throw new Error(`Expected exactly 8 verified "${category}" listings; found ${counts.get(category) ?? 0}.`);
    }
  }
  if (keys.size !== 56) throw new Error(`Expected 56 unique verified listings; found ${keys.size}.`);

  return Object.fromEntries(counts);
}

function naturalMatch(collection, item) {
  if (collection === "restaurants") return { name: item.name, city: item.city };
  if (collection === "transports") return { name: item.name };
  return { name: item.name, module: item.module };
}

async function upsertVerifiedListings() {
  const counts = validateListings(listings);
  for (const group of listings) {
    const Model = models[group.collection];
    for (const item of group.items) {
      const document = {
        ...item,
        catalogKey: catalogKey(group.collection, item),
        isDemoData: false,
      };
      const existing = await Model.findOne({
        $or: [
          { catalogKey: document.catalogKey },
          naturalMatch(group.collection, item),
        ],
      }).sort({ isDemoData: 1, createdAt: 1 }).select("_id").lean();

      if (existing) {
        await Model.updateOne({ _id: existing._id }, { $set: document }, { runValidators: true });
      } else {
        await Model.create(document);
      }
    }
  }
  return counts;
}

upsertVerifiedListings.validateListings = validateListings;
upsertVerifiedListings.materializeListings = materializeListings;
module.exports = upsertVerifiedListings;
