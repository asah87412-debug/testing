const { OAuth2Client } = require("google-auth-library");

let cachedClient = null;

function getAllowedAudiences() {
  return [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

function getGoogleClient() {
  if (!cachedClient) {
    cachedClient = new OAuth2Client();
  }
  return cachedClient;
}

/**
 * Verifies a Google ID token and returns the essential profile.
 * Throws an error with `code` = GOOGLE_* on failure.
 */
async function verifyGoogleIdToken(idToken) {
  const audiences = getAllowedAudiences();
  if (audiences.length === 0) {
    const error = new Error(
      "Google Sign-In is not configured. Set GOOGLE_WEB_CLIENT_ID on the server."
    );
    error.code = "GOOGLE_NOT_CONFIGURED";
    throw error;
  }
  if (typeof idToken !== "string" || !idToken) {
    const error = new Error("A Google sign-in token is required.");
    error.code = "GOOGLE_TOKEN_REQUIRED";
    throw error;
  }

  let payload;
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken,
      audience: audiences,
    });
    payload = ticket.getPayload();
  } catch {
    const error = new Error("Could not verify your Google sign-in. Please try again.");
    error.code = "GOOGLE_TOKEN_INVALID";
    throw error;
  }

  const issuer = payload?.iss || "";
  if (issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") {
    const error = new Error("Could not verify your Google sign-in. Please try again.");
    error.code = "GOOGLE_TOKEN_INVALID";
    throw error;
  }

  const googleId = payload?.sub;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!googleId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Google did not return a valid account. Please try again.");
    error.code = "GOOGLE_TOKEN_INVALID";
    throw error;
  }

  // Only link verified Google emails to existing accounts.
  if (payload?.email_verified !== true) {
    const error = new Error("Your Google email is not verified. Verify it with Google and try again.");
    error.code = "GOOGLE_EMAIL_UNVERIFIED";
    throw error;
  }

  return {
    googleId,
    email,
    name: typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim() : email.split("@")[0],
    avatar: typeof payload?.picture === "string" ? payload.picture : "",
  };
}

module.exports = { verifyGoogleIdToken, getAllowedAudiences };
