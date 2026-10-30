const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true },
  location: { type: String, trim: true },
  address: { type: String, trim: true },
  city: { type: String, trim: true },
  district: { type: String, trim: true },
  province: { type: String, trim: true },
  destination: { type: String, trim: true },
  cuisine: [String],
  foodTypes: [String],
  mealTimes: [String],
  facilities: [String],
  description: String,
  image: String,
  images: [String],
  imageSource: String,
  imageSourcePage: String,
  imageLicense: String,
  imageCredit: String,
  imageDescription: String,
  imageRelevance: { type: String, enum: ["entity", "category"] },
  catalogKey: { type: String, unique: true, sparse: true },
  dataSource: String,
  dataSourceUrl: String,
  menuUrl: String,
  priceRange: String,
  priceLevel: { type: Number, min: 1, max: 4 },
  rating: { type: Number, min: 0, max: 5 },
  reviewCount: { type: Number, min: 0 },
  openingHours: { type: mongoose.Schema.Types.Mixed },
  // Physical tables for reservation inventory (destination-agnostic).
  // Each entry is one table: { label: "T1", seats: 4 }.
  tables: [{
    label: { type: String, required: true, trim: true, maxlength: 20 },
    seats: { type: Number, required: true, min: 1, max: 20 },
  }],
  reservationPolicy: String,
  contact: {
    phone: String,
    website: String,
  },
  nearbyAttractions: [String],
  latitude: { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 },
  isDemoData: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model("Restaurant", restaurantSchema);
