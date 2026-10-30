const express = require("express");
const { resolveRelevantImages } = require("../services/relevantImages");

const router = express.Router();
const ALLOWED_TYPES = new Set([
  "activity",
  "atm",
  "country",
  "destination",
  "hospital",
  "hotel",
  "petrol",
  "restaurant",
  "shopping",
  "transport",
]);

router.get("/resolve", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim().toLowerCase() : "";
  const location = typeof req.query.location === "string" ? req.query.location.trim() : "";
  if (!name || name.length > 160 || !ALLOWED_TYPES.has(type) || location.length > 240) {
    return res.status(400).json({ message: "Provide a valid entity name, type, and location." });
  }
  try {
    const images = await resolveRelevantImages({ name, type, location });
    return res.json({ images });
  } catch (error) {
    console.error("Could not resolve a relevant licensed image:", error);
    return res.status(502).json({ message: "Could not resolve a relevant image from Wikimedia Commons." });
  }
});

module.exports = router;
