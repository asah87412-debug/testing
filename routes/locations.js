const express = require("express");

const router = express.Router();

// Unified location search + validation for Destination AND Origin.
// Suggestions may substring-match; only selecting a real record validates.

router.get("/search", async (req, res) => {
  try {
    const { searchLocations } = require("../utils/tripValidation");
    const q = typeof req.query.q === "string" ? req.query.q : "";
    return res.json({ locations: await searchLocations(q, 8) });
  } catch (error) {
    console.error("Could not search locations:", error);
    return res.status(500).json({ message: "Could not search locations." });
  }
});

router.get("/validate", async (req, res) => {
  try {
    const { validateOriginInput } = require("../utils/tripValidation");
    const id = typeof req.query.id === "string" ? req.query.id : undefined;
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    const result = await validateOriginInput({ id, name });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json({ success: true, location: result.location });
  } catch (error) {
    console.error("Could not validate location:", error);
    return res.status(500).json({ success: false, code: "VALIDATION_FAILED", message: "Could not validate the location." });
  }
});

module.exports = router;
