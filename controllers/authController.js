const bcrypt = require("bcryptjs");
const { createHmac, randomInt, timingSafeEqual } = require("node:crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const LoginActivity = require("../models/LoginActivity");
const getJwtSecret = require("../config/jwt");
const emailService = require("../services/emailService");
const { verifyGoogleIdToken } = require("../services/googleAuth");

const NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;
const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character.";
const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_MAX_ATTEMPTS = 5;
// Registration (signup) email-verification OTP: same policy as password reset.
const REGISTER_OTP_TTL_MS = 10 * 60 * 1000;
const REGISTER_OTP_MAX_ATTEMPTS = 5;
const REGISTER_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_REQUEST_MAX = 5;
const registerRequestLog = new Map();

function isRegisterRateLimited(key) {
  const now = Date.now();
  const entries = (registerRequestLog.get(key) || []).filter((t) => now - t < REGISTER_REQUEST_WINDOW_MS);
  entries.push(now);
  registerRequestLog.set(key, entries);
  return entries.length > REGISTER_REQUEST_MAX;
}
// Simple in-memory rate limit for OTP requests: max 5 requests per 15 min per email+IP.
const RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const RESET_REQUEST_MAX = 5;
const resetRequestLog = new Map();

function isResetRateLimited(key) {
  const now = Date.now();
  const entries = (resetRequestLog.get(key) || []).filter((t) => now - t < RESET_REQUEST_WINDOW_MS);
  entries.push(now);
  resetRequestLog.set(key, entries);
  return entries.length > RESET_REQUEST_MAX;
}
const RESET_OTP_FIELDS = {
  emailVerified: 1,
  passwordResetOtpHash: 1,
  passwordResetExpiresAt: 1,
  passwordResetAttempts: 1,
};

function hashResetOtp(email, otp) {
  return createHmac("sha256", getJwtSecret())
    .update(`${email}:${otp}`)
    .digest("hex");
}

function resetOtpMatches(email, otp, expectedHash) {
  const actualHash = Buffer.from(hashResetOtp(email, otp), "hex");
  const storedHash = Buffer.from(expectedHash || "", "hex");
  return actualHash.length === storedHash.length && timingSafeEqual(actualHash, storedHash);
}

function clearResetOtp(userId, otpHash) {
  return User.updateOne(
    { _id: userId, passwordResetOtpHash: otpHash },
    {
      $unset: {
        passwordResetOtpHash: 1,
        passwordResetExpiresAt: 1,
      },
      $set: { passwordResetAttempts: 0 },
    }
  );
}

function hashRegisterOtp(email, otp) {
  return createHmac("sha256", getJwtSecret())
    .update(`register:${email}:${otp}`)
    .digest("hex");
}

function registerOtpMatches(email, otp, expectedHash) {
  const actualHash = Buffer.from(hashRegisterOtp(email, otp), "hex");
  const storedHash = Buffer.from(expectedHash || "", "hex");
  return actualHash.length === storedHash.length && timingSafeEqual(actualHash, storedHash);
}

function clearRegisterOtp(userId, otpHash) {
  return User.updateOne(
    { _id: userId, emailVerificationOtpHash: otpHash },
    {
      $unset: {
        emailVerificationOtpHash: 1,
        emailVerificationExpiresAt: 1,
      },
      $set: { emailVerificationAttempts: 0 },
    }
  );
}

async function findRegisterUser(email) {
  return User.findOne({ email })
    .collation({ locale: "en", strength: 2 })
    .select("+emailVerificationOtpHash +emailVerificationExpiresAt +emailVerificationAttempts +password");
}

async function invalidRegisterOtpResponse(res, user, email, otp) {
  if (!user?.emailVerificationOtpHash || !user.emailVerificationExpiresAt) {
    return res.status(400).json({
      code: "REGISTER_OTP_INVALID",
      message: "This verification code is invalid. Please request a new one.",
    });
  }

  if (user.emailVerificationExpiresAt <= new Date()) {
    await clearRegisterOtp(user._id, user.emailVerificationOtpHash);
    return res.status(400).json({
      code: "REGISTER_OTP_EXPIRED",
      message: "This verification code has expired. Please request a new one.",
    });
  }

  if (user.emailVerificationAttempts >= REGISTER_OTP_MAX_ATTEMPTS) {
    await clearRegisterOtp(user._id, user.emailVerificationOtpHash);
    return res.status(429).json({
      code: "REGISTER_OTP_ATTEMPTS_EXCEEDED",
      message: "Too many incorrect codes. Please request a new verification code.",
    });
  }

  if (!registerOtpMatches(email, otp, user.emailVerificationOtpHash)) {
    const attempts = user.emailVerificationAttempts + 1;
    if (attempts >= REGISTER_OTP_MAX_ATTEMPTS) {
      await clearRegisterOtp(user._id, user.emailVerificationOtpHash);
      return res.status(429).json({
        code: "REGISTER_OTP_ATTEMPTS_EXCEEDED",
        message: "Too many incorrect codes. Please request a new verification code.",
      });
    }

    await User.updateOne(
      {
        _id: user._id,
        emailVerificationOtpHash: user.emailVerificationOtpHash,
        emailVerificationExpiresAt: { $gt: new Date() },
        emailVerificationAttempts: { $lt: REGISTER_OTP_MAX_ATTEMPTS },
      },
      { $inc: { emailVerificationAttempts: 1 } }
    );
    return res.status(400).json({
      code: "REGISTER_OTP_INVALID",
      message: "This verification code is invalid. Please try again.",
    });
  }

  return null;
}

async function findResetUser(email) {
  return User.findOne({ email })
    .collation({ locale: "en", strength: 2 })
    .select(Object.keys(RESET_OTP_FIELDS).map((field) => `+${field}`).join(" "));
}

async function invalidResetOtpResponse(res, user, email, otp) {
  if (!user?.passwordResetOtpHash || !user.passwordResetExpiresAt) {
    return res.status(400).json({
      code: "RESET_OTP_INVALID",
      message: "This reset code is invalid. Please request a new one.",
    });
  }

  if (user.passwordResetExpiresAt <= new Date()) {
    await clearResetOtp(user._id, user.passwordResetOtpHash);
    return res.status(400).json({
      code: "RESET_OTP_EXPIRED",
      message: "This reset code has expired. Please request a new one.",
    });
  }

  if (user.passwordResetAttempts >= RESET_OTP_MAX_ATTEMPTS) {
    await clearResetOtp(user._id, user.passwordResetOtpHash);
    return res.status(429).json({
      code: "RESET_OTP_ATTEMPTS_EXCEEDED",
      message: "Too many incorrect codes. Please request a new reset code.",
    });
  }

  if (!resetOtpMatches(email, otp, user.passwordResetOtpHash)) {
    const attempts = user.passwordResetAttempts + 1;
    if (attempts >= RESET_OTP_MAX_ATTEMPTS) {
      await clearResetOtp(user._id, user.passwordResetOtpHash);
      return res.status(429).json({
        code: "RESET_OTP_ATTEMPTS_EXCEEDED",
        message: "Too many incorrect codes. Please request a new reset code.",
      });
    }

    await User.updateOne(
      {
        _id: user._id,
        passwordResetOtpHash: user.passwordResetOtpHash,
        passwordResetExpiresAt: { $gt: new Date() },
        passwordResetAttempts: { $lt: RESET_OTP_MAX_ATTEMPTS },
      },
      { $inc: { passwordResetAttempts: 1 } }
    );
    return res.status(400).json({
      code: "RESET_OTP_INVALID",
      message: "This reset code is invalid. Please try again.",
    });
  }

  return null;
}

function signToken(user) {
  return jwt.sign({ id: user._id }, getJwtSecret(), {
    expiresIn: "7d",
  });
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePhone(value) {
  return typeof value === "string" ? value.trim().replace(/[\s()-]/g, "") : "";
}

function normalizeAppleId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isStrongPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function isPhone(value) {
  return /^[+]?\d[\d\s()+-]{6,}$/.test(value || "");
}

function getProviderIdentity(rawEmail, rawPhone, rawAppleId, provider) {
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  const appleId = normalizeAppleId(rawAppleId);

  if (provider === "Apple") {
    const appleInput = appleId || email || phone;
    return {
      email: email && isEmail(email) ? email : "",
      phone: phone || "",
      appleId: appleInput || "",
    };
  }

  if (provider === "Google" || provider === "Facebook") {
    const directPhone = phone || (email && isPhone(email) ? email : "");
    const directEmail = email && isEmail(email) ? email : "";
    return {
      email: directEmail,
      phone: directPhone,
      appleId: appleId || "",
    };
  }

  return {
    email,
    phone,
    appleId,
  };
}

function buildUserLookup(values) {
  const lookup = values
    .filter(Boolean)
    .map((value) => ({
      $or: [
        { email: value },
        { phone: value },
        { appleId: value },
      ],
    }));

  return lookup.length ? { $or: lookup.flatMap((item) => item.$or) } : {};
}

function findUserByIdentity(values) {
  return User.findOne(buildUserLookup(values)).collation({
    locale: "en",
    strength: 2,
  });
}

async function sendRegisterOtpForEmail(res, { name, email, password, location, bio, avatar, rateKey }) {
  if (isRegisterRateLimited(`${email}:${rateKey}`)) {
    return res.status(429).json({
      code: "REGISTER_REQUEST_RATE_LIMITED",
      message: "Too many verification requests. Please wait 15 minutes and try again.",
    });
  }

  // A verified account with this Gmail already exists → log in instead.
  const existing = await User.findOne({ email }).collation({ locale: "en", strength: 2 });
  if (existing && existing.emailVerified) {
    return res.status(409).json({ message: "User with this account already exists" });
  }

  const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const otpHash = hashRegisterOtp(email, otp);

  if (existing) {
    // Unverified retry: refresh details + issue a fresh OTP.
    existing.name = name;
    existing.password = password;
    if (location !== undefined) existing.location = location;
    if (bio !== undefined) existing.bio = bio;
    if (avatar !== undefined) existing.avatar = avatar;
    existing.emailVerificationOtpHash = otpHash;
    existing.emailVerificationExpiresAt = new Date(Date.now() + REGISTER_OTP_TTL_MS);
    existing.emailVerificationAttempts = 0;
    existing.emailVerificationRequestedAt = new Date();
    await existing.save();
  } else {
    await User.create({
      name,
      email,
      password,
      location,
      bio,
      avatar,
      provider: "Email",
      emailVerified: false,
      emailVerificationOtpHash: otpHash,
      emailVerificationExpiresAt: new Date(Date.now() + REGISTER_OTP_TTL_MS),
      emailVerificationAttempts: 0,
      emailVerificationRequestedAt: new Date(),
    });
  }

  try {
    await emailService.sendRegistrationOtp(email, otp);
  } catch (error) {
    if (error.code === "EMAIL_NOT_CONFIGURED") {
      return res.status(503).json({
        code: "EMAIL_NOT_CONFIGURED",
        message: "Verification email is not configured. Please contact support.",
      });
    }
    console.error("Registration email delivery failed.");
    return res.status(502).json({
      code: "EMAIL_DELIVERY_FAILED",
      message: "Could not send the verification email. Please try again later.",
    });
  }

  return res.status(201).json({
    code: "REGISTER_OTP_SENT",
    message: "A verification code has been sent to your Gmail. It expires in 10 minutes.",
    email,
    needsVerification: true,
  });
}

async function registerUser(req, res) {
  try {
    const {
      name: rawName,      email,
      password,
      phone,
      appleId,
      location,
      bio,
      avatar,
      provider,
    } = req.body || {};
    const name = normalizeName(rawName);

    if (!name || !NAME_PATTERN.test(name)) {
      return res.status(400).json({ message: "Please enter a valid name." });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
    }

    const normalizedProvider = ["Email", "Google", "Facebook", "Apple", "Demo"].includes(provider)
      ? provider
      : "Email";

    const { email: normalizedEmail, phone: normalizedPhone, appleId: normalizedAppleId } = getProviderIdentity(
      email,
      phone,
      appleId,
      normalizedProvider
    );

    const identityExists = [normalizedEmail, normalizedPhone, normalizedAppleId].some(Boolean);
    if (!identityExists && normalizedProvider !== "Email") {
      return res.status(400).json({ message: "Phone number, email, or Apple ID is required" });
    }

    if (normalizedProvider === "Email" && !normalizedEmail) {
      return res.status(400).json({
        message: email ? "Please enter a valid email address." : "Email is required.",
      });
    }

    if (normalizedProvider === "Apple" && !normalizedAppleId) {
      return res.status(400).json({ message: "Apple ID is required" });
    }

    if (["Google", "Facebook"].includes(normalizedProvider) && !normalizedEmail && !normalizedPhone) {
      return res.status(400).json({ message: "Email or phone number is required" });
    }

    if (normalizedEmail && !isEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    if (normalizedPhone && !isPhone(normalizedPhone)) {
      return res.status(400).json({ message: "Please enter a valid phone number" });
    }

    if (normalizedAppleId && !normalizedAppleId.includes("@") && !/^[a-z0-9._-]+$/i.test(normalizedAppleId)) {
      return res.status(400).json({ message: "Please enter a valid Apple ID" });
    }

    const existingUser = await findUserByIdentity([
      normalizedEmail,
      normalizedPhone,
      normalizedAppleId,
    ]);

    if (existingUser) {
      return res.status(409).json({ message: "User with this account already exists" });
    }

    // Email signups must verify the Gmail inbox with a 6-digit OTP
    // before the account becomes active. Other providers skip this.
    if (normalizedProvider === "Email" && normalizedEmail) {
      return sendRegisterOtpForEmail(res, {
        name,
        email: normalizedEmail,
        password,
        location,
        bio,
        avatar,
        rateKey: req.ip || "unknown",
      });
    }

    const user = await User.create({
      name,
      email: normalizedEmail || undefined,
      password,
      phone: normalizedPhone || undefined,
      appleId: normalizedAppleId || undefined,
      location,
      bio,
      avatar,
      provider: normalizedProvider,
      emailVerified: true,
    });

    const safeUser = user.toObject();
    delete safeUser.password;

    const token = signToken(user);

    return res.status(201).json({
      message: "User registered successfully",
      token,
      user: safeUser,
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      const message = Object.values(err.errors)[0]?.message || "Please check your account details.";
      return res.status(400).json({ message });
    }
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with those details already exists." });
    }
    console.error("User registration failed:", err);
    return res.status(500).json({ message: "Could not create your account. Please try again." });
  }
}

async function loginUser(req, res) {
  try {
    const { email, phone, appleId, password, provider } = req.body || {};

    const normalizedProvider = ["Email", "Google", "Facebook", "Apple", "Demo"].includes(provider)
      ? provider
      : "Email";

    const { email: normalizedEmail, phone: normalizedPhone, appleId: normalizedAppleId } = getProviderIdentity(
      email,
      phone,
      appleId,
      normalizedProvider
    );

    const identity = [normalizedEmail, normalizedPhone, normalizedAppleId].find(Boolean);

    if (!identity) {
      return res.status(400).json({
        code: "EMAIL_REQUIRED",
        message: normalizedProvider === "Email"
          ? "Please enter your email address."
          : "Email, phone number, or Apple ID is required.",
      });
    }

    if (normalizedEmail && !isEmail(normalizedEmail)) {
      return res.status(400).json({
        code: "INVALID_EMAIL",
        message: "Please enter a valid email address.",
      });
    }

    const user = await findUserByIdentity([
      normalizedEmail,
      normalizedPhone,
      normalizedAppleId,
    ]).select("+password");
    if (!user) {
      return res.status(401).json({
        code: normalizedEmail ? "EMAIL_NOT_FOUND" : "ACCOUNT_NOT_REGISTERED",
        message: normalizedEmail
          ? "No account found with this email. Please sign up first."
          : "Account is not registered.",
      });
    }
    if (user.status === "disabled") {
      return res.status(403).json({
        code: "ACCOUNT_DISABLED",
        message: "This account has been disabled. Contact support for assistance.",
      });
    }
    // Email signups must verify their Gmail inbox (OTP) before first login.
    if (user.email && !user.emailVerified && normalizedProvider === "Email" && user.provider === "Email") {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your Gmail with the code we emailed you.",
      });
    }
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Password is required." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      if (user.googleId) {
        return res.status(401).json({
          code: "USE_GOOGLE_SIGN_IN",
          message: "This email uses Google Sign-In. Please continue with Google, or reset your password to set one.",
        });
      }
      return res.status(401).json({
        code: "INVALID_PASSWORD",
        message: "Incorrect password. Please try again.",
      });
    }

    if (normalizedProvider !== "Email" && user.provider !== normalizedProvider) {
      return res.status(401).json({
        code: "ACCOUNT_NOT_REGISTERED",
        message: "No account is registered with this sign-in method.",
      });
    }

    await LoginActivity.create({
      userId: user._id,
      name: user.name,
      email: user.email || "",
      status: "successful",
    });

    const safeUser = user.toObject();
    delete safeUser.password;

    const token = signToken(user);

    return res.json({
      code: "LOGIN_SUCCESS",
      message: "Login successful",
      token,
      user: safeUser,
    });
  } catch (err) {
    console.error("User login failed:", err);
    return res.status(500).json({ message: "Could not complete login. Please try again." });
  }
}

async function requestPasswordReset(req, res) {
  const email = normalizeEmail(req.body?.email);
  if (!isEmail(email)) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
    });
  }

  const rateKey = `${email}:${req.ip || "unknown"}`;
  if (isResetRateLimited(rateKey)) {
    return res.status(429).json({
      code: "RESET_REQUEST_RATE_LIMITED",
      message: "Too many reset requests. Please wait 15 minutes and try again.",
    });
  }

  try {
    const user = await findResetUser(email);
    if (!user) {
      return res.status(404).json({
        code: "EMAIL_NOT_FOUND",
        message: "This email is not registered. Please check your email or create a new account.",
      });
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const otpHash = hashResetOtp(email, otp);
    user.passwordResetOtpHash = otpHash;
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_OTP_TTL_MS);
    user.passwordResetAttempts = 0;
    await user.save();

    try {
      await emailService.sendPasswordResetOtp(user.email, otp);
    } catch (error) {
      await clearResetOtp(user._id, otpHash);
      if (error.code === "EMAIL_NOT_CONFIGURED") {
        return res.status(503).json({
          code: "EMAIL_NOT_CONFIGURED",
          message: "Password reset email is not configured. Please contact support.",
        });
      }
      console.error("Password reset email delivery failed.");
      return res.status(502).json({
        code: "EMAIL_DELIVERY_FAILED",
        message: "Could not send the reset email. Please try again later.",
      });
    }

    return res.json({
      message: "A password reset code has been sent to your email address.",
    });
  } catch (err) {
    console.error("Password reset request failed:", err);
    return res.status(500).json({
      code: "PASSWORD_RESET_FAILED",
      message: "Could not process your password reset. Please try again later.",
    });
  }
}

async function verifyPasswordResetOtp(req, res) {
  const email = normalizeEmail(req.body?.email);
  const otp = req.body?.otp;
  if (!isEmail(email)) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
    });
  }
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      code: "RESET_OTP_INVALID",
      message: "Please enter the 6-digit reset code from your email.",
    });
  }

  try {
    const user = await findResetUser(email);
    if (!user) {
      return res.status(400).json({
        code: "RESET_OTP_INVALID",
        message: "This reset code is invalid. Please request a new one.",
      });
    }

    const failure = await invalidResetOtpResponse(res, user, email, otp);
    if (failure) return failure;
    return res.json({ message: "Reset code verified." });
  } catch (err) {
    console.error("Password reset code verification failed:", err);
    return res.status(500).json({
      code: "PASSWORD_RESET_FAILED",
      message: "Could not verify the reset code. Please try again later.",
    });
  }
}

async function resetPassword(req, res) {
  const email = normalizeEmail(req.body?.email);
  const otp = req.body?.otp;
  const password = req.body?.password;
  if (!isEmail(email)) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
    });
  }
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      code: "RESET_OTP_INVALID",
      message: "Please enter the 6-digit reset code from your email.",
    });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({
      code: "WEAK_PASSWORD",
      message: STRONG_PASSWORD_MESSAGE,
    });
  }

  try {
    const user = await findResetUser(email);
    if (!user) {
      return res.status(400).json({
        code: "RESET_OTP_INVALID",
        message: "This reset code is invalid. Please request a new one.",
      });
    }

    const failure = await invalidResetOtpResponse(res, user, email, otp);
    if (failure) return failure;

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await User.updateOne(
      {
        _id: user._id,
        passwordResetOtpHash: user.passwordResetOtpHash,
        passwordResetExpiresAt: { $gt: new Date() },
        passwordResetAttempts: { $lt: RESET_OTP_MAX_ATTEMPTS },
      },
      {
        $set: { password: passwordHash, passwordResetAttempts: 0 },
        $unset: {
          passwordResetOtpHash: 1,
          passwordResetExpiresAt: 1,
        },
      }
    );
    if (result.modifiedCount !== 1) {
      return res.status(400).json({
        code: "RESET_OTP_INVALID",
        message: "This reset code is invalid or has already been used. Please request a new one.",
      });
    }

    return res.json({
      message: "Your password has been reset successfully. You can now log in.",
    });
  } catch (err) {
    console.error("Password reset failed:", err);
    return res.status(500).json({
      code: "PASSWORD_RESET_FAILED",
      message: "Could not reset your password. Please try again later.",
    });
  }
}

async function requestRegisterOtp(req, res) {
  try {
    const name = normalizeName(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!name || !NAME_PATTERN.test(name)) {
      return res.status(400).json({ message: "Please enter a valid name." });
    }
    if (!isEmail(email)) {
      return res.status(400).json({
        message: req.body?.email ? "Please enter a valid email address." : "Email is required.",
      });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
    }
    return sendRegisterOtpForEmail(res, {
      name,
      email,
      password,
      rateKey: req.ip || "unknown",
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with those details already exists." });
    }
    console.error("Registration OTP request failed:", err);
    return res.status(500).json({ message: "Could not send the verification code. Please try again." });
  }
}

async function verifyRegisterOtp(req, res) {
  const email = normalizeEmail(req.body?.email);
  const otp = req.body?.otp;
  if (!isEmail(email)) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
    });
  }
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      code: "REGISTER_OTP_INVALID",
      message: "Please enter the 6-digit verification code from your email.",
    });
  }

  try {
    const user = await findRegisterUser(email);
    if (!user) {
      return res.status(400).json({
        code: "REGISTER_OTP_INVALID",
        message: "This verification code is invalid. Please request a new one.",
      });
    }

    // Idempotent: already verified → just log them in.
    if (user.emailVerified) {
      const full = await User.findById(user._id);
      const safeUser = full.toObject();
      delete safeUser.password;
      return res.json({
        code: "LOGIN_SUCCESS",
        message: "Email already verified. You are logged in.",
        token: signToken(full),
        user: safeUser,
      });
    }

    const failure = await invalidRegisterOtpResponse(res, user, email, otp);
    if (failure) return failure;

    const updated = await User.findOneAndUpdate(
      {
        _id: user._id,
        emailVerificationOtpHash: user.emailVerificationOtpHash,
        emailVerificationExpiresAt: { $gt: new Date() },
        emailVerificationAttempts: { $lt: REGISTER_OTP_MAX_ATTEMPTS },
      },
      {
        $set: { emailVerified: true, emailVerificationAttempts: 0 },
        $unset: { emailVerificationOtpHash: 1, emailVerificationExpiresAt: 1 },
      },
      { new: true }
    );
    if (!updated) {
      return res.status(400).json({
        code: "REGISTER_OTP_INVALID",
        message: "This verification code is invalid or has already been used. Please request a new one.",
      });
    }

    const safeUser = updated.toObject();
    delete safeUser.password;

    return res.status(201).json({
      code: "REGISTER_SUCCESS",
      message: "Your Gmail is verified. Welcome to SuvYatra!",
      token: signToken(updated),
      user: safeUser,
    });
  } catch (err) {
    console.error("Registration OTP verification failed:", err);
    return res.status(500).json({
      code: "REGISTER_FAILED",
      message: "Could not verify the code. Please try again later.",
    });
  }
}

async function resendRegisterOtp(req, res) {
  const email = normalizeEmail(req.body?.email);
  if (!isEmail(email)) {
    return res.status(400).json({
      code: "INVALID_EMAIL",
      message: "Please enter a valid email address.",
    });
  }
  if (isRegisterRateLimited(`${email}:${req.ip || "unknown"}`)) {
    return res.status(429).json({
      code: "REGISTER_REQUEST_RATE_LIMITED",
      message: "Too many verification requests. Please wait 15 minutes and try again.",
    });
  }

  try {
    const user = await findRegisterUser(email);
    if (!user) {
      return res.status(404).json({
        code: "EMAIL_NOT_FOUND",
        message: "No pending registration for this email. Please sign up first.",
      });
    }
    if (user.emailVerified) {
      return res.json({ message: "This email is already verified. Please log in." });
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    user.emailVerificationOtpHash = hashRegisterOtp(email, otp);
    user.emailVerificationExpiresAt = new Date(Date.now() + REGISTER_OTP_TTL_MS);
    user.emailVerificationAttempts = 0;
    user.emailVerificationRequestedAt = new Date();
    await user.save();

    try {
      await emailService.sendRegistrationOtp(user.email, otp);
    } catch (error) {
      if (error.code === "EMAIL_NOT_CONFIGURED") {
        return res.status(503).json({
          code: "EMAIL_NOT_CONFIGURED",
          message: "Verification email is not configured. Please contact support.",
        });
      }
      console.error("Registration email delivery failed.");
      return res.status(502).json({
        code: "EMAIL_DELIVERY_FAILED",
        message: "Could not send the verification email. Please try again later.",
      });
    }

    return res.json({ message: "A new verification code has been sent to your Gmail." });
  } catch (err) {
    console.error("Registration OTP resend failed:", err);
    return res.status(500).json({ message: "Could not resend the verification code. Please try again." });
  }
}

async function googleLogin(req, res) {
  try {
    const { idToken } = req.body || {};
    let profile;
    try {
      profile = await verifyGoogleIdToken(idToken);
    } catch (error) {
      const status =
        error.code === "GOOGLE_NOT_CONFIGURED"
          ? 503
          : error.code === "GOOGLE_TOKEN_REQUIRED"
            ? 400
            : 401;
      return res.status(status).json({
        code: error.code || "GOOGLE_TOKEN_INVALID",
        message: error.message,
      });
    }

    // 1. Existing Google-linked account wins.
    let user = await User.findOne({ googleId: profile.googleId });

    // 2. Otherwise link by verified email (case-insensitive).
    if (!user) {
      user = await User.findOne({ email: profile.email }).collation({
        locale: "en",
        strength: 2,
      });
      if (user) {
    if (user.status === "disabled") {
      return res.status(403).json({
        code: "ACCOUNT_DISABLED",
        message: "This account has been disabled. Contact support for assistance.",
      });
    }
        user.googleId = profile.googleId;
        user.emailVerified = true;
        if (!user.avatar && profile.avatar) user.avatar = profile.avatar;
        await user.save();
      }
    }

    // 3. Otherwise auto-provision a Google account (no user-chosen password).
    if (!user) {
      const { randomBytes } = require("node:crypto");
      const randomSecret = randomBytes(32).toString("hex");
      const passwordHash = await bcrypt.hash(`google:${profile.googleId}:${randomSecret}`, 12);
      const baseName = profile.name.replace(/\s+/g, " ").trim().slice(0, 100) || "SuvYatra Explorer";
      const safeName = NAME_PATTERN.test(baseName) ? baseName : "SuvYatra Explorer";
      user = await User.create({
        name: safeName,
        email: profile.email,
        password: passwordHash,
        googleId: profile.googleId,
        emailVerified: true,
        avatar: profile.avatar || undefined,
        provider: "Google",
      });
    }

    if (user.status === "disabled") {
      return res.status(403).json({
        code: "ACCOUNT_DISABLED",
        message: "This account has been disabled. Contact support for assistance.",
      });
    }

    // Safety: a different Google subject must never hijack this email.
    if (user.googleId && user.googleId !== profile.googleId) {
      return res.status(409).json({
        code: "GOOGLE_ACCOUNT_MISMATCH",
        message: "This email is already linked to a different Google account.",
      });
    }

    await LoginActivity.create({
      userId: user._id,
      name: user.name,
      email: user.email || "",
      status: "successful",
    });

    const safeUser = user.toObject();
    delete safeUser.password;

    return res.json({
      code: "LOGIN_SUCCESS",
      message: "Google sign-in successful",
      token: signToken(user),
      user: safeUser,
    });
  } catch (err) {
    console.error("Google login failed:", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with those details already exists." });
    }
    return res.status(500).json({ message: "Could not complete Google sign-in. Please try again." });
  }
}

async function getMe(req, res) {
  try {
    return res.json({ user: req.user });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
  registerUser,
  requestRegisterOtp,
  resendRegisterOtp,
  verifyRegisterOtp,
  loginUser,
  googleLogin,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
  getMe,
};
