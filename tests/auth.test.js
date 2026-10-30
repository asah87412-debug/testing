const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const LoginActivity = require("../models/LoginActivity");
const emailService = require("../services/emailService");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_auth_test";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

  await connectDB();
  await User.deleteMany({});
  await LoginActivity.deleteMany({});

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  return server;
}

test("registers a user and logs them in", async (t) => {
  const server = await startServer();

  t.after(async () => {
    await User.deleteMany({});
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      email: "  Test@Gmail.com  ",
      password: "StrongPass123!",
      phone: "1234567890",
      location: "Kathmandu",
    }),
  });

  const registerJson = await registerRes.json();
  assert.equal(registerRes.status, 201, JSON.stringify(registerJson));
  assert.equal(registerJson.user.emailVerified, true);
  assert.ok(registerJson.token);
  assert.equal(registerJson.user.email, "test@gmail.com");
  assert.equal(Object.hasOwn(registerJson.user, "password"), false);

  // Signup and subsequent sign-in both complete without an email OTP.
  const unverifiedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@gmail.com", password: "StrongPass123!" }),
  });
  const unverifiedLoginJson = await unverifiedLoginRes.json();
  assert.equal(unverifiedLoginRes.status, 200, JSON.stringify(unverifiedLoginJson));
  assert.equal(unverifiedLoginJson.code, "LOGIN_SUCCESS");
  assert.equal(typeof unverifiedLoginJson.token, "string");
  const removedVerificationRoute = await fetch(`${baseUrl}/api/auth/verify-registration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@gmail.com", otp: "123456" }),
  });
  assert.equal(removedVerificationRoute.status, 404);

  const storedUser = await User.findById(registerJson.user._id).select("+password");
  assert.equal(storedUser.email, "test@gmail.com");
  assert.notEqual(storedUser.password, "StrongPass123!");

  const missingPasswordRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@gmail.com", password: "" }),
  });
  assert.equal(missingPasswordRes.status, 400);
  assert.equal((await missingPasswordRes.json()).message, "Password is required.");

  const wrongPasswordRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "  TEST@gmail.com ",
      password: "WrongPass123!",
    }),
  });
  const wrongPasswordJson = await wrongPasswordRes.json();
  assert.equal(wrongPasswordRes.status, 401);
  assert.equal(wrongPasswordJson.code, "INVALID_PASSWORD");
  assert.equal(wrongPasswordJson.message, "Incorrect password. Please try again.");

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "  TEST@GMAIL.COM  ",
      password: "StrongPass123!",
    }),
  });

  const loginJson = await loginRes.json();
  assert.equal(loginRes.status, 200, JSON.stringify(loginJson));
  assert.equal(loginJson.code, "LOGIN_SUCCESS");
  assert.ok(loginJson.token, "should return JWT token");
  assert.equal(loginJson.user.email, "test@gmail.com");
  assert.equal(Object.hasOwn(loginJson.user, "password"), false);

  const sessionRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginJson.token}` },
  });
  const sessionJson = await sessionRes.json();
  assert.equal(sessionRes.status, 200, JSON.stringify(sessionJson));
  assert.equal(sessionJson.user.email, "test@gmail.com");

  const activity = await LoginActivity.find({ userId: loginJson.user._id });
  assert.equal(activity.length, 2);
  assert.equal(activity[0].email, "test@gmail.com");
  assert.equal(activity[0].status, "successful");
  assert.ok(activity[0].loginAt instanceof Date);
});

test("supports Google, Facebook, and Apple credential login", async (t) => {
  const server = await startServer();

  t.after(async () => {
    await User.deleteMany({});
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const googleRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Google User",
      phone: "+977 9876543210",
      email: "",
      password: "StrongPass123!",
      provider: "Google",
    }),
  });

  const googleRegisterJson = await googleRegister.json();
  assert.equal(googleRegister.status, 201, JSON.stringify(googleRegisterJson));
  assert.equal(googleRegisterJson.user.phone, "+9779876543210");

  const googleLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: "+977 9876543210",
      password: "StrongPass123!",
      provider: "Google",
    }),
  });

  const googleLoginJson = await googleLogin.json();
  assert.equal(googleLogin.status, 200, JSON.stringify(googleLoginJson));
  assert.equal(googleLoginJson.user.phone, "+9779876543210");

  const facebookRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Facebook User",
      email: "facebook.user@example.com",
      password: "StrongPass123!",
      provider: "Facebook",
    }),
  });

  const facebookRegisterJson = await facebookRegister.json();
  assert.equal(facebookRegister.status, 201, JSON.stringify(facebookRegisterJson));

  const facebookLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "facebook.user@example.com",
      password: "StrongPass123!",
      provider: "Facebook",
    }),
  });

  const facebookLoginJson = await facebookLogin.json();
  assert.equal(facebookLogin.status, 200, JSON.stringify(facebookLoginJson));
  assert.ok(facebookLoginJson.token, "Facebook login should return a JWT token");
  assert.equal(facebookLoginJson.user.provider, "Facebook");

  const appleRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Apple User",
      email: "",
      appleId: "alex.apple.id",
      password: "StrongPass123!",
      provider: "Apple",
    }),
  });

  const appleRegisterJson = await appleRegister.json();
  assert.equal(appleRegister.status, 201, JSON.stringify(appleRegisterJson));
  assert.equal(appleRegisterJson.user.appleId, "alex.apple.id");

  const appleLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "alex.apple.id",
      password: "StrongPass123!",
      provider: "Apple",
    }),
  });

  const appleLoginJson = await appleLogin.json();
  assert.equal(appleLogin.status, 200, JSON.stringify(appleLoginJson));
  assert.equal(appleLoginJson.user.appleId, "alex.apple.id");
});

test("rejects invalid signup fields and distinguishes login failures", async (t) => {
  const server = await startServer();

  t.after(async () => {
    await User.deleteMany({});
    await LoginActivity.deleteMany({});
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body) =>
    fetch(`${baseUrl}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  for (const name of ["12345", "@#$%", "John123", "John@Smith"]) {
    const response = await request("register", {
      name,
      email: "valid@example.com",
      password: "StrongPass123!",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Please enter a valid name.");
  }

  for (const email of ["abc", "abc@", "abc.com", "@gmail.com"]) {
    const response = await request("register", {
      name: "Valid User",
      email,
      password: "StrongPass123!",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Please enter a valid email address.");
  }

  const weakPassword = await request("register", {
    name: "Valid User",
    email: "valid@example.com",
    password: "password",
  });
  assert.equal(weakPassword.status, 400);
  assert.match((await weakPassword.json()).message, /uppercase letter.*lowercase letter.*number.*special character/);

  const registration = await request("register", {
    name: "  नेपाली   User  ",
    email: "valid@example.com",
    password: "StrongPass123!",
  });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).user.name, "नेपाली User");

  const duplicateRegistration = await request("register", {
    name: "Duplicate User",
    email: "VALID@example.com",
    password: "StrongPass123!",
  });
  assert.equal(duplicateRegistration.status, 409);
  assert.equal(
    (await duplicateRegistration.json()).message,
    "User with this account already exists"
  );

  const unknownEmail = await request("login", {
    email: "missing@example.com",
    password: "StrongPass123!",
  });
  assert.equal(unknownEmail.status, 401);
  assert.equal((await unknownEmail.clone().json()).code, "EMAIL_NOT_FOUND");
  assert.equal(
    (await unknownEmail.json()).message,
    "No account found with this email. Please sign up first."
  );
  assert.equal(await User.exists({ email: "missing@example.com" }), null);

  const unknownEmailWithoutPassword = await request("login", {
    email: "missing@example.com",
  });
  assert.equal(unknownEmailWithoutPassword.status, 401);
  assert.equal(
    (await unknownEmailWithoutPassword.json()).code,
    "EMAIL_NOT_FOUND"
  );

  const emptyEmail = await request("login", {
    email: "   ",
    password: "StrongPass123!",
  });
  assert.equal(emptyEmail.status, 400);
  assert.equal((await emptyEmail.json()).message, "Please enter your email address.");

  const invalidEmail = await request("login", {
    email: "not-an-email",
    password: "StrongPass123!",
  });
  assert.equal(invalidEmail.status, 400);
  assert.equal((await invalidEmail.json()).message, "Please enter a valid email address.");

  const wrongPassword = await request("login", {
    email: "valid@example.com",
    password: "WrongPass123!",
  });
  assert.equal(wrongPassword.status, 401);
  const wrongPasswordJson = await wrongPassword.json();
  assert.equal(wrongPasswordJson.code, "INVALID_PASSWORD");
  assert.equal(wrongPasswordJson.message, "Incorrect password. Please try again.");
});

test("sends a one-time password reset code and updates the password", async (t) => {
  const server = await startServer();
  const originalSendPasswordResetOtp = emailService.sendPasswordResetOtp;
  let sentOtp;

  t.after(async () => {
    emailService.sendPasswordResetOtp = originalSendPasswordResetOtp;
    await User.deleteMany({});
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body) =>
    fetch(`${baseUrl}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const registerResponse = await request("register", {
    name: "Reset User",
    email: "reset@gmail.com",
    password: "OldStrong123!",
  });
  assert.equal(registerResponse.status, 201);

  const unknownEmail = await request("forgot-password", {
    email: "not-registered@gmail.com",
  });
  assert.equal(unknownEmail.status, 404);
  assert.equal(
    (await unknownEmail.json()).message,
    "This email is not registered. Please check your email or create a new account."
  );

  const invalidEmail = await request("forgot-password", { email: "not-an-email" });
  assert.equal(invalidEmail.status, 400);
  assert.equal((await invalidEmail.json()).code, "INVALID_EMAIL");

  emailService.sendPasswordResetOtp = async (_email, otp) => {
    sentOtp = otp;
  };
  const resetRequest = await request("forgot-password", {
    email: "  RESET@GMAIL.COM ",
  });
  const resetRequestJson = await resetRequest.json();
  assert.equal(resetRequest.status, 200);
  assert.doesNotMatch(JSON.stringify(resetRequestJson), /\b\d{6}\b/);
  assert.match(sentOtp, /^\d{6}$/);

  let storedUser = await User.findOne({ email: "reset@gmail.com" }).select(
    "+password +passwordResetOtpHash +passwordResetExpiresAt +passwordResetAttempts"
  );
  assert.notEqual(storedUser.passwordResetOtpHash, sentOtp);
  assert.ok(storedUser.passwordResetExpiresAt > new Date());

  const invalidOtp = await request("verify-reset-otp", {
    email: "reset@gmail.com",
    otp: sentOtp === "000000" ? "000001" : "000000",
  });
  assert.equal(invalidOtp.status, 400);
  assert.equal((await invalidOtp.json()).code, "RESET_OTP_INVALID");

  const verifiedOtp = await request("verify-reset-otp", {
    email: "RESET@gmail.com",
    otp: sentOtp,
  });
  assert.equal(verifiedOtp.status, 200);

  const weakPassword = await request("reset-password", {
    email: "reset@gmail.com",
    otp: sentOtp,
    password: "weak",
  });
  assert.equal(weakPassword.status, 400);
  assert.equal((await weakPassword.json()).code, "WEAK_PASSWORD");

  const resetResponse = await request("reset-password", {
    email: "reset@gmail.com",
    otp: sentOtp,
    password: "NewStrong123!",
  });
  assert.equal(resetResponse.status, 200);
  assert.equal(
    (await resetResponse.json()).message,
    "Your password has been reset successfully. You can now log in."
  );

  storedUser = await User.findOne({ email: "reset@gmail.com" }).select(
    "+password +passwordResetOtpHash +passwordResetExpiresAt"
  );
  assert.notEqual(storedUser.password, "NewStrong123!");
  assert.equal(storedUser.passwordResetOtpHash, undefined);
  assert.equal(storedUser.passwordResetExpiresAt, undefined);

  const replayedOtp = await request("reset-password", {
    email: "reset@gmail.com",
    otp: sentOtp,
    password: "AnotherStrong123!",
  });
  assert.equal(replayedOtp.status, 400);
  assert.equal((await replayedOtp.json()).code, "RESET_OTP_INVALID");

  const oldPasswordLogin = await request("login", {
    email: "reset@gmail.com",
    password: "OldStrong123!",
  });
  assert.equal(oldPasswordLogin.status, 401);
  assert.equal((await oldPasswordLogin.json()).code, "INVALID_PASSWORD");

  const newPasswordLogin = await request("login", {
    email: "reset@gmail.com",
    password: "NewStrong123!",
  });
  assert.equal(newPasswordLogin.status, 200);
  assert.equal((await newPasswordLogin.json()).code, "LOGIN_SUCCESS");
});

test("rejects expired password reset codes and does not fake SMTP delivery", async (t) => {
  const server = await startServer();
  const originalSendPasswordResetOtp = emailService.sendPasswordResetOtp;
  const smtpEnvironmentKeys = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM_EMAIL",
    "SMTP_FROM_NAME",
  ];
  const originalSmtpEnvironment = new Map(
    smtpEnvironmentKeys.map((key) => [key, process.env[key]])
  );

  t.after(async () => {
    emailService.sendPasswordResetOtp = originalSendPasswordResetOtp;
    for (const key of smtpEnvironmentKeys) {
      const value = originalSmtpEnvironment.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await User.deleteMany({});
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body) =>
    fetch(`${baseUrl}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  await request("register", {
    name: "Expired Reset",
    email: "expired@gmail.com",
    password: "StrongPass123!",
  });

  for (const key of smtpEnvironmentKeys) delete process.env[key];
  const emailFailure = await request("forgot-password", { email: "expired@gmail.com" });
  for (const [key, value] of originalSmtpEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  assert.equal(emailFailure.status, 503);
  assert.equal((await emailFailure.json()).code, "EMAIL_NOT_CONFIGURED");
  let storedUser = await User.findOne({ email: "expired@gmail.com" }).select(
    "+passwordResetOtpHash"
  );
  assert.equal(storedUser.passwordResetOtpHash, undefined);

  let sentOtp;
  emailService.sendPasswordResetOtp = async (_email, otp) => {
    sentOtp = otp;
  };
  await request("forgot-password", { email: "expired@gmail.com" });
  await User.updateOne(
    { email: "expired@gmail.com" },
    { $set: { passwordResetExpiresAt: new Date(Date.now() - 1_000) } }
  );

  const expiredOtp = await request("verify-reset-otp", {
    email: "expired@gmail.com",
    otp: sentOtp,
  });
  assert.equal(expiredOtp.status, 400);
  assert.equal((await expiredOtp.json()).code, "RESET_OTP_EXPIRED");
  storedUser = await User.findOne({ email: "expired@gmail.com" }).select(
    "+passwordResetOtpHash"
  );
  assert.equal(storedUser.passwordResetOtpHash, undefined);

  const renewedRequest = await request("forgot-password", {
    email: "expired@gmail.com",
  });
  assert.equal(renewedRequest.status, 200);
  const invalidCode = sentOtp === "000000" ? "000001" : "000000";
  let tooManyAttempts;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    tooManyAttempts = await request("verify-reset-otp", {
      email: "expired@gmail.com",
      otp: invalidCode,
    });
  }
  assert.equal(tooManyAttempts.status, 429);
  assert.equal((await tooManyAttempts.json()).code, "RESET_OTP_ATTEMPTS_EXCEEDED");
  storedUser = await User.findOne({ email: "expired@gmail.com" }).select(
    "+passwordResetOtpHash"
  );
  assert.equal(storedUser.passwordResetOtpHash, undefined);
});
