const mongoose = require("mongoose");

const flightSchema = new mongoose.Schema({
  airline: String,
  flightNumber: String,
  from: String,
  to: String,
  departure: Date,
  arrival: Date,
  price: Number,
  currency: { type: String, default: "NPR" },
  seatsAvailable: Number
}, { timestamps: true });

module.exports = mongoose.model("Flight", flightSchema);
