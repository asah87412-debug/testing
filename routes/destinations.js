const express = require("express");
const router = express.Router();
const Model = require("../models/Destination");
const makeCrud = require("../controllers/crudFactory");
const adminAccessMiddleware = require("../middleware/adminAccess");

const crud = makeCrud(Model, { searchable: ["name", "province", "country"] });

router.get("/", async (req, res) => {
  try {
    const filter = {};
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = ["name", "province", "country", "description", "tags"].map((field) => ({ [field]: expression }));
    }
    if (["popular", "hidden"].includes(req.query.featured)) {
      const tag = new RegExp(`^${req.query.featured}$`, "i");
      filter.tags = req.query.featured === "popular" ? { $not: /^hidden$/i } : tag;
    }
    const records = await Model.find(filter).sort({ createdAt: -1, name: 1 }).lean();
    // Rank exact name matches first so typing "Pokhara" surfaces Pokhara
    // instead of burying it under description matches.
    if (search) {
      const lowered = search.toLowerCase();
      const rank = (name) => {
        const n = String(name || "").toLowerCase();
        if (n === lowered) return 0;
        if (n.startsWith(lowered)) return 1;
        return 2;
      };
      records.sort((a, b) => rank(a.name) - rank(b.name));
    }
    return res.json(records);
  } catch (error) {
    console.error("Could not load destinations:", error);
    return res.status(500).json({ message: "Could not load destinations." });
  }
});
router.get("/validate", async (req, res) => {
  try {
    const { validateDestinationInput } = require("../utils/tripValidation");
    const result = await validateDestinationInput(req.query.name);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json({ success: true, destination: result.destination });
  } catch (error) {
    console.error("Could not validate destination:", error);
    return res.status(500).json({ success: false, code: "VALIDATION_FAILED", message: "Could not validate the destination." });
  }
});
router.get("/:id", crud.get);
router.post("/", adminAccessMiddleware, crud.create);
router.put("/:id", adminAccessMiddleware, crud.update);
router.delete("/:id", adminAccessMiddleware, crud.remove);

module.exports = router;
