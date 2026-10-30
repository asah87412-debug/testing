require("dotenv").config();
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const User = require("../models/User");

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@gmail.com").trim().toLowerCase();
// Password MUST NOT be hardcoded in frontend. Backend-only seeding via env with safe default for local/demo.
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD || "433CC389742MP/";

async function seedAdmin() {
  await connectDB();
  const existing = await User.findOne({ email: ADMIN_EMAIL })
    .collation({ locale: "en", strength: 2 })
    .select("+password");

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  if (existing) {
    // Update in place (bypass strong-password validator — admin secret is operator-provided).
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: existing.name || "Administrator",
          email: ADMIN_EMAIL,
          password: passwordHash,
          role: "admin",
          status: "active",
          provider: "Email",
          emailVerified: true,
        },
      },
      { runValidators: false }
    );
    console.log(`Admin account verified: ${ADMIN_EMAIL} (role=admin, no duplicate created)`);
  } else {
    await User.updateOne(
      { email: ADMIN_EMAIL },
      {
        $setOnInsert: {
          name: "Administrator",
          email: ADMIN_EMAIL,
          password: passwordHash,
          provider: "Email",
          emailVerified: true,
        },
        $set: { role: "admin", status: "active" },
      },
      { upsert: true, runValidators: false }
    );
    console.log(`Admin account created: ${ADMIN_EMAIL} (role=admin)`);
  }
  await require("mongoose").disconnect();
}

if (require.main === module) {
  seedAdmin().catch((err) => {
    console.error("Admin seeding failed:", err);
    process.exit(1);
  });
}

module.exports = seedAdmin;
