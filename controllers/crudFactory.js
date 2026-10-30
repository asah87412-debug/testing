function makeCrud(Model, options = {}) {
  const searchable = options.searchable || ["name", "title", "city", "location"];

  return {
    list: async (req, res) => {
      try {
        const filter = {};
        if (req.query.search) {
          const q = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          filter.$or = searchable.map(field => ({ [field]: { $regex: q, $options: "i" } }));
        }
        if (req.query.userId) filter.userId = req.query.userId;
        const docs = await Model.find(filter).sort({ createdAt: -1 });
        res.json(docs);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    },
    get: async (req, res) => {
      try {
        const doc = await Model.findById(req.params.id);
        if (!doc) return res.status(404).json({ message: "Not found" });
        res.json(doc);
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    },
    create: async (req, res) => {
      try {
        const doc = await Model.create(req.body);
        res.status(201).json(doc);
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    },
    update: async (req, res) => {
      try {
        const doc = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!doc) return res.status(404).json({ message: "Not found" });
        res.json(doc);
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    },
    remove: async (req, res) => {
      try {
        const doc = await Model.findByIdAndDelete(req.params.id);
        if (!doc) return res.status(404).json({ message: "Not found" });
        res.json({ message: "Deleted successfully" });
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    }
  };
}

module.exports = makeCrud;
