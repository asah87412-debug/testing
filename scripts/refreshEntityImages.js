require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Destination = require("../models/Destination");
const Hotel = require("../models/Hotel");
const Restaurant = require("../models/Restaurant");
const Transport = require("../models/Transport");
const LocalPlace = require("../models/LocalPlace");
const SavedItem = require("../models/SavedItem");
const { resolveRelevantImages } = require("../services/relevantImages");

const APPLY = process.argv.includes("--apply");
const TYPE_FILTER = process.argv.find((argument) => argument.startsWith("--type="))
  ?.slice("--type=".length)
  .toLowerCase();
const MODEL_TYPES = [
  [Destination, "destination"],
  [Hotel, "hotel"],
  [Restaurant, "restaurant"],
  [Transport, "transport"],
  [LocalPlace, null],
  [SavedItem, null],
];
const selectedModelTypes = TYPE_FILTER
  ? MODEL_TYPES.filter(([, type]) => type === TYPE_FILTER)
  : MODEL_TYPES;
const claimedImageUrls = new Map();
const claimedCategoryFamilies = new Map();
const CATEGORY_FAMILY_STOPWORDS = new Set([
  "atm",
  "bus",
  "cafe",
  "city",
  "and",
  "file",
  "hotel",
  "hotels",
  "hostel",
  "interior",
  "lobby",
  "lodge",
  "nepal",
  "of",
  "restaurant",
  "room",
  "resort",
  "view",
  ...[
    "bhaktapur", "chitwan", "dharan", "ilam", "kathmandu", "kaski",
    "khumbu", "lalitpur", "lumbini", "manang", "mustang", "pokhara",
  ],
]);

function imageIdentity(type, name) {
  return `${type}:${name.trim().toLocaleLowerCase().replace(/\s+/g, " ")}`;
}

function isUnrelatedUnsplashImage(record) {
  return [record.image, ...(record.images || [])].some(
    (uri) => typeof uri === "string" && /^https:\/\/images\.unsplash\.com\//i.test(uri)
  );
}

function categoryImageFamilies(image) {
  if (image.relevance !== "category" || !image.sourcePage) return [];
  const title = decodeURIComponent(image.sourcePage.split("/").pop() || "")
    .replace(/\.(jpe?g|png|webp|gif)$/i, "");
  const tokens = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  const identifyingTokens = tokens.filter((token) =>
    token.length > 2 &&
    !/^\d+$/.test(token) &&
    !CATEGORY_FAMILY_STOPWORDS.has(token)
  );
  return identifyingTokens.slice(0, -1).map((token, index) =>
    `${token} ${identifyingTokens[index + 1]}`
  );
}

async function refresh() {
  if (TYPE_FILTER && selectedModelTypes.length === 0) {
    throw new Error(`Unsupported entity type filter: ${TYPE_FILTER}`);
  }
  await connectDB();
  let updated = 0;
  let unchanged = 0;
  let unresolved = 0;

  for (const [Model, defaultType] of selectedModelTypes) {
    const records = await Model.find({}).select(
      "name type module itemType location address city district province destination image images imageSource imageSourcePage imageRelevance"
    );
    for (const record of records) {
      const recordType = defaultType || record.module || record.itemType || "destination";
      const type = recordType === "hidden-gem" ? "destination" : recordType;
      const identity = imageIdentity(type, record.name);
      const hasTrustedImage =
        record.imageSource === "Wikimedia Commons" &&
        (record.image || record.images?.length);
      const replaceUnrelatedUnsplash = isUnrelatedUnsplashImage(record);
      if (hasTrustedImage) {
        unchanged += 1;
        for (const uri of [record.image, ...(record.images || [])].filter(Boolean)) {
          claimedImageUrls.set(uri, identity);
        }
        const families = categoryImageFamilies({
          relevance: record.imageRelevance,
          sourcePage: record.imageSourcePage,
        });
        for (const family of families) claimedCategoryFamilies.set(family, identity);
        continue;
      }

      if ((record.image || record.images?.some(Boolean)) && !replaceUnrelatedUnsplash) {
        unchanged += 1;
        console.log(`Preserved existing unverified image for manual review: ${type} — ${record.name}`);
        continue;
      }

      const location = [
        record.location,
        record.address,
        record.city,
        record.district,
        record.province,
        record.destination,
      ].filter(Boolean).join(", ");
      let images;
      try {
        images = await resolveRelevantImages({
          name: record.name,
          type,
          location,
        });
      } catch (error) {
        unresolved += 1;
        console.error(`Image lookup failed for ${type} — ${record.name}:`, error);
        continue;
      }
      const image = images.find((candidate) => {
        const owner = claimedImageUrls.get(candidate.uri);
        const families = categoryImageFamilies(candidate);
        return (!owner || owner === identity) &&
          families.every((family) => {
            const familyOwner = claimedCategoryFamilies.get(family);
            return !familyOwner || familyOwner === identity;
          });
      });
      if (!image) {
        unresolved += 1;
        if (replaceUnrelatedUnsplash) {
          if (APPLY) {
            await Model.updateOne(
              { _id: record._id },
              {
                $unset: {
                  image: "",
                  images: "",
                  imageSource: "",
                  imageSourcePage: "",
                  imageLicense: "",
                  imageCredit: "",
                  imageDescription: "",
                  imageRelevance: "",
                },
              }
            );
          }
          console.log(`${APPLY ? "Removed" : "Would remove"} unrelated Unsplash image: ${type} — ${record.name}`);
        }
        console.log(`No distinct licensed match: ${type} — ${record.name}`);
        continue;
      }
      claimedImageUrls.set(image.uri, identity);
      const families = categoryImageFamilies(image);
      for (const family of families) claimedCategoryFamilies.set(family, identity);
      const update = {
        image: image.uri,
        images: [image.uri],
        imageSource: image.source,
        imageSourcePage: image.sourcePage,
        imageLicense: image.license,
        imageCredit: image.credit,
        imageDescription: image.description,
        imageRelevance: image.relevance,
      };
      if (APPLY) {
        await Model.updateOne({ _id: record._id }, { $set: update });
      }
      updated += 1;
      const action = replaceUnrelatedUnsplash
        ? `${APPLY ? "Replaced" : "Would replace"} unrelated Unsplash image`
        : `${APPLY ? "Updated" : "Would update"} image`;
      console.log(`${action}: ${type} — ${record.name} @ ${location || "location not provided"} (${image.relevance}; ${image.license}; ${image.sourcePage})`);
    }
  }

  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", updated, unchanged, unresolved }));
}

refresh()
  .catch((error) => {
    console.error("Image data refresh failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
