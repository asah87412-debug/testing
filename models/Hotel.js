const mongoose = require("mongoose");

const roomTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  capacityAdults: { type: Number, required: true, min: 1, max: 12 },
  capacityChildren: { type: Number, required: true, min: 0, max: 12 },
  totalRooms: { type: Number, required: true, min: 0, max: 10000 },
  nightlyRate: { type: Number, min: 0, max: 10000000 },
  bedConfiguration: { type: String, trim: true, maxlength: 100 },
  breakfastIncluded: { type: Boolean, default: false },
  amenities: [String],
  images: [String],
  cancellationPolicy: { type: String, trim: true, maxlength: 500 },
});

const hotelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: String,
  city: String,
  district: String,
  province: String,
  destination: String,
  description: String,
  image: String,
  images: [String],
  imageSource: String,
  imageSourcePage: String,
  imageLicense: String,
  imageCredit: String,
  imageDescription: String,
  imageRelevance: { type: String, enum: ["entity", "category"] },
  pricePerNight: Number,
  rating: Number,
  reviewCount: Number,
  amenities: [String],
  roomTypes: { type: [roomTypeSchema], default: [] },
  propertyTypes: [String],
  travelerTypes: [String],
  specialFeatures: [String],
  latitude: Number,
  longitude: Number,
  policies: [String],
  checkInTime: String,
  checkOutTime: String,
  cancellationPolicy: String,
  contact: {
    phone: String,
    email: String,
    website: String,
  },
  nearbyAttractions: [String],
  availabilityProvider: String,
  isDemoData: { type: Boolean, default: true, index: true },
  available: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("Hotel", hotelSchema);
