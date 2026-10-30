const mongoose = require("mongoose");

const loginActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    status: {
      type: String,
      enum: ["successful"],
      default: "successful",
      required: true,
    },
    loginAt: { type: Date, default: Date.now, required: true, index: true },
  },
  { timestamps: true }
);

loginActivitySchema.index({ userId: 1, loginAt: -1 });

module.exports = mongoose.model("LoginActivity", loginActivitySchema);
