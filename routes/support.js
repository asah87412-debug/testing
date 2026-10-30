const express = require("express");
const router = express.Router();
const Model = require("../models/SupportTicket");
const makeCrud = require("../controllers/crudFactory");
const adminAccessMiddleware = require("../middleware/adminAccess");

const crud = makeCrud(Model, { searchable: ["subject", "message", "status"] });

router.get("/", adminAccessMiddleware, crud.list);
router.get("/:id", adminAccessMiddleware, crud.get);
router.post("/", crud.create);
router.put("/:id", adminAccessMiddleware, crud.update);
router.delete("/:id", adminAccessMiddleware, crud.remove);

module.exports = router;
