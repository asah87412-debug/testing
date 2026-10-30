const express = require("express");
const router = express.Router();
const Model = require("../models/Review");
const makeCrud = require("../controllers/crudFactory");
const adminAccessMiddleware = require("../middleware/adminAccess");

const crud = makeCrud(Model, { searchable: ["userName", "itemName", "comment"] });

router.get("/", async (req, res) => {
  try {
    const filter = { isHidden: { $ne: true } };
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const expression = new RegExp(req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = ["userName", "itemName", "comment"].map((field) => ({ [field]: expression }));
    }
    if (req.query.userId) filter.userId = req.query.userId;
    return res.json(await Model.find(filter).sort({ createdAt: -1 }));
  } catch (error) {
    console.error("Could not load reviews:", error);
    return res.status(500).json({ message: "Could not load reviews." });
  }
});
router.get("/:id", async (req, res) => {
  try {
    const review = await Model.findOne({ _id: req.params.id, isHidden: { $ne: true } });
    if (!review) return res.status(404).json({ message: "Review not found." });
    return res.json(review);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});
router.post("/", adminAccessMiddleware, crud.create);
router.put("/:id", adminAccessMiddleware, crud.update);
router.delete("/:id", adminAccessMiddleware, crud.remove);

module.exports = router;
