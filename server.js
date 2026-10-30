require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("node:path");
const connectDB = require("./config/db");
const getJwtSecret = require("./config/jwt");

const app = express();

app.use(cors());
app.use(express.json());
app.use(
  "/catalog-images",
  express.static(path.join(__dirname, "public", "catalog-images"), {
    maxAge: "1d",
    immutable: true,
  })
);

app.get("/", (req, res) => {
  res.json({
    message: "SuvYatra API is running",
    database: "MongoDB",
    version: "1.0.0"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "suvyatra-api" });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/users", require("./routes/users"));
app.use("/api/destinations", require("./routes/destinations"));
app.use("/api/locations", require("./routes/locations"));
app.use("/api/hotels", require("./routes/hotels"));
app.use("/api/restaurants", require("./routes/restaurants"));
app.use("/api/transports", require("./routes/transports"));
app.use("/api/places", require("./routes/places"));
app.use("/api/flights", require("./routes/flights"));
  app.use("/api/bookings", require("./routes/bookings"));
  app.use("/api/trip-checkout", require("./routes/tripCheckout"));
app.use("/api/saved-items", require("./routes/savedItems"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/trips", require("./routes/trips"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/support", require("./routes/support"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/images", require("./routes/images"));

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  try {
    getJwtSecret();
  } catch (err) {
    console.error("Authentication configuration failed:", err.message);
    process.exit(1);
  }

  connectDB()
    .then(async () => {
      try {
        const emailService = require("./services/emailService");
        const emailStatus = await emailService.verifyEmailConfig();
        if (emailStatus.ok) {
          console.log("Password-reset email (SMTP) is configured.");
        } else {
          console.warn(
            "Password-reset email is NOT configured. Set SMTP_* in .env (Gmail App Password). Forgot-password will return 503."
          );
        }
      } catch (err) {
        console.warn("Password-reset email check skipped:", err.message);
      }
      const googleIds = (require("./services/googleAuth").getAllowedAudiences() || []).length;
      if (googleIds > 0) {
        console.log(`Google Sign-In configured with ${googleIds} client ID(s).`);
      } else {
        console.warn(
          "Google Sign-In is NOT configured. Set GOOGLE_WEB_CLIENT_ID in .env. POST /api/auth/google will return 503."
        );
      }
      app.listen(PORT, () => {
        console.log(`SuvYatra API running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Database connection failed:", err.message);
      process.exit(1);
    });
}

module.exports = { app, connectDB };
