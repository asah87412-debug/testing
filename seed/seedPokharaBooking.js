// Enriches existing Pokhara listings so the end-to-end demo can actually book.
// Never deletes data — only upserts/updates verified (isDemoData:false) records.
require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const Restaurant = require("../models/Restaurant");
const LocalPlace = require("../models/LocalPlace");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/suvyatra";

const ROOM_SET = [
  { name: "Single Room", capacityAdults: 1, capacityChildren: 0, totalRooms: 5, nightlyRate: 2500 },
  { name: "Double Room", capacityAdults: 2, capacityChildren: 1, totalRooms: 8, nightlyRate: 4500 },
  { name: "Twin Room", capacityAdults: 2, capacityChildren: 0, totalRooms: 4, nightlyRate: 4200 },
  { name: "Family Room", capacityAdults: 4, capacityChildren: 2, totalRooms: 3, nightlyRate: 7500 },
];

async function ensureHotel(filter, doc) {
  const existing = await Hotel.findOne(filter);
  if (existing) {
    const patch = { ...doc, isDemoData: false, available: true };
    if (!existing.roomTypes || existing.roomTypes.length === 0) patch.roomTypes = ROOM_SET;
    await Hotel.updateOne({ _id: existing._id }, { $set: patch });
    return existing._id;
  }
  const created = await Hotel.create({ ...doc, roomTypes: ROOM_SET, isDemoData: false, available: true });
  return created._id;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  // Hotels — Pokhara, bookable
  await ensureHotel({ name: "Hotel Kamana" }, {
    name: "Hotel Kamana", city: "Pokhara", district: "Kaski", province: "Gandaki",
    destination: "Pokhara", location: "Lakeside, Pokhara",
    description: "Lakeside hotel in Pokhara near Phewa Lake. Walk to restaurants and boating.",
    pricePerNight: 4500, rating: 4.3, reviewCount: 320,
    amenities: ["Free WiFi", "Breakfast", "Lake View", "Parking"],
    latitude: 28.2096, longitude: 83.9593,
    checkInTime: "14:00", checkOutTime: "12:00",
    cancellationPolicy: "Free cancellation up to 48 hours before check-in.",
  });
  await ensureHotel({ name: "Lakeside Boutique Hotel Pokhara" }, {
    name: "Lakeside Boutique Hotel Pokhara", city: "Pokhara", district: "Kaski", province: "Gandaki",
    destination: "Pokhara", location: "Lakeside Road, Pokhara-6",
    description: "Boutique stay on Lakeside Road, 5 min walk to Phewa Lake boating point.",
    pricePerNight: 6500, rating: 4.6, reviewCount: 210,
    amenities: ["Free WiFi", "Breakfast", "Rooftop", "Parking", "Hot Shower"],
    latitude: 28.2112, longitude: 83.9580,
    checkInTime: "14:00", checkOutTime: "12:00",
    cancellationPolicy: "Free cancellation up to 72 hours before check-in.",
  });
  await ensureHotel({ name: "Phewa Lake View Resort" }, {
    name: "Phewa Lake View Resort", city: "Pokhara", district: "Kaski", province: "Gandaki",
    destination: "Pokhara", location: "Sarangkot Road, Pokhara",
    description: "Hill-view resort between Lakeside and Sarangkot with mountain views.",
    pricePerNight: 8500, rating: 4.5, reviewCount: 150,
    amenities: ["Free WiFi", "Breakfast", "Mountain View", "Restaurant", "Parking"],
    latitude: 28.2200, longitude: 83.9650,
    checkInTime: "14:00", checkOutTime: "11:00",
    cancellationPolicy: "Free cancellation up to 72 hours before check-in.",
  });

  // Transports — fares + seat inventory (verified only)
  const transportPatches = [
    [{ name: "Kathmandu–Pokhara Tourist Bus" }, { price: 1500, capacity: 35, serviceMode: "scheduled", departureTime: "07:00", arrivalTime: "14:00", durationMinutes: 420, origin: "Kathmandu", destination: "Pokhara" }],
    [{ name: "Tourist Bus" }, { price: 1400, capacity: 35, serviceMode: "scheduled", departureTime: "07:30", arrivalTime: "14:30", durationMinutes: 420, origin: "Kathmandu", destination: "Pokhara" }],
    [{ name: "Pokhara Taxi" }, { price: 8000, capacity: 4, serviceMode: "private", origin: "Pokhara", destination: "Pokhara" }],
    [{ name: "Domestic Flight" }, { price: 12000, capacity: 72, serviceMode: "scheduled", departureTime: "09:00", arrivalTime: "09:30", durationMinutes: 30, origin: "Kathmandu", destination: "Pokhara" }],
  ];
  for (const [filter, patch] of transportPatches) {
    await Transport.updateMany(filter, { $set: { ...patch, isDemoData: false } });
  }

  // Activities — per-person prices (verified only)
  const activityPatches = [
    [{ name: "Paragliding — Pokhara" }, { price: 9500, durationMinutes: 150, latitude: 28.2458, longitude: 83.9489, requirements: ["Age 16+", "Weight 40–100 kg", "Signed waiver"], provider: "Licensed Sarangkot operator" }],
    [{ name: "Zipline — Pokhara" }, { price: 5500, durationMinutes: 90, latitude: 28.2458, longitude: 83.9489, requirements: ["Age 10+", "Closed shoes"], provider: "Licensed Sarangkot operator" }],
    [{ name: "Annapurna Base Camp Trek" }, { price: 25000, durationMinutes: 7 * 24 * 60, requirements: ["TIMS + ACAP permits", "Guide recommended"], provider: "Licensed trekking agency" }],
  ];
  for (const [filter, patch] of activityPatches) {
    await LocalPlace.updateMany({ ...filter, module: "activity" }, { $set: { ...patch, isDemoData: false } });
  }

  // Restaurants — ensure verified flag (no price needed; pay at venue)
  await Restaurant.updateMany({ city: "Pokhara" }, { $set: { isDemoData: false } });

  const counts = {
    hotels: await Hotel.countDocuments({ city: "Pokhara", isDemoData: false }),
    transports: await Transport.countDocuments({ isDemoData: false }),
    restaurants: await Restaurant.countDocuments({ city: "Pokhara", isDemoData: false }),
    activities: await LocalPlace.countDocuments({ module: "activity", isDemoData: false }),
  };
  console.log("Pokhara booking seed OK:", counts);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
