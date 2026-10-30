require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("node:crypto");
const connectDB = require("../config/db");

const User = require("../models/User");
const Destination = require("../models/Destination");
const Hotel = require("../models/Hotel");
const Restaurant = require("../models/Restaurant");
const Transport = require("../models/Transport");
const Booking = require("../models/Booking");
const SavedItem = require("../models/SavedItem");
const Notification = require("../models/Notification");
const Review = require("../models/Review");
const Setting = require("../models/Setting");
const upsertVerifiedListings = require("./upsertVerifiedListings");

async function upsertOnInsert(Model, documents, filterFor) {
  if (!documents.length) return;
  await Model.bulkWrite(documents.map((document) => ({
    updateOne: {
      filter: filterFor(document),
      update: { $setOnInsert: document },
      upsert: true,
    },
  })));
}

async function seed() {
  await connectDB();

  const userDetails = {
    name: "Nirmal Shrestha",
    email: "NirmalShrestha5@email.com",
    phone: "+977 9841 234 567",
    password: `Seed-${crypto.randomBytes(32).toString("hex")}!aA1`,
    location: "Kathmandu",
    bio: "Travelling Nepal one valley at a time.",
    memberSince: new Date("2024-01-01")
  };
  let user = await User.findOne({ email: userDetails.email });
  if (!user) user = await User.create(userDetails);

  await Setting.findOneAndUpdate(
    { userId: user._id },
    {
      $setOnInsert: {
        userId: user._id,
        pushNotifications: true,
        emailNotifications: true,
        smsNotifications: false,
        language: "English",
        currency: "NPR",
        compactView: false,
      },
    },
    { upsert: true }
  );

  await upsertOnInsert(Destination, [
    { name: "Pokhara", slug: "pokhara", province: "Gandaki", description: "A lakeside gateway to the Annapurna region.", highlights: ["Phewa Lake", "Sarangkot", "World Peace Pagoda"], tags: ["lake", "mountains", "adventure"] },
    { name: "Kathmandu", slug: "kathmandu", province: "Bagmati", description: "Nepal's historic capital and cultural hub.", highlights: ["Thamel", "Boudhanath", "Pashupatinath"], tags: ["culture", "heritage", "city"] },
    { name: "Manang", slug: "manang", province: "Gandaki", description: "A Himalayan destination on the Annapurna Circuit.", highlights: ["Mountain views", "Tilicho Lake", "Trekking"], tags: ["trekking", "mountains", "himalaya"] }
  ], (document) => ({ slug: document.slug }));

  const hotelNames = [
    "Hotel Lake Shore","Hotel Barahi","Hotel Middle Path","Hotel Pokhara View","Hotel Sarowar",
    "Lake View Resort","Green Valley Hotel","Hotel Peace Palace","The Grand Hotel","Hotel Oms Home",
    "Himalayan Serenity","Hotel Annapurna","Hotel City Centre","Hotel Alpine","Pokhara Heights",
    "Hotel Purna","Sunrise Hotel","Hotel Summit","Dhulikhel Retreat","Yeti Mountain Home",
    "Hotel Landmark","Hotel Kamana"
  ];
  await upsertOnInsert(Hotel, hotelNames.map((name, i) => ({
    name,
    location: i % 3 === 0 ? "Lakeside, Pokhara" : i % 3 === 1 ? "Kathmandu" : "Manang",
    city: i % 3 === 0 ? "Pokhara" : i % 3 === 1 ? "Kathmandu" : "Manang",
    description: "Comfortable stay for travelers exploring Nepal.",
    pricePerNight: 1800 + i * 250,
    rating: Number((4.0 + (i % 10) / 10).toFixed(1)),
    reviewCount: 10 + i * 3,
    amenities: ["WiFi", "Breakfast", "24/7 Reception"],
    isDemoData: true,
    available: true
  })), (document) => ({ name: document.name }));

  await upsertOnInsert(Restaurant, [
    { name: "Thakali Kitchen", location: "Thamel, Kathmandu", city: "Kathmandu", cuisine: ["Nepali", "Thakali"], description: "Traditional Nepali meals.", priceRange: "$$", rating: 4.5, isDemoData: true },
    { name: "Moondance Restaurant", location: "Lakeside, Pokhara", city: "Pokhara", cuisine: ["Nepali", "International"], description: "Popular Lakeside restaurant.", priceRange: "$$", rating: 4.4, isDemoData: true },
    { name: "Roadhouse Cafe", location: "Thamel, Kathmandu", city: "Kathmandu", cuisine: ["Pizza", "Cafe", "International"], description: "Casual cafe and restaurant.", priceRange: "$$", rating: 4.3, isDemoData: true }
  ], (document) => ({ name: document.name, city: document.city }));

  await upsertOnInsert(Transport, [
    { name: "Tourist Bus", type: "bus", route: "Kathmandu → Pokhara", description: "Comfortable tourist bus service.", price: 1200, isDemoData: true },
    { name: "Deluxe Bus", type: "bus", route: "Kathmandu → Pokhara", description: "Deluxe seats and improved comfort.", price: 1800, isDemoData: true },
    { name: "Jeep", type: "jeep", route: "Pokhara → Manang", description: "Shared/private jeep for mountain routes.", price: 3500, isDemoData: true },
    { name: "Bike Rental", type: "bike", route: "Pokhara", description: "Daily motorbike rental.", price: 1800, isDemoData: true },
    { name: "Private Car", type: "car", route: "Kathmandu / Pokhara", description: "Private car with driver.", price: 6500, isDemoData: true }
  ], (document) => ({ name: document.name }));

  const bookings = [
    { userId: user._id, itemType: "hotel", itemName: "Fewa Lakeside Resort", location: "Pokhara", amount: 6500, paymentMethod: "bank_card", paymentStatus: "not_configured", status: "pending", bookingCode: "SUV-1001" },
    { userId: user._id, itemType: "hotel", itemName: "Himalayan Eco Lodge", location: "Manang", amount: 7200, paymentMethod: "bank_card", paymentStatus: "not_configured", status: "pending", bookingCode: "SUV-1002" },
    { userId: user._id, itemType: "hotel", itemName: "Thamel Boutique Hotel", location: "Kathmandu", amount: 5800, paymentMethod: "bank_card", paymentStatus: "not_configured", status: "pending", bookingCode: "SUV-1003" },
    { userId: user._id, itemType: "hotel", itemName: "Boudha Stupa Stay", location: "Kathmandu", amount: 4300, paymentMethod: "bank_card", paymentStatus: "not_configured", status: "pending", bookingCode: "SUV-1004" }
  ];
  await upsertOnInsert(Booking, bookings, (document) => ({ bookingCode: document.bookingCode }));

  await upsertOnInsert(SavedItem, [
    { userId: user._id, itemType: "destination", name: "Pokhara Lakeside", location: "Pokhara" },
    { userId: user._id, itemType: "hotel", name: "Fewa Lakeside Resort", location: "Pokhara" },
    { userId: user._id, itemType: "destination", name: "Annapurna View Point", location: "Gandaki" },
    { userId: user._id, itemType: "destination", name: "Bhaktapur Heritage Walk", location: "Bhaktapur" }
  ], (document) => ({ userId: document.userId, itemType: document.itemType, name: document.name }));

  await upsertOnInsert(Notification, [
    { userId: user._id, title: "Booking Request", message: "Your Pokhara booking request is pending; payment processing is not configured.", type: "booking" },
    { userId: user._id, title: "Price Drop", message: "A saved hotel has a new lower price.", type: "price" },
    { userId: user._id, title: "Trip Reminder", message: "Your upcoming Nepal trip is coming soon.", type: "reminder" }
  ], (document) => ({ userId: document.userId, title: document.title }));

  await upsertOnInsert(Review, [
    { userId: user._id, userName: "Ramesh Thapa", itemName: "Hotel Lake Shore", itemType: "hotel", rating: 5, comment: "Great location and friendly service." },
    { userId: user._id, userName: "Anita Gurung", itemName: "Moondance Restaurant", itemType: "restaurant", rating: 4, comment: "Good food and a relaxed atmosphere." }
  ], (document) => ({ userId: document.userId, itemName: document.itemName, itemType: document.itemType }));

  const verifiedCounts = await upsertVerifiedListings();

  console.log("SuvYatra database seeded successfully without deleting existing records.", verifiedCounts);
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
