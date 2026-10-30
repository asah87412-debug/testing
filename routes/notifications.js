const express = require("express");
const router = express.Router();
const Model = require("../models/Notification");
const makeCrud = require("../controllers/crudFactory");

const crud = makeCrud(Model, { searchable: ["title", "message", "type"] });

router.get("/", crud.list);
router.get("/:id", crud.get);
router.post("/", crud.create);
router.put("/:id", crud.update);
router.delete("/:id", crud.remove);

module.exports = router;
