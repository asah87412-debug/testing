function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    secret === "replace-with-a-random-secret-at-least-32-characters-long" ||
    Buffer.byteLength(secret) < 32
  ) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  return secret;
}

module.exports = getJwtSecret;
