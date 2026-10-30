const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  userName: String,
  itemType: String,
  itemId: mongoose.Schema.Types.ObjectId,
  itemName: String,
  rating: { type: Number, min: 1, max: 5 },
  comment: String,
  isHidden: { type: Boolean, default: false, index: true }
}, { timestamps: true });

module.exports = mongoose.model("Review", reviewSchema);
