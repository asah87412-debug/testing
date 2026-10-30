const mongoose = require("mongoose");

const destinationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true },
  description: String,
  province: String,
  country: { type: String, default: "Nepal" },
  openingHours: { type: mongoose.Schema.Types.Mixed },
  image: String,
  images: [String],
  highlights: [String],
  tags: [String],
  // Generic visitor info for attractions & hidden gems (destination-agnostic).
  latitude: { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 },
  entryFee: String,
  estimatedDuration: String,
  bestTimeToVisit: String,
  approximateCost: String,
  whyVisit: String,
  safetyInfo: String,
  nearbyFacilities: [String],
  imageSource: String,
  imageSourcePage: String,
  imageLicense: String,
  imageCredit: String,
  imageDescription: String,
  imageRelevance: { type: String, enum: ["entity", "category"] }
}, { timestamps: true });

module.exports = mongoose.model("Destination", destinationSchema);
