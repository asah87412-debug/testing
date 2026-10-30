const mongoose = require("mongoose");

const savedItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  itemType: String,
  itemId: mongoose.Schema.Types.ObjectId,
  name: String,
  location: String,
  image: String,
  images: [String],
  imageSource: String,
  imageSourcePage: String,
  imageLicense: String,
  imageCredit: String,
  imageDescription: String,
  imageRelevance: { type: String, enum: ["entity", "category"] }
}, { timestamps: true });

module.exports = mongoose.model("SavedItem", savedItemSchema);
