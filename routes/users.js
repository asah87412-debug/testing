const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");

router.use(authMiddleware);

router.get("/", adminMiddleware, async (req, res) => {
	try {
		const users = await User.find().select("-password").sort({ createdAt: -1 }).limit(200).lean();
		res.json(users);
	} catch (error) {
		res.status(500).json({ message: "Could not load users." });
	}
});

router.get("/:id", async (req, res) => {
	if (req.user.role !== "admin" && req.user._id.toString() !== req.params.id) {
		return res.status(403).json({ message: "You can only view your own account." });
	}
	try {
		const user = await User.findById(req.params.id).select("-password").lean();
		if (!user) return res.status(404).json({ message: "User not found." });
		res.json(user);
	} catch (error) {
		res.status(400).json({ message: "Invalid user reference." });
	}
});

router.put("/:id", async (req, res) => {
	if (req.user.role !== "admin" && req.user._id.toString() !== req.params.id) {
		return res.status(403).json({ message: "You can only update your own account." });
	}

	if (Object.hasOwn(req.body, "email")) {
		return res.status(400).json({ message: "Email changes require a verified email flow." });
	}

	const updates = {};
	for (const field of ["name", "phone", "location", "bio", "avatar"]) {
		if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
	}
	if (typeof updates.name === "string") {
		updates.name = updates.name.trim().replace(/\s+/g, " ");
		if (!/^[\p{L}\p{M}]+(?:[ '\u2019.-][\p{L}\p{M}]+)*$/u.test(updates.name)) {
			return res.status(400).json({ message: "Please enter a valid name." });
		}
	}
	if (Object.hasOwn(updates, "phone")) {
		updates.phone = typeof updates.phone === "string"
			? updates.phone.trim().replace(/[\s()-]/g, "")
			: "";
		if (updates.phone && !/^\+?\d{7,15}$/.test(updates.phone)) {
			return res.status(400).json({ message: "Please enter a valid phone number." });
		}
		if (!updates.phone) updates.phone = undefined;
	}
	for (const [field, maxLength] of [["location", 120], ["bio", 500], ["avatar", 2000]]) {
		if (Object.hasOwn(updates, field) &&
			(typeof updates[field] !== "string" || updates[field].length > maxLength)) {
			return res.status(400).json({ message: `Please enter a valid ${field}.` });
		}
	}

	try {
		const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, {
			new: true,
			runValidators: true,
		}).select("-password");
		if (!user) return res.status(404).json({ message: "User not found." });
		res.json({ user });
	} catch (error) {
		res.status(400).json({ message: "Could not update profile." });
	}
});

router.delete("/:id", adminMiddleware, async (req, res) => {
	try {
		const user = await User.findByIdAndDelete(req.params.id);
		if (!user) return res.status(404).json({ message: "User not found." });
		res.json({ message: "User deleted." });
	} catch (error) {
		res.status(400).json({ message: "Could not delete user." });
	}
});

module.exports = router;
