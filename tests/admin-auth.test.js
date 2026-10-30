const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { app, connectDB } = require("../server");
const User = require("../models/User");
const LoginActivity = require("../models/LoginActivity");
const Destination = require("../models/Destination");
const Hotel = require("../models/Hotel");
const Restaurant = require("../models/Restaurant");
const LocalPlace = require("../models/LocalPlace");
const Transport = require("../models/Transport");
const SupportTicket = require("../models/SupportTicket");
const Review = require("../models/Review");

const TEST_DB = `mongodb://127.0.0.1:27017/suvyatra_admin_auth_test_${process.pid}_${Date.now()}`;
const TEST_SECRET = "admin-auth-test-secret-at-least-thirty-two-characters-long";
const ADMIN_EMAIL = "admin-test@example.com";
const USER_EMAIL = "dashboard-user@example.com";
const USER_WITH_LOCATION_EMAIL = "located-user@example.com";

test("separate admin login protects and safely lists registered users", async (t) => {
  process.env.MONGO_URI = TEST_DB;
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash("SecureAdminPass123!", 12);
  await connectDB();

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const postJson = (path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const badAdminLogin = await postJson("/admin/login", {
    email: ADMIN_EMAIL,
    password: "WrongAdminPass123!",
  });
  assert.equal(badAdminLogin.status, 401);
  assert.equal(
    (await badAdminLogin.json()).message,
    "Invalid administrator email or password."
  );

  const adminLogin = await postJson("/admin/login", {
    email: ADMIN_EMAIL.toUpperCase(),
    password: "SecureAdminPass123!",
  });
  const adminSession = await adminLogin.json();
  assert.equal(adminLogin.status, 200, JSON.stringify(adminSession));
  assert.equal(adminSession.admin.email, ADMIN_EMAIL);
  assert.equal(Object.hasOwn(adminSession, "password"), false);
  const adminHeaders = { Authorization: `Bearer ${adminSession.token}` };
  assert.equal(
    (await fetch(`${baseUrl}/admin/session`, { headers: adminHeaders })).status,
    200
  );

  const registerUser = async (email, location) => {
    const response = await postJson("/auth/register", {
      name: email === USER_EMAIL ? "Dashboard User" : "Located User",
      email,
      password: "StrongPass123!",
      ...(location ? { location } : {}),
    });
    const account = await response.json();
    assert.equal(response.status, 201, JSON.stringify(account));
    await User.updateOne(
      { _id: account.user._id },
      { $set: { emailVerified: true }, $unset: { emailVerificationOtpHash: 1, emailVerificationExpiresAt: 1 } }
    );
    const login = await postJson("/auth/login", { email, password: "StrongPass123!" });
    const session = await login.json();
    assert.equal(login.status, 200, JSON.stringify(session));
    return { ...account, token: session.token, user: session.user };
  };
  const unlocatedAccount = await registerUser(USER_EMAIL);
  const locatedAccount = await registerUser(USER_WITH_LOCATION_EMAIL, "Pokhara, Nepal");
  const registeredAt = new Date(unlocatedAccount.user.createdAt);
  assert.ok(Number.isFinite(registeredAt.getTime()), "registration timestamp must be stored");

  const userDashboardResponse = await fetch(`${baseUrl}/admin/users`, {
    headers: { Authorization: `Bearer ${unlocatedAccount.token}` },
  });
  assert.equal(userDashboardResponse.status, 403);
  const userAdminApiResponse = await fetch(`${baseUrl}/admin/overview`, {
    headers: { Authorization: "Bearer " + unlocatedAccount.token },
  });
  assert.equal(userAdminApiResponse.status, 403);

  const usersResponse = await fetch(`${baseUrl}/admin/users?sort=oldest`, {
    headers: adminHeaders,
  });
  const usersResult = await usersResponse.json();
  assert.equal(usersResponse.status, 200, JSON.stringify(usersResult));
  assert.equal(usersResult.total, 2);
  assert.equal(usersResult.matching, 2);
  assert.deepEqual(
    usersResult.users.map((user) => user.name),
    ["Dashboard User", "Located User"]
  );
  const unlocated = usersResult.users.find((user) => user._id === unlocatedAccount.user._id);
  assert.equal(unlocated.location, "Location not available");
  assert.equal(new Date(unlocated.createdAt).toISOString(), registeredAt.toISOString());
  for (const user of usersResult.users) {
    for (const field of ["password", "passwordResetOtpHash", "token", "passwordHash"]) {
      assert.equal(Object.hasOwn(user, field), false, `admin list must omit ${field}`);
    }
  }

  const locatedResponse = await fetch(
    `${baseUrl}/admin/users/${locatedAccount.user._id}`,
    { headers: adminHeaders }
  );
  const located = await locatedResponse.json();
  assert.equal(locatedResponse.status, 200);
  assert.equal(located.location, "Pokhara, Nepal");
  assert.equal(Object.hasOwn(located, "password"), false);
  assert.equal(Object.hasOwn(located, "passwordResetOtpHash"), false);

  const searched = await fetch(
    `${baseUrl}/admin/users?search=dashboard%20user`,
    { headers: adminHeaders }
  );
  const searchResult = await searched.json();
  assert.equal(searchResult.matching, 1);
  assert.equal(searchResult.users[0].email, USER_EMAIL);

  const deniedWrite = await fetch(`${baseUrl}/admin/resources/destinations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Should Not Be Created" }),
  });
  assert.equal(deniedWrite.status, 401);
  assert.equal((await Destination.countDocuments()), 0);
  const userDeniedWrite = await fetch(`${baseUrl}/admin/resources/destinations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + unlocatedAccount.token,
    },
    body: JSON.stringify({ name: "User Must Not Create Admin Content" }),
  });
  assert.equal(userDeniedWrite.status, 403);

  const createResource = async (type, body) => {
    const response = await fetch(`${baseUrl}/admin/resources/${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminHeaders.Authorization,
      },
      body: JSON.stringify(body),
    });
    const record = await response.json();
    assert.equal(response.status, 201, JSON.stringify(record));
    return record;
  };
  const updateAdminResource = async (type, record, body) => {
    const response = await fetch(`${baseUrl}/admin/resources/${type}/${record._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminHeaders.Authorization,
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const destination = await createResource("destinations", {
    name: "Admin Managed Destination",
    slug: "admin-managed-destination",
    province: "Gandaki",
    description: "Visible through the existing user destination API.",
    openingHours: { daily: "09:00-17:00" },
    tags: ["popular"],
  });
  const hiddenDestination = await createResource("destinations", {
    name: "Admin Managed Hidden Destination",
    slug: "admin-managed-hidden-destination",
    province: "Karnali",
    tags: ["hidden"],
  });
  const untaggedDestination = await createResource("destinations", {
    name: "Admin Managed Existing Destination",
    slug: "admin-managed-existing-destination",
    province: "Koshi",
  });
  const hotel = await createResource("hotels", {
    name: "Admin Managed Hotel",
    city: "Pokhara",
    location: "Lakeside",
    pricePerNight: 2500,
    available: true,
    roomTypes: [{ name: "Double Room", capacityAdults: 2, capacityChildren: 1, totalRooms: 5, nightlyRate: 2500 }],
  });
  const restaurant = await createResource("restaurants", {
    name: "Admin Managed Restaurant",
    city: "Pokhara",
    cuisine: ["Nepali"],
  });
  const activity = await createResource("activities", {
    name: "Admin Managed Trek",
    category: "Trekking",
    city: "Pokhara",
    price: 3000,
  });
  const transport = await createResource("transport", {
    name: "Admin Managed Bus",
    origin: "Pokhara",
    destination: "Kathmandu",
    type: "Bus",
    price: 1200,
  });
  assert.equal(destination.openingHours.daily, "09:00-17:00");
  assert.equal(hotel.isDemoData, false);
  assert.equal(restaurant.isDemoData, false);
  assert.equal(activity.module, "activity");
  assert.equal(activity.isDemoData, false);
  assert.equal(transport.isDemoData, false);

  const visibleDestinations = await fetch(`${baseUrl}/destinations`);
  assert.equal(visibleDestinations.status, 200);
  assert.ok((await visibleDestinations.json()).some((item) => item._id === destination._id));
  const popularDestinations = await fetch(`${baseUrl}/destinations?featured=popular`);
  const popularRecords = await popularDestinations.json();
  assert.ok(popularRecords.some((item) => item._id === destination._id));
  assert.ok(popularRecords.some((item) => item._id === untaggedDestination._id));
  assert.equal(popularRecords.some((item) => item._id === hiddenDestination._id), false);
  const hiddenDestinations = await fetch(`${baseUrl}/destinations?featured=hidden`);
  assert.ok((await hiddenDestinations.json()).some((item) => item._id === hiddenDestination._id));
  const visibleHotels = await fetch(`${baseUrl}/hotels`);
  assert.ok((await visibleHotels.json()).some((item) => item._id === hotel._id));
  const visibleRestaurants = await fetch(`${baseUrl}/restaurants`);
  assert.ok((await visibleRestaurants.json()).some((item) => item._id === restaurant._id));
  const visibleActivities = await fetch(`${baseUrl}/places?module=activity`);
  assert.ok((await visibleActivities.json()).items.some((item) => item._id === activity._id));
  const visibleTransport = await fetch(`${baseUrl}/transports`);
  assert.ok((await visibleTransport.json()).some((item) => item._id === transport._id));

  await updateAdminResource("destinations", destination, { description: "Updated by the admin." });
  await updateAdminResource("hotels", hotel, { description: "Updated hotel details." });
  await updateAdminResource("restaurants", restaurant, { description: "Updated restaurant details." });
  await updateAdminResource("activities", activity, { category: "Hiking" });
  await updateAdminResource("transport", transport, { price: 1300 });
  assert.equal((await Destination.findById(destination._id)).description, "Updated by the admin.");
  assert.equal((await Hotel.findById(hotel._id)).description, "Updated hotel details.");
  assert.equal((await Restaurant.findById(restaurant._id)).description, "Updated restaurant details.");
  assert.equal((await LocalPlace.findById(activity._id)).category, "Hiking");
  assert.equal((await Transport.findById(transport._id)).price, 1300);
  assert.ok((await (await fetch(`${baseUrl}/destinations`)).json()).some((item) =>
    item._id === destination._id && item.description === "Updated by the admin."
  ));
  assert.ok((await (await fetch(`${baseUrl}/hotels`)).json()).some((item) =>
    item._id === hotel._id && item.description === "Updated hotel details."
  ));
  assert.ok((await (await fetch(`${baseUrl}/restaurants`)).json()).some((item) =>
    item._id === restaurant._id && item.description === "Updated restaurant details."
  ));
  assert.ok((await (await fetch(`${baseUrl}/places?module=activity`)).json()).items.some((item) =>
    item._id === activity._id && item.category === "Hiking"
  ));
  assert.ok((await (await fetch(`${baseUrl}/transports`)).json()).some((item) =>
    item._id === transport._id && item.price === 1300
  ));

  const bookingResponse = await fetch(`${baseUrl}/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + unlocatedAccount.token,
    },
    body: JSON.stringify({
      itemType: "hotel",
      itemId: hotel._id,
      itemName: hotel.name,
      location: hotel.location,
      checkIn: "2026-10-10",
      checkOut: "2026-10-12",
      adults: 2,
      children: 0,
      rooms: 1,
      roomTypeId: hotel.roomTypes?.[0]?._id,
    }),
  });
  const createdBooking = await bookingResponse.json();
  assert.equal(bookingResponse.status, 201, JSON.stringify(createdBooking));
  const adminBookings = await fetch(
    `${baseUrl}/admin/bookings?search=${encodeURIComponent(USER_EMAIL)}`,
    { headers: adminHeaders }
  );
  const bookingList = await adminBookings.json();
  assert.equal(adminBookings.status, 200);
  assert.equal(bookingList.total, 1);
  assert.equal(bookingList.bookings[0].user.email, USER_EMAIL);
  assert.equal(Object.hasOwn(bookingList.bookings[0], "password"), false);
  const changedStatus = await fetch(
    `${baseUrl}/admin/bookings/${createdBooking.booking._id}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminHeaders.Authorization,
      },
      body: JSON.stringify({ status: "confirmed" }),
    }
  );
  assert.equal(changedStatus.status, 200);
  const userBookings = await fetch(`${baseUrl}/bookings`, {
    headers: { Authorization: "Bearer " + unlocatedAccount.token },
  });
  assert.equal((await userBookings.json()).bookings[0].status, "confirmed");
  const invalidTransition = await fetch(
    `${baseUrl}/admin/bookings/${createdBooking.booking._id}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminHeaders.Authorization,
      },
      body: JSON.stringify({ status: "pending" }),
    }
  );
  assert.equal(invalidTransition.status, 409);

  const review = await createResource("reviews", {
    userName: "Dashboard User",
    itemName: "Pokhara",
    itemType: "destination",
    rating: 1,
    comment: "Review requiring moderation.",
  });
  const hideReview = await fetch(`${baseUrl}/admin/resources/reviews/${review._id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: adminHeaders.Authorization,
    },
    body: JSON.stringify({ isHidden: true }),
  });
  assert.equal(hideReview.status, 200);
  const publicReviews = await fetch(`${baseUrl}/reviews`);
  assert.ok(!(await publicReviews.json()).some((item) => item._id === review._id));
  assert.equal((await fetch(`${baseUrl}/reviews/${review._id}`)).status, 404);
  const hiddenReviews = await fetch(`${baseUrl}/admin/resources/reviews?visibility=hidden`, {
    headers: adminHeaders,
  });
  assert.ok((await hiddenReviews.json()).records.some((item) => item._id === review._id));

  const disableAccount = await fetch(
    `${baseUrl}/admin/users/${unlocatedAccount.user._id}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminHeaders.Authorization,
      },
      body: JSON.stringify({ status: "disabled" }),
    }
  );
  assert.equal(disableAccount.status, 200);
  const disabledSession = await fetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: "Bearer " + unlocatedAccount.token },
  });
  assert.equal(disabledSession.status, 403);
  const disabledLogin = await postJson("/auth/login", {
    email: USER_EMAIL,
    password: "StrongPass123!",
  });
  assert.equal(disabledLogin.status, 403);

  const overviewResponse = await fetch(`${baseUrl}/admin/overview`, {
    headers: adminHeaders,
  });
  const overview = await overviewResponse.json();
  assert.equal(overviewResponse.status, 200, JSON.stringify(overview));
  assert.equal(overview.totals.users, 2);
  assert.equal(overview.totals.bookings, 1);
  assert.equal(overview.totals.destinations, 3);
  assert.equal(overview.totals.hotels, 1);
  assert.equal(overview.totals.restaurants, 1);
  assert.equal(overview.totals.activities, 1);
  assert.equal(overview.totals.transport, 1);
  assert.equal(overview.trends.registrations.length, 7);
  const chatbotStatus = await fetch(`${baseUrl}/admin/chatbot/status`, {
    headers: adminHeaders,
  });
  assert.equal(chatbotStatus.status, 200);
  const chatbotKnowledge = await fetch(`${baseUrl}/admin/chatbot/knowledge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: adminHeaders.Authorization,
    },
    body: JSON.stringify({ text: "Knowledge management requires explicit configuration." }),
  });
  assert.equal(chatbotKnowledge.status, 503);

  assert.equal((await fetch(`${baseUrl}/support`)).status, 401);
  const userFeedbackList = await fetch(`${baseUrl}/support`, {
    headers: { Authorization: "Bearer " + unlocatedAccount.token },
  });
  assert.equal(userFeedbackList.status, 403);
  const feedbackResponse = await postJson("/support", {
    subject: "Existing public feedback flow",
    message: "A user can still submit a support ticket.",
  });
  assert.equal(feedbackResponse.status, 201);
  const submittedFeedback = await feedbackResponse.json();
  assert.equal(await SupportTicket.countDocuments(), 1);
  await updateAdminResource("feedback", submittedFeedback, { status: "in_progress" });
  assert.equal((await SupportTicket.findById(submittedFeedback._id)).status, "in_progress");
  const adminFeedbackList = await fetch(`${baseUrl}/admin/resources/feedback`, {
    headers: adminHeaders,
  });
  assert.equal((await adminFeedbackList.json()).records.length, 1);

  for (const [resource, record, Model] of [
    ["destinations", destination, Destination],
    ["destinations", hiddenDestination, Destination],
    ["hotels", hotel, Hotel],
    ["restaurants", restaurant, Restaurant],
    ["activities", activity, LocalPlace],
    ["transport", transport, Transport],
    ["reviews", review, Review],
    ["feedback", submittedFeedback, SupportTicket],
  ]) {
    const deletion = await fetch(`${baseUrl}/admin/resources/${resource}/${record._id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    assert.equal(deletion.status, 200, `${resource} delete failed`);
    assert.equal(await Model.countDocuments({ _id: record._id }), 0, `${resource} should be removed`);
  }
});
