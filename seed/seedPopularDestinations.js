require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Destination = require("../models/Destination");
const destinations = require("./popularDestinations");
const { resolveRelevantImages } = require("../services/relevantImages");

async function seedPopularDestinations() {
  await connectDB();
  for (const destination of destinations) {
    const { tags, ...destinationFields } = destination;
    const location = `${destination.province}, Nepal`;
    const images = await resolveRelevantImages({
      name: destination.name,
      type: "destination",
      location,
    });
    const image = images[0];
    if (!image) {
      throw new Error(`No licensed, relevant image was found for ${destination.name}.`);
    }

    await Destination.updateOne(
      { slug: destination.slug },
      {
        $setOnInsert: {
          ...destinationFields,
          country: "Nepal",
          image: image.uri,
          images: [image.uri],
          imageSource: image.source,
          imageSourcePage: image.sourcePage,
          imageLicense: image.license,
          imageCredit: image.credit,
          imageDescription: image.description,
          imageRelevance: image.relevance,
        },
        $addToSet: { tags: { $each: tags } },
      },
      { upsert: true }
    );

    const stored = await Destination.findOne({ slug: destination.slug }).lean();
    if (!stored.image || !stored.imageSource || !stored.imageSourcePage || !stored.imageLicense) {
      await Destination.updateOne(
        { _id: stored._id },
        {
          $set: {
            image: image.uri,
            images: [image.uri],
            imageSource: image.source,
            imageSourcePage: image.sourcePage,
            imageLicense: image.license,
            imageCredit: image.credit,
            imageDescription: image.description,
            imageRelevance: image.relevance,
          },
        }
      );
    }
  }

  const popularCount = await Destination.countDocuments({ tags: /^popular$/i });
  console.log(`Popular destinations are ready (${popularCount} tagged records).`);
}

seedPopularDestinations()
  .catch((error) => {
    console.error("Could not seed popular destinations:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
