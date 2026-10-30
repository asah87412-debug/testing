const jwt = require("jsonwebtoken");
const authMiddleware = require("./auth");
const adminMiddleware = require("./admin");
const getJwtSecret = require("../config/jwt");

const ADMIN_TOKEN_TYPE = "suvyatra-admin";

function adminAccessMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token) {
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      if (decoded?.tokenType === ADMIN_TOKEN_TYPE) {
        if (decoded.sub !== ADMIN_TOKEN_TYPE || decoded.role !== "admin") {
          return res.status(401).json({ message: "Invalid or expired administrator session." });
        }
        req.admin = { email: process.env.ADMIN_EMAIL?.trim().toLowerCase() || "" };
        return next();
      }
    } catch {
      return authMiddleware(req, res, () => adminMiddleware(req, res, next));
    }
  }
  return authMiddleware(req, res, () => adminMiddleware(req, res, next));
}

module.exports = adminAccessMiddleware;
