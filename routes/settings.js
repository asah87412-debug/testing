const express = require("express");
const router = express.Router();
const Model = require("../models/Setting");
const makeCrud = require("../controllers/crudFactory");

const crud = makeCrud(Model, { searchable: ["language", "currency"] });

router.get("/", crud.list);
router.get("/:id", crud.get);
router.post("/", crud.create);
router.put("/:id", crud.update);
router.delete("/:id", crud.remove);

module.exports = router;
