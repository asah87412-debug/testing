// Destination-driven DEMO inventory seeder (generic architecture, data per destination).
//
// Usage: node seed/seedDemoDestinations.js [destination]
//   - No argument seeds every destination defined in DESTINATIONS below.
//   - Never deletes data: hotels/transports/restaurants/activities/attractions
//     are upserted by name (or slug for destinations) and flagged isDemoData:false
//     so the generic booking flows can use them.
//   - All records are DEMO inventory for the presentation workflow. They are NOT
//     real-time availability from actual businesses; the UI labels them as demo.
require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");
const Transport = require("../models/Transport");
const Restaurant = require("../models/Restaurant");
const LocalPlace = require("../models/LocalPlace");
const Destination = require("../models/Destination");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/suvyatra";

const STANDARD_TABLES = [
  { label: "T1", seats: 2 },
  { label: "T2", seats: 2 },
  { label: "T3", seats: 4 },
  { label: "T4", seats: 4 },
  { label: "T5", seats: 4 },
  { label: "T6", seats: 6 },
  { label: "T7", seats: 6 },
  { label: "T8", seats: 8 },
];

const STANDARD_ROOMS = [
  { name: "Single Room", capacityAdults: 1, capacityChildren: 0, totalRooms: 5, nightlyRate: 2500, bedConfiguration: "1 single bed", breakfastIncluded: false, amenities: ["Free WiFi", "Hot shower"] },
  { name: "Double Room", capacityAdults: 2, capacityChildren: 1, totalRooms: 8, nightlyRate: 4500, bedConfiguration: "1 double bed", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast", "Lake/Mountain view"] },
  { name: "Twin Room", capacityAdults: 2, capacityChildren: 0, totalRooms: 4, nightlyRate: 4200, bedConfiguration: "2 single beds", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast"] },
  { name: "Triple Room", capacityAdults: 3, capacityChildren: 1, totalRooms: 3, nightlyRate: 6000, bedConfiguration: "1 double + 1 single bed", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast"] },
  { name: "Family Room", capacityAdults: 4, capacityChildren: 2, totalRooms: 3, nightlyRate: 7500, bedConfiguration: "2 double beds", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast", "Sitting area"] },
];

async function upsertHotel(doc) {
  const existing = await Hotel.findOne({ name: doc.name });
  const roomTypes = doc.roomTypes && doc.roomTypes.length > 0 ? doc.roomTypes : STANDARD_ROOMS;
  if (existing) {
    const patch = { ...doc, roomTypes: existing.roomTypes && existing.roomTypes.length > 0 ? existing.roomTypes : roomTypes, isDemoData: false, available: true };
    await Hotel.updateOne({ _id: existing._id }, { $set: patch });
    return existing._id;
  }
  const created = await Hotel.create({ ...doc, roomTypes, isDemoData: false, available: true });
  return created._id;
}

async function upsertTransport(doc) {
  const existing = await Transport.findOne({ name: doc.name });
  if (existing) {
    await Transport.updateOne({ _id: existing._id }, { $set: { ...doc, isDemoData: false } });
    return existing._id;
  }
  const created = await Transport.create({ ...doc, isDemoData: false });
  return created._id;
}

async function upsertRestaurant(doc) {
  const existing = await Restaurant.findOne({ name: doc.name });
  const tables = doc.tables && doc.tables.length > 0 ? doc.tables : STANDARD_TABLES;
  if (existing) {
    const patch = { ...doc, tables: existing.tables && existing.tables.length > 0 ? existing.tables : tables, isDemoData: false };
    await Restaurant.updateOne({ _id: existing._id }, { $set: patch });
    return existing._id;
  }
  const created = await Restaurant.create({ ...doc, tables, isDemoData: false });
  return created._id;
}

async function upsertActivity(doc) {
  const existing = await LocalPlace.findOne({ name: doc.name, module: "activity" });
  if (existing) {
    await LocalPlace.updateOne({ _id: existing._id }, { $set: { ...doc, module: "activity", isDemoData: false } });
    return existing._id;
  }
  const created = await LocalPlace.create({ ...doc, module: "activity", isDemoData: false });
  return created._id;
}

async function upsertDestination(doc) {
  const existing = await Destination.findOne({ slug: doc.slug });
  if (existing) {
    await Destination.updateOne({ _id: existing._id }, { $set: doc });
    return existing._id;
  }
  const created = await Destination.create(doc);
  return created._id;
}

// Generic loader: every destination config has the same shape.
async function seedDestinationInventory(config) {
  const counts = { hotels: 0, transports: 0, restaurants: 0, activities: 0, attractions: 0 };
  for (const hotel of config.hotels || []) {
    await upsertHotel({ ...hotel, city: hotel.city || config.city, destination: config.name });
    counts.hotels += 1;
  }
  for (const transport of config.transports || []) {
    await upsertTransport(transport);
    counts.transports += 1;
  }
  for (const restaurant of config.restaurants || []) {
    await upsertRestaurant({ ...restaurant, city: restaurant.city || config.city, destination: config.name });
    counts.restaurants += 1;
  }
  for (const activity of config.activities || []) {
    await upsertActivity({ ...activity, city: activity.city || config.city, destination: config.name });
    counts.activities += 1;
  }
  for (const attraction of config.attractions || []) {
    await upsertDestination(attraction);
    counts.attractions += 1;
  }
  return counts;
}

const POKHARA = {
  name: "Pokhara",
  city: "Pokhara",
  hotels: [
    {
      name: "Hotel Kamana", location: "Lakeside, Pokhara", district: "Kaski", province: "Gandaki",
      description: "Lakeside demo hotel near Phewa Lake, walking distance to restaurants and the boating point.",
      pricePerNight: 4500, rating: 4.3, reviewCount: 320,
      amenities: ["Free WiFi", "Breakfast", "Lake View", "Parking"],
      latitude: 28.2096, longitude: 83.9593, checkInTime: "14:00", checkOutTime: "12:00",
      cancellationPolicy: "Free cancellation up to 48 hours before check-in (demo).",
      contact: { phone: "+977-61-400000", website: "https://example.com/demo" },
    },
    {
      name: "Lakeside Boutique Hotel Pokhara", location: "Lakeside Road, Pokhara-6", district: "Kaski", province: "Gandaki",
      description: "Boutique demo stay on Lakeside Road, 5 minutes on foot from the Phewa Lake boating point.",
      pricePerNight: 6500, rating: 4.6, reviewCount: 210,
      amenities: ["Free WiFi", "Breakfast", "Rooftop", "Parking", "Hot Shower"],
      latitude: 28.2112, longitude: 83.958,
      checkInTime: "14:00", checkOutTime: "12:00",
      cancellationPolicy: "Free cancellation up to 72 hours before check-in (demo).",
      contact: { phone: "+977-61-400001", website: "https://example.com/demo" },
    },
    {
      name: "Phewa Lake View Resort", location: "Sarangkot Road, Pokhara", district: "Kaski", province: "Gandaki",
      description: "Hill-view demo resort between Lakeside and Sarangkot with mountain views.",
      pricePerNight: 8500, rating: 4.5, reviewCount: 150,
      amenities: ["Free WiFi", "Breakfast", "Mountain View", "Restaurant", "Parking"],
      latitude: 28.22, longitude: 83.965,
      checkInTime: "14:00", checkOutTime: "11:00",
      cancellationPolicy: "Free cancellation up to 72 hours before check-in (demo).",
      contact: { phone: "+977-61-400002", website: "https://example.com/demo" },
    },
  ],
  transports: [
    { name: "Kathmandu–Pokhara Tourist Bus", type: "Tourist bus", provider: "Demo Travels", origin: "Kathmandu", destination: "Pokhara", route: "Kathmandu → Pokhara", departureTime: "07:00", arrivalTime: "14:00", durationMinutes: 420, price: 1500, capacity: 36, serviceMode: "scheduled", seatMap: { rows: 9, seatsPerRow: 4 }, amenities: ["AC", "WiFi", "Lunch stop"], cancellationPolicy: "Full refund up to 24h before departure (demo).", description: "Demo daytime tourist bus from Kathmandu to Pokhara." },
    { name: "Pokhara–Kathmandu Tourist Bus", type: "Tourist bus", provider: "Demo Travels", origin: "Pokhara", destination: "Kathmandu", route: "Pokhara → Kathmandu", departureTime: "07:30", arrivalTime: "14:30", durationMinutes: 420, price: 1500, capacity: 36, serviceMode: "scheduled", seatMap: { rows: 9, seatsPerRow: 4 }, amenities: ["AC", "WiFi", "Lunch stop"], cancellationPolicy: "Full refund up to 24h before departure (demo).", description: "Demo return tourist bus from Pokhara to Kathmandu." },
    { name: "Pokhara Local Bus", type: "Local bus", provider: "Demo Yatayat", origin: "Lakeside, Pokhara", destination: "Sarangkot, Pokhara", route: "Lakeside → Sarangkot", departureTime: "08:00", arrivalTime: "09:00", durationMinutes: 60, price: 300, capacity: 25, serviceMode: "shared", seatMap: { rows: 5, seatsPerRow: 5 }, amenities: [], cancellationPolicy: "Tickets are flexible on the day of travel (demo).", description: "Demo shared local bus around Pokhara." },
    { name: "Pokhara Private Car", type: "Private car", provider: "Demo Rentals", origin: "Pokhara", destination: "Pokhara", route: "Pokhara local hire", price: 6000, capacity: 4, serviceMode: "private", amenities: ["AC", "Driver included"], cancellationPolicy: "Free cancellation up to 12h before pickup (demo).", description: "Demo private car with driver for local sightseeing." },
    { name: "Pokhara Jeep Rental", type: "Jeep", provider: "Demo Rentals", origin: "Pokhara", destination: "Pokhara", route: "Pokhara off-road hire", price: 9000, capacity: 7, serviceMode: "rental", amenities: ["4WD", "Driver included"], cancellationPolicy: "Free cancellation up to 24h before pickup (demo).", description: "Demo 4WD jeep for hill tracks around Pokhara." },
    { name: "Pokhara Taxi", type: "Taxi", provider: "Demo Cabs", origin: "Pokhara", destination: "Pokhara", route: "Pokhara local taxi", price: 8000, capacity: 4, serviceMode: "private", amenities: ["Metered estimate"], cancellationPolicy: "Pay the driver after the ride (demo).", description: "Demo taxi reference for Pokhara; confirm fare with the driver." },
    { name: "Pokhara Airport Transfer", type: "Airport transfer", provider: "Demo Transfers", origin: "Pokhara Airport", destination: "Lakeside, Pokhara", route: "Pokhara Airport → Lakeside", price: 1500, capacity: 4, serviceMode: "private", amenities: ["Meet & greet", "AC"], cancellationPolicy: "Free cancellation up to 6h before pickup (demo).", description: "Demo airport pickup from Pokhara Airport to Lakeside." },
    { name: "Domestic Flight", type: "Flight", provider: "Demo Airlines", origin: "Kathmandu", destination: "Pokhara", route: "Kathmandu → Pokhara", departureTime: "09:00", arrivalTime: "09:30", durationMinutes: 30, price: 12000, capacity: 72, serviceMode: "scheduled", seatMap: { rows: 18, seatsPerRow: 4 }, amenities: ["15kg baggage"], cancellationPolicy: "Airline fare rules apply (demo).", description: "Demo domestic flight reference; check the airline for live schedules." },
  ],
  restaurants: [
    { name: "Moondance Restaurant", location: "Lakeside, Pokhara", cuisine: ["Nepali", "International"], description: "Demo restaurant listing in Pokhara's Lakeside area.", priceRange: "NPR 500–1500", rating: 4.4, reviewCount: 180, facilities: ["Outdoor seating", "Family friendly"], openingHours: { daily: "08:00-22:00" }, tables: STANDARD_TABLES },
    { name: "Fresh Elements Restaurant", location: "Lakeside, Pokhara", cuisine: ["Nepali", "International"], description: "Demo restaurant listing in Pokhara's Lakeside area.", priceRange: "NPR 400–1200", rating: 4.2, reviewCount: 120, facilities: ["Garden seating"], openingHours: { daily: "09:00-21:30" }, tables: STANDARD_TABLES },
    { name: "Pokhara Java", location: "Lakeside, Pokhara", cuisine: ["Cafe", "Coffee"], description: "Demo cafe in Pokhara's Lakeside area.", priceRange: "NPR 250–800", rating: 4.5, reviewCount: 200, facilities: ["WiFi", "Bakery"], openingHours: { daily: "07:00-21:00" }, tables: STANDARD_TABLES.slice(0, 6) },
    { name: "Lakeside Thakali House", location: "Lakeside, Pokhara", cuisine: ["Nepali", "Thakali"], description: "Demo Thakali kitchen serving dal-bhat sets near the lake.", priceRange: "NPR 350–900", rating: 4.3, reviewCount: 95, facilities: ["Family friendly"], openingHours: { daily: "10:00-22:00" }, tables: STANDARD_TABLES },
  ],
  activities: [
    { name: "Paragliding — Pokhara", location: "Sarangkot, Pokhara", category: "Adventure", description: "Demo tandem paragliding from Sarangkot with views over Pokhara and Phewa Lake.", price: 9500, durationMinutes: 150, slots: ["09:00", "11:00", "14:00"], capacityPerSlot: 8, meetingPoint: "Sarangkot takeoff point", includedServices: ["Pilot", "Safety briefing", "Insurance"], cancellationPolicy: "Weather-dependent; full refund if the pilot cancels (demo).", requirements: ["Age 16+", "Weight 40–100 kg", "Signed waiver"], provider: "Licensed Sarangkot operator (demo)", latitude: 28.2458, longitude: 83.9489 },
    { name: "Zipline — Pokhara", location: "Sarangkot, Pokhara", category: "Adventure", description: "Demo zipline activity near Sarangkot.", price: 5500, durationMinutes: 90, slots: ["09:30", "12:30", "15:30"], capacityPerSlot: 12, meetingPoint: "Zipline base station, Sarangkot", includedServices: ["Harness", "Guide"], cancellationPolicy: "Weather-dependent (demo).", requirements: ["Age 10+", "Closed shoes"], provider: "Licensed operator (demo)", latitude: 28.2458, longitude: 83.9489 },
    { name: "Phewa Lake Boating", location: "Phewa Lake, Pokhara", category: "Boating", description: "Demo row-boat rental on Phewa Lake with views of the Annapurna range.", price: 1500, durationMinutes: 120, slots: ["06:00", "09:00", "13:00", "16:00"], capacityPerSlot: 20, meetingPoint: "Phewa Lake boating point, Lakeside", includedServices: ["Boat", "Life jackets"], cancellationPolicy: "Weather-dependent (demo).", provider: "Boating association (demo)", latitude: 28.2156, longitude: 83.942 },
    { name: "Sarangkot Sunrise Tour", location: "Sarangkot, Pokhara", category: "Sightseeing", description: "Demo guided sunrise viewpoint tour above Pokhara.", price: 2000, durationMinutes: 240, slots: ["05:00"], capacityPerSlot: 15, meetingPoint: "Hotel pickup, Lakeside", includedServices: ["Transport", "Guide", "Hot tea"], cancellationPolicy: "Full refund if cancelled 24h ahead (demo).", provider: "Demo Tours", latitude: 28.2444, longitude: 83.9475 },
    { name: "Mountain Museum Visit", location: "Rato Pairo, Pokhara", category: "Museum", description: "Demo guided visit to the International Mountain Museum.", price: 800, durationMinutes: 120, slots: ["09:00", "11:00", "14:00"], capacityPerSlot: 30, meetingPoint: "Museum entrance", includedServices: ["Entry ticket", "Guide"], cancellationPolicy: "Tickets are date-flexible (demo).", provider: "Demo Tours", latitude: 28.1907, longitude: 83.9823 },
    { name: "Pokhara Cycling Tour", location: "Lakeside, Pokhara", category: "Cycling", description: "Demo guided cycling loop around lakes and villages.", price: 2500, durationMinutes: 300, slots: ["07:00", "14:00"], capacityPerSlot: 10, meetingPoint: "Cycle shop, Lakeside", includedServices: ["Bicycle", "Helmet", "Guide"], cancellationPolicy: "Full refund if cancelled 24h ahead (demo).", provider: "Demo Adventures", latitude: 28.2112, longitude: 83.958 },
  ],
  attractions: [
    { name: "Phewa Lake", slug: "phewa-lake", description: "The largest lake in Pokhara, famous for boating and reflections of the Annapurna range.", province: "Gandaki", highlights: ["Boating", "Tal Barahi Temple", "Sunset views"], latitude: 28.2156, longitude: 83.942, estimatedDuration: "2–3 hours", bestTimeToVisit: "October–April, early morning", approximateCost: "Boat rental varies by boat size", whyVisit: "Iconic lake experience with mountain reflections.", safetyInfo: "Wear a life jacket; avoid the lake in storms.", nearbyFacilities: ["Lakeside restaurants", "Boating point", "ATMs"], tags: ["popular"] },
    { name: "Sarangkot", slug: "sarangkot", description: "Hilltop viewpoint above Pokhara known for sunrise over Annapurna and Dhaulagiri.", province: "Gandaki", highlights: ["Sunrise", "Paragliding takeoff", "Panoramic Himalaya views"], latitude: 28.2444, longitude: 83.9475, estimatedDuration: "Half day", bestTimeToVisit: "October–April, sunrise", approximateCost: "Transport + viewpoint entry varies", whyVisit: "The classic Pokhara sunrise viewpoint.", safetyInfo: "Bring warm layers; roads are steep.", nearbyFacilities: ["View tower", "Tea houses", "Parking"], tags: ["popular"] },
    { name: "World Peace Pagoda", slug: "world-peace-pagoda", description: "Buddhist stupa on a hill south of Phewa Lake with panoramic views.", province: "Gandaki", highlights: ["Stupa", "Lake + mountain views", "Forest walk"], latitude: 28.2011, longitude: 83.948, estimatedDuration: "2–3 hours", bestTimeToVisit: "Morning, October–April", approximateCost: "Free entry; transport varies", whyVisit: "Peaceful stupa with the best lake panorama.", safetyInfo: "Stay on marked trails.", nearbyFacilities: ["Cafes", "Hiking trails"], tags: ["popular"] },
    { name: "Davis Falls", slug: "davis-falls", description: "Waterfall that plunges into an underground tunnel, at its most dramatic in monsoon.", province: "Gandaki", highlights: ["Waterfall", "Underground tunnel"], latitude: 28.1901, longitude: 84.001, entryFee: "Small entry fee applies", estimatedDuration: "1 hour", bestTimeToVisit: "July–September for full flow", whyVisit: "Unique waterfall-to-tunnel formation.", safetyInfo: "Do not climb barriers near the water.", nearbyFacilities: ["Gupteshwor Cave (opposite road)", "Shops"], tags: ["popular"] },
    { name: "Gupteshwor Cave", slug: "gupteshwor-cave", description: "Sacred cave with a Shiva shrine and an underground waterfall section.", province: "Gandaki", highlights: ["Cave shrine", "Underground falls"], latitude: 28.1907, longitude: 83.9995, entryFee: "Small entry fee applies", estimatedDuration: "1 hour", bestTimeToVisit: "Year-round; slippery in monsoon", whyVisit: "Spiritual cave experience opposite Davis Falls.", safetyInfo: "Steps are slippery; wear grip shoes.", nearbyFacilities: ["Davis Falls", "Shops"], tags: ["popular"] },
    { name: "International Mountain Museum", slug: "international-mountain-museum", description: "Museum documenting Himalayan mountaineering history, culture and geology.", province: "Gandaki", highlights: ["Climbing history", "Cultural exhibits"], latitude: 28.1907, longitude: 83.9823, entryFee: "Ticketed entry", estimatedDuration: "2 hours", bestTimeToVisit: "Year-round, 9am–5pm typical", whyVisit: "Best museum on Himalayan culture in Nepal.", nearbyFacilities: ["Cafe", "Souvenir shop", "Parking"], tags: ["popular"] },
    { name: "Begnas Lake", slug: "begnas-lake", description: "Quieter lake east of Pokhara, good for boating and village walks.", province: "Gandaki", highlights: ["Boating", "Village walks", "Fishing"], latitude: 28.1789, longitude: 84.0903, estimatedDuration: "Half day", bestTimeToVisit: "October–April", approximateCost: "Transport + boat rental varies", whyVisit: "Peaceful alternative to Phewa Lake.", nearbyFacilities: ["Local eateries", "Boats"], tags: ["popular"] },
    { name: "Bindhyabasini Temple", slug: "bindhyabasini-temple", description: "Important Hindu temple in Pokhara dedicated to Goddess Bhagwati.", province: "Gandaki", highlights: ["Temple", "City views", "Festivals"], latitude: 28.2395, longitude: 83.988, estimatedDuration: "1 hour", bestTimeToVisit: "Morning; Tuesdays and Saturdays are busy", whyVisit: "Pokhara's most significant Hindu shrine.", safetyInfo: "Dress respectfully; remove leather items as customary.", nearbyFacilities: ["Old bazaar", "Shops"], tags: ["popular"] },
    { name: "Kahun Danda", slug: "kahun-danda", description: "Quiet ridge viewpoint east of Pokhara with sunrise views and few crowds.", province: "Gandaki", highlights: ["Sunrise", "Quiet trails"], latitude: 28.2655, longitude: 84.0125, estimatedDuration: "Half day", bestTimeToVisit: "October–April, sunrise", approximateCost: "Local transport only", whyVisit: "Sarangkot views without the crowds.", safetyInfo: "Go with a local guide before dawn.", nearbyFacilities: ["Tea houses"], tags: ["hidden"] },
    { name: "Seti River Gorge", slug: "seti-river-gorge", description: "Deep narrow gorge of the milky Seti River cutting through Pokhara.", province: "Gandaki", highlights: ["Gorge viewpoints", "Suspension bridges"], latitude: 28.2234, longitude: 83.9912, estimatedDuration: "1–2 hours", bestTimeToVisit: "Year-round", approximateCost: "Free viewpoints", whyVisit: "A hidden geological wonder inside the city.", safetyInfo: "Keep behind railings; rocks are slippery.", nearbyFacilities: ["Mahendra Pul market"], tags: ["hidden"] },
    { name: "Matepani Monastery", slug: "matepani-monastery", description: "Large Buddhist monastery on a hill east of Pokhara with city views.", province: "Gandaki", highlights: ["Monastery", "City views", "Morning prayers"], latitude: 28.2355, longitude: 84.0065, estimatedDuration: "1–2 hours", bestTimeToVisit: "Morning prayers", approximateCost: "Free; donations welcome", whyVisit: "Serene monastery life above the city.", safetyInfo: "Ask before photographing monks.", nearbyFacilities: ["Tea shops"], tags: ["hidden"] },
    { name: "Rupa Lake", slug: "rupa-lake", description: "The third major lake near Pokhara, ringed by the Rupa village and wetlands.", province: "Gandaki", highlights: ["Birdwatching", "Village homestays", "Boating"], latitude: 28.1578, longitude: 84.1042, estimatedDuration: "Half day", bestTimeToVisit: "October–March", approximateCost: "Transport + boat rental varies", whyVisit: "Bird-rich wetland lake off the tourist trail.", nearbyFacilities: ["Homestays", "Boats"], tags: ["hidden"] },
  ],
};

const KATHMANDU = {
  name: "Kathmandu",
  city: "Kathmandu",
  hotels: [
    {
      name: "Thamel Boutique Stay", location: "Thamel, Kathmandu", district: "Kathmandu", province: "Bagmati",
      description: "Demo boutique stay in the Thamel tourist district.",
      pricePerNight: 5500, rating: 4.4, reviewCount: 160,
      amenities: ["Free WiFi", "Breakfast", "Rooftop"],
      latitude: 27.7154, longitude: 85.3125, checkInTime: "14:00", checkOutTime: "12:00",
      cancellationPolicy: "Free cancellation up to 48 hours before check-in (demo).",
      contact: { phone: "+977-1-400000", website: "https://example.com/demo" },
      roomTypes: STANDARD_ROOMS.slice(0, 3),
    },
    {
      name: "Boudha View Hotel", location: "Boudhanath, Kathmandu", district: "Kathmandu", province: "Bagmati",
      description: "Demo hotel near the Boudhanath Stupa with rooftop stupa views.",
      pricePerNight: 6000, rating: 4.5, reviewCount: 140,
      amenities: ["Free WiFi", "Breakfast", "Rooftop", "Stupa view"],
      latitude: 27.7215, longitude: 85.362, checkInTime: "14:00", checkOutTime: "11:00",
      cancellationPolicy: "Free cancellation up to 72 hours before check-in (demo).",
      contact: { phone: "+977-1-400001", website: "https://example.com/demo" },
      roomTypes: STANDARD_ROOMS.slice(1, 5),
    },
  ],
  transports: [
    { name: "Kathmandu Airport Transfer", type: "Airport transfer", provider: "Demo Transfers", origin: "Tribhuvan Airport", destination: "Thamel, Kathmandu", route: "Airport → Thamel", price: 1500, capacity: 4, serviceMode: "private", amenities: ["Meet & greet", "AC"], cancellationPolicy: "Free cancellation up to 6h before pickup (demo).", description: "Demo airport pickup to Thamel." },
    { name: "Kathmandu–Pokhara Tourist Bus", type: "Tourist bus", provider: "Demo Travels", origin: "Kathmandu", destination: "Pokhara", route: "Kathmandu → Pokhara", departureTime: "07:00", arrivalTime: "14:00", durationMinutes: 420, price: 1500, capacity: 36, serviceMode: "scheduled", seatMap: { rows: 9, seatsPerRow: 4 }, amenities: ["AC", "WiFi", "Lunch stop"], cancellationPolicy: "Full refund up to 24h before departure (demo).", description: "Demo daytime tourist bus from Kathmandu to Pokhara." },
  ],
  restaurants: [
    { name: "Thamel House Restaurant", location: "Thamel, Kathmandu", cuisine: ["Nepali", "Newari"], description: "Demo Nepali restaurant in Thamel.", priceRange: "NPR 400–1200", rating: 4.3, reviewCount: 150, facilities: ["Cultural shows"], openingHours: { daily: "10:00-22:00" }, tables: STANDARD_TABLES },
  ],
  activities: [
    { name: "Heritage Walk — Kathmandu Durbar Square", location: "Durbar Square, Kathmandu", category: "Cultural", description: "Demo guided heritage walk through palaces, temples and courtyards.", price: 1800, durationMinutes: 180, slots: ["09:00", "14:00"], capacityPerSlot: 15, meetingPoint: "Hanuman Dhoka entrance", includedServices: ["Guide", "Entry assistance"], cancellationPolicy: "Full refund if cancelled 24h ahead (demo).", provider: "Demo Tours", latitude: 27.7042, longitude: 85.3067 },
  ],
  attractions: [
    { name: "Boudhanath Stupa", slug: "boudhanath-stupa", description: "One of the largest stupas in Nepal and a center of Tibetan Buddhism.", province: "Bagmati", highlights: ["Stupa", "Monasteries", "Kora walk"], latitude: 27.7215, longitude: 85.362, estimatedDuration: "2 hours", bestTimeToVisit: "Morning or evening prayers", entryFee: "Small entry fee applies", whyVisit: "Spiritual heart of Kathmandu.", nearbyFacilities: ["Rooftop cafes", "Monasteries"], tags: ["popular"] },
    { name: "Garden of Dreams", slug: "garden-of-dreams", description: "Neoclassical garden oasis in central Kathmandu.", province: "Bagmati", highlights: ["Gardens", "Cafe", "Architecture"], latitude: 27.7142, longitude: 85.314, estimatedDuration: "1–2 hours", bestTimeToVisit: "Afternoon", entryFee: "Small entry fee applies", whyVisit: "Peaceful garden escape in the city.", nearbyFacilities: ["Kaiser Cafe"], tags: ["hidden"] },
  ],
};

const DESTINATIONS = { Pokhara: POKHARA, Kathmandu: KATHMANDU };

async function run() {
  const only = process.argv[2];
  await mongoose.connect(MONGO_URI);
  const targets = only ? { [only]: DESTINATIONS[only] } : DESTINATIONS;
  if (only && !targets[only]) {
    console.error(`Unknown destination "${only}". Available: ${Object.keys(DESTINATIONS).join(", ")}`);
    process.exit(1);
  }
  for (const [key, config] of Object.entries(targets)) {
    const counts = await seedDestinationInventory(config);
    console.log(`Demo inventory OK for ${key}:`, counts);
  }
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
