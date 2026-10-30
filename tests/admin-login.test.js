const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { app, connectDB } = require("../server");
const User = require("../models/User");

const TEST_DB = "mongodb://127.0.0.1:27017/suvyatra_admin_login_test";
const TEST_SECRET = "test-secret-value-that-is-at-least-thirty-two-characters-long";

test.after(async () => {
  await mongoose.disconnect();
});

async function startServer() {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  await connectDB();
  await User.deleteMany({});
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function adminLogin(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

test("DB-backed admin can log in; guards hold; env fallback intact", async () => {
  const { baseUrl, server } = await startServer();
  try {
    await User.create({ name: "Db Admin", email: "dbadmin@example.test", password: "StrongPass123!", provider: "Email", emailVerified: true, role: "admin" });
    await User.create({ name: "Plain User", email: "plainuser@example.test", password: "StrongPass123!", provider: "Email", emailVerified: true, role: "user" });
    const disabled = await User.create({ name: "Disabled Admin", email: "disabledadmin@example.test", password: "StrongPass123!", provider: "Email", emailVerified: true, role: "admin", status: "disabled" });
    assert.ok(disabled);

    // DB admin, correct password (mixed case email exercises collation path).
    const ok = await adminLogin(baseUrl, "DbAdmin@Example.Test", "StrongPass123!");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.admin?.role, "admin");
    assert.equal(ok.body.admin?.email, "dbadmin@example.test");
    // Session token opens the dashboard APIs.
    const session = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { Authorization: `Bearer ${ok.body.token}` },
    });
    assert.equal(session.status, 200);

    // Wrong password, unknown email, non-admin user, disabled admin.
    assert.equal((await adminLogin(baseUrl, "dbadmin@example.test", "WrongPass123!")).status, 401);
    assert.equal((await adminLogin(baseUrl, "nobody@example.test", "StrongPass123!")).status, 401);
    assert.equal((await adminLogin(baseUrl, "plainuser@example.test", "StrongPass123!")).status, 401);
    assert.equal((await adminLogin(baseUrl, "disabledadmin@example.test", "StrongPass123!")).status, 401);
    assert.equal((await adminLogin(baseUrl, "", "")).status, 401);
  } finally {
    await stopServer(server);
  }
});
