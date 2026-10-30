const express = require("express");
const router = express.Router();
const Model = require("../models/SavedItem");
const authMiddleware = require("../middleware/auth");
const mongoose = require("mongoose");
const { isReusableLicense } = require("../services/relevantImages");

router.use(authMiddleware);

function trustedImageAttributes(input) {
  const sourcePage = input?.imageSourcePage;
  const license = input?.imageLicense;
  const image = input?.image;
  if (
    input?.imageSource !== "Wikimedia Commons" ||
    typeof sourcePage !== "string" ||
    !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/i.test(sourcePage) ||
    typeof license !== "string" ||
    !isReusableLicense(license.trim()) ||
    typeof image !== "string" ||
    !/^https:\/\/(?:thumb\.wikimedia\.org|upload\.wikimedia\.org)\//i.test(image)
  ) {
    return {};
  }
  return {
    imageSource: "Wikimedia Commons",
    imageSourcePage: sourcePage,
    imageLicense: license.trim(),
    imageCredit: typeof input.imageCredit === "string" ? input.imageCredit.trim() : undefined,
    imageDescription: typeof input.imageDescription === "string" ? input.imageDescription.trim() : undefined,
    imageRelevance: input.imageRelevance === "category" ? "category" : "entity",
    images: [image],
  };
}

router.get("/", async (req, res) => {
  try {
    const filter = { userId: req.user._id };
    if (req.query.search) {
      const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = ["name", "location", "itemType"].map((field) => ({
        [field]: { $regex: escaped, $options: "i" },
      }));
    }
    return res.json(await Model.find(filter).sort({ createdAt: -1 }).lean());
  } catch (error) {
    console.error("Could not load saved places:", error);
    return res.status(500).json({ message: "Could not load saved places." });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid saved place reference." });
  }
  try {
    const item = await Model.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!item) return res.status(404).json({ message: "Saved place not found." });
    return res.json(item);
  } catch (error) {
    console.error("Could not load saved place:", error);
    return res.status(500).json({ message: "Could not load saved place." });
  }
});

router.post("/", async (req, res) => {
  try {
    const { itemType, itemId, name, location, image } = req.body || {};
    if (typeof itemType !== "string" || !itemType.trim() || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "A saved item type and name are required." });
    }
    if (itemId && !mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ message: "Invalid saved item reference." });
    }
    const item = await Model.create({
      userId: req.user._id,
      itemType: itemType.trim(),
      itemId,
      name: name.trim(),
      location: typeof location === "string" ? location.trim() : undefined,
      image: typeof image === "string" ? image.trim() : undefined,
      ...trustedImageAttributes(req.body),
    });
    return res.status(201).json(item);
  } catch (error) {
    console.error("Could not save place:", error);
    return res.status(500).json({ message: "Could not save place." });
  }
});

router.put("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid saved place reference." });
  }
  try {
    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        $set: {
          name: req.body.name,
          location: req.body.location,
          image: req.body.image,
          ...trustedImageAttributes(req.body),
        },
      },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: "Saved place not found." });
    return res.json(item);
  } catch (error) {
    console.error("Could not update saved place:", error);
    return res.status(500).json({ message: "Could not update saved place." });
  }
});

router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid saved place reference." });
  }
  try {
    const item = await Model.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!item) return res.status(404).json({ message: "Saved place not found." });
    return res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Could not delete saved place:", error);
    return res.status(500).json({ message: "Could not delete saved place." });
  }
});

module.exports = router;
