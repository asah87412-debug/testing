const express = require("express");
const router = express.Router();
const ChatSession = require("../models/ChatSession");
const ChatMessage = require("../models/ChatMessage");

router.get("/sessions", async (req, res) => {
  try {
    const filter = req.query.userId ? { userId: req.query.userId } : {};
    const sessions = await ChatSession.find(filter).sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/sessions", async (req, res) => {
  try {
    const session = await ChatSession.create(req.body);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const message = await ChatMessage.create({
      sessionId: req.params.sessionId,
      role: req.body.role,
      content: req.body.content
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
