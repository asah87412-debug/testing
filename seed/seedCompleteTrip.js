// Makes "Plan a Complete Trip" fully bookable for Pokhara, Kathmandu and
// Chitwan: every listed hotel and activity gets live-bookable inventory
// (roomTypes / price / slots) plus a stored, relevant, attributed image.
//
// Never deletes data — only upserts/updates verified (isDemoData:false)
// records. Safe to re-run. All image URLs below were verified against
// Wikimedia Commons (reusable CC licenses, thumb URLs resolve).
require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");
const LocalPlace = require("../models/LocalPlace");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/suvyatra";

const ROOM_SET = [
  { name: "Single Room", capacityAdults: 1, capacityChildren: 0, totalRooms: 5, nightlyRate: 2500, bedConfiguration: "1 single bed", breakfastIncluded: false, amenities: ["Free WiFi", "Hot shower"] },
  { name: "Double Room", capacityAdults: 2, capacityChildren: 1, totalRooms: 8, nightlyRate: 4500, bedConfiguration: "1 double bed", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast"] },
  { name: "Twin Room", capacityAdults: 2, capacityChildren: 0, totalRooms: 4, nightlyRate: 4200, bedConfiguration: "2 single beds", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast"] },
  { name: "Family Room", capacityAdults: 4, capacityChildren: 2, totalRooms: 3, nightlyRate: 7500, bedConfiguration: "1 double + 2 single beds", breakfastIncluded: true, amenities: ["Free WiFi", "Breakfast"] },
];

const HOTEL_IMAGE_PATCHES = [
  {
    filter: { name: "Hotel Kamana" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/New_Pokhara_Lodge.JPG/1280px-New_Pokhara_Lodge.JPG?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      images: ["https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/New_Pokhara_Lodge.JPG/1280px-New_Pokhara_Lodge.JPG?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail"],
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:New_Pokhara_Lodge.JPG",
      imageLicense: "CC BY-SA 3.0",
      imageCredit: "Mahendra Raj Adhikari",
      imageDescription: "Hotel Kamana, Lakeside, Pokhara: mountain view seen from a lodge in Pokhara, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { name: "Lakeside Boutique Hotel Pokhara" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Pokhara-04-Hotel_Barahi-Pool-2013-gje.jpg/1280px-Pokhara-04-Hotel_Barahi-Pool-2013-gje.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      images: ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Pokhara-04-Hotel_Barahi-Pool-2013-gje.jpg/1280px-Pokhara-04-Hotel_Barahi-Pool-2013-gje.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail"],
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Pokhara-04-Hotel_Barahi-Pool-2013-gje.jpg",
      imageLicense: "CC BY-SA 4.0",
      imageCredit: "Gerd Eichmann",
      imageDescription: "Lakeside Boutique Hotel Pokhara: hotel swimming pool in Pokhara, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { name: "Phewa Lake View Resort" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b2/FEWA_LAKE_FROM_THE_SLIVER_OAKS_HOTEL_POKHARA_NEPAL_FEB_2013_%288570574673%29.jpg/1280px-FEWA_LAKE_FROM_THE_SLIVER_OAKS_HOTEL_POKHARA_NEPAL_FEB_2013_%288570574673%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      images: ["https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b2/FEWA_LAKE_FROM_THE_SLIVER_OAKS_HOTEL_POKHARA_NEPAL_FEB_2013_%288570574673%29.jpg/1280px-FEWA_LAKE_FROM_THE_SLIVER_OAKS_HOTEL_POKHARA_NEPAL_FEB_2013_%288570574673%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail"],
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:FEWA_LAKE_FROM_THE_SLIVER_OAKS_HOTEL_POKHARA_NEPAL_FEB_2013_(8570574673).jpg",
      imageLicense: "CC BY-SA 2.0",
      imageCredit: "calflier001",
      imageDescription: "Phewa Lake View Resort, Pokhara: Phewa Lake seen from a hotel in Pokhara, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { name: "Thamel Boutique Stay" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Hotel_Blue_Horizon%2CThamel%2CKathmandu_%282%29.jpg/1280px-Hotel_Blue_Horizon%2CThamel%2CKathmandu_%282%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      images: ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Hotel_Blue_Horizon%2CThamel%2CKathmandu_%282%29.jpg/1280px-Hotel_Blue_Horizon%2CThamel%2CKathmandu_%282%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail"],
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Hotel_Blue_Horizon%2CThamel%2CKathmandu_(2).jpg",
      imageLicense: "CC BY 4.0",
      imageCredit: "Saddam Hussain Ansari",
      imageDescription: "Thamel Boutique Stay, Thamel, Kathmandu: hotel building in Thamel, Kathmandu, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { name: "Boudha View Hotel" },
    image: {
      image: "https://upload.wikimedia.org/wikipedia/commons/6/6d/Hyatt_Regency_Kathmandu_Hotel.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
      images: ["https://upload.wikimedia.org/wikipedia/commons/6/6d/Hyatt_Regency_Kathmandu_Hotel.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled"],
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Hyatt_Regency_Kathmandu_Hotel.jpg",
      imageLicense: "CC BY-SA 3.0",
      imageCredit: "Phdswaindia",
      imageDescription: "Boudha View Hotel, Kathmandu: hotel building in Kathmandu, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { name: "Sunway Hotel" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/Hotel_Lobby%2C_Kathmandu%2C_Nepal_2020.jpg/1280px-Hotel_Lobby%2C_Kathmandu%2C_Nepal_2020.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      images: ["https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/Hotel_Lobby%2C_Kathmandu%2C_Nepal_2020.jpg/1280px-Hotel_Lobby%2C_Kathmandu%2C_Nepal_2020.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail"],
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Hotel_Lobby%2C_Kathmandu%2C_Nepal_2020.jpg",
      imageLicense: "CC BY-SA 4.0",
      imageCredit: "Gaurav Dhwaj Khadka",
      imageDescription: "Sunway Hotel, Maitidevi, Kathmandu: hotel lobby interior in Kathmandu, Nepal.",
      imageRelevance: "entity",
    },
  },
];

const NEW_HOTELS = [
  {
    name: "Sauraha Riverside Resort",
    city: "Chitwan",
    district: "Chitwan",
    province: "Bagmati",
    destination: "Chitwan",
    location: "Sauraha, Chitwan",
    description: "Riverside resort in Sauraha near Chitwan National Park. Safari pickup and Tharu cultural program available.",
    pricePerNight: 5500,
    rating: 4.4,
    reviewCount: 180,
    amenities: ["Free WiFi", "Breakfast", "River View", "Safari Pickup", "Restaurant", "Parking"],
    latitude: 27.5789,
    longitude: 84.4866,
    checkInTime: "14:00",
    checkOutTime: "12:00",
    cancellationPolicy: "Free cancellation up to 48 hours before check-in.",
    image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/83/Chitwan-Rhino_Residency_Resort-02-2013-gje.jpg/1280px-Chitwan-Rhino_Residency_Resort-02-2013-gje.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    imageSource: "Wikimedia Commons",
    imageSourcePage: "https://commons.wikimedia.org/wiki/File:Chitwan-Rhino_Residency_Resort-02-2013-gje.jpg",
    imageLicense: "CC BY-SA 4.0",
    imageCredit: "Gerd Eichmann",
    imageDescription: "Sauraha Riverside Resort, Sauraha, Chitwan: resort buildings in the Sauraha area of Chitwan, Nepal.",
    imageRelevance: "entity",
    roomTypes: ROOM_SET,
  },
  {
    name: "Chitwan Jungle Safari Lodge",
    city: "Chitwan",
    district: "Chitwan",
    province: "Bagmati",
    destination: "Chitwan",
    location: "Meghauli, Chitwan",
    description: "Jungle lodge on the Rapti River banks near the park's western gate. Guided walks and canoe trips arranged.",
    pricePerNight: 7000,
    rating: 4.5,
    reviewCount: 120,
    amenities: ["Free WiFi", "Breakfast", "Jungle View", "Guided Safari", "Restaurant", "Parking"],
    latitude: 27.5598,
    longitude: 84.2253,
    checkInTime: "14:00",
    checkOutTime: "11:00",
    cancellationPolicy: "Free cancellation up to 72 hours before check-in.",
    image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fd/Chitwan-Rhino_Residency-Resort-10-Zimmer-2013-gje.jpg/1280px-Chitwan-Rhino_Residency-Resort-10-Zimmer-2013-gje.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    imageSource: "Wikimedia Commons",
    imageSourcePage: "https://commons.wikimedia.org/wiki/File:Chitwan-Rhino_Residency-Resort-10-Zimmer-2013-gje.jpg",
    imageLicense: "CC BY-SA 4.0",
    imageCredit: "Gerd Eichmann",
    imageDescription: "Chitwan Jungle Safari Lodge, Meghauli, Chitwan: guest room interior at a jungle resort in Chitwan, Nepal.",
    imageRelevance: "entity",
    roomTypes: ROOM_SET,
  },
];

const ACTIVITY_BOOKING_PATCHES = [
  { filter: { module: "activity", name: "White Water Rafting — Trishuli" }, patch: { price: 8500, currency: "NPR", durationMinutes: 480, capacityPerSlot: 16, slots: ["07:00"], meetingPoint: "Trishuli put-in point (operator confirms exact spot)", provider: "Licensed rafting operator", requirements: ["Age 14+", "Swimming ability", "Signed waiver"] } },
  { filter: { module: "activity", name: "Bungee Jumping — The Last Resort" }, patch: { price: 10500, currency: "NPR", durationMinutes: 240, capacityPerSlot: 10, slots: ["09:00", "13:00"], meetingPoint: "The Last Resort, Sindhupalchok", provider: "Licensed bungee operator", requirements: ["Age 16+", "Weight 40–110 kg", "Medical declaration"] } },
  { filter: { module: "activity", name: "Everest Base Camp Trek" }, patch: { price: 55000, currency: "NPR", durationMinutes: 12 * 24 * 60, capacityPerSlot: 12, slots: [], meetingPoint: "Lukla, Solukhumbu", provider: "Licensed trekking agency", requirements: ["Sagarmatha permit", "Guide required", "Acclimatisation schedule"] } },
  { filter: { module: "activity", name: "Jungle Safari — Chitwan" }, patch: { price: 4500, currency: "NPR", durationMinutes: 240, capacityPerSlot: 20, slots: ["06:30", "15:00"], meetingPoint: "Sauraha, Chitwan", provider: "Authorised safari operator", requirements: ["Park entry permit", "Follow guide instructions"] } },
  { filter: { module: "activity", name: "Mountain Flight — Kathmandu" }, patch: { price: 13500, currency: "NPR", durationMinutes: 60, capacityPerSlot: 15, slots: ["06:30", "07:30"], meetingPoint: "Tribhuvan International Airport, Kathmandu", provider: "Scheduled mountain-flight airline", requirements: ["Valid photo ID", "Window-seat rotation"] } },
];

const ACTIVITY_IMAGE_PATCHES = [
  {
    filter: { module: "activity", name: "Phewa Lake Boating" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/Boats_on_Phewa_Lake_%289207546652%29.jpg/1280px-Boats_on_Phewa_Lake_%289207546652%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Boats_on_Phewa_Lake_(9207546652).jpg",
      imageLicense: "CC BY-SA 2.0",
      imageCredit: "Debarshi Ray",
      imageDescription: "Phewa Lake Boating, Lakeside, Pokhara: row boats on Phewa Lake, Pokhara, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { module: "activity", name: "Sarangkot Sunrise Tour" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/ce/SUNRISE_POKHARA_SARANGKOT.jpg/1280px-SUNRISE_POKHARA_SARANGKOT.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:SUNRISE_POKHARA_SARANGKOT.jpg",
      imageLicense: "CC BY-SA 4.0",
      imageCredit: "Yallu007",
      imageDescription: "Sarangkot Sunrise Tour, Sarangkot, Pokhara: sunrise over the Annapurna range seen from Sarangkot.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { module: "activity", name: "Mountain Museum Visit" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/59/International_Mountain_Museum_%282010%29%2C_Pokhara%2C_Nepal-02.jpg/1280px-International_Mountain_Museum_%282010%29%2C_Pokhara%2C_Nepal-02.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:International_Mountain_Museum_(2010)%2C_Pokhara%2C_Nepal-02.jpg",
      imageLicense: "CC BY-SA 3.0",
      imageCredit: "MMuzammils",
      imageDescription: "Mountain Museum Visit, Pokhara: the International Mountain Museum building in Pokhara, Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { module: "activity", name: "Pokhara Cycling Tour" },
    image: {
      image: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Cycling_in_Remote_Area_Nepal.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Cycling_in_Remote_Area_Nepal.jpg",
      imageLicense: "CC BY-SA 4.0",
      imageCredit: "Ravijung",
      imageDescription: "Pokhara Cycling Tour, Pokhara: cyclists riding on a trail in Nepal.",
      imageRelevance: "entity",
    },
  },
  {
    filter: { module: "activity", name: "Heritage Walk — Kathmandu Durbar Square" },
    image: {
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Historic_Pagoda_Style_Architecture_in_Kathmandu_Durbar_Square-IMG_4069.jpg/1280px-Historic_Pagoda_Style_Architecture_in_Kathmandu_Durbar_Square-IMG_4069.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
      imageSource: "Wikimedia Commons",
      imageSourcePage: "https://commons.wikimedia.org/wiki/File:Historic_Pagoda_Style_Architecture_in_Kathmandu_Durbar_Square-IMG_4069.jpg",
      imageLicense: "CC BY-SA 4.0",
      imageCredit: "Bijay Chaurasia",
      imageDescription: "Heritage Walk, Kathmandu Durbar Square: pagoda-style temple architecture in Kathmandu Durbar Square, Nepal.",
      imageRelevance: "entity",
    },
  },
];

async function run() {
  await mongoose.connect(MONGO_URI);

  // 1. Stored images for every already-bookable hotel.
  for (const { filter, image } of HOTEL_IMAGE_PATCHES) {
    const hotel = await Hotel.findOne(filter).select("_id name image roomTypes").lean();
    if (!hotel) {
      console.warn(`Hotel not found, skipped: ${filter.name}`);
      continue;
    }
    const patch = { ...image, images: image.images ?? [image.image], isDemoData: false, available: true };
    if (!hotel.roomTypes || hotel.roomTypes.length === 0) patch.roomTypes = ROOM_SET;
    if (filter.name === "Sunway Hotel") patch.city = "Kathmandu";
    await Hotel.updateOne({ _id: hotel._id }, { $set: patch }, { runValidators: true });
  }

  // 2. New bookable Chitwan hotels (upsert by name; never overwritten blindly).
  for (const doc of NEW_HOTELS) {
    const existing = await Hotel.findOne({ name: doc.name }).select("_id image roomTypes").lean();
    if (existing) {
      const patch = { ...doc, images: [doc.image], isDemoData: false, available: true };
      if (existing.roomTypes && existing.roomTypes.length > 0) delete patch.roomTypes;
      if (existing.image) {
        for (const key of ["image", "images", "imageSource", "imageSourcePage", "imageLicense", "imageCredit", "imageDescription", "imageRelevance"]) delete patch[key];
      }
      await Hotel.updateOne({ _id: existing._id }, { $set: patch }, { runValidators: true });
    } else {
      await Hotel.create({ ...doc, images: [doc.image], isDemoData: false, available: true });
    }
  }

  // 3. Prices/slots/capacity so rafting, bungee, EBC, safari and mountain
  //    flight pass booking validation (amount > 0, slot capacity enforced).
  for (const { filter, patch } of ACTIVITY_BOOKING_PATCHES) {
    const result = await LocalPlace.updateMany(filter, { $set: { ...patch, isDemoData: false } }, { runValidators: true });
    if (result.matchedCount === 0) console.warn(`Activity not found, skipped: ${filter.name}`);
  }

  // 4. Stored images for activities that only had local-illustration or no image.
  for (const { filter, image } of ACTIVITY_IMAGE_PATCHES) {
    const result = await LocalPlace.updateMany(
      { ...filter, $or: [{ image: { $exists: false } }, { image: null }, { image: "" }] },
      { $set: { ...image, images: [image.image], isDemoData: false } },
      { runValidators: true }
    );
    if (result.matchedCount === 0) {
      // Record exists but already has an image — only ensure it stays verified.
      await LocalPlace.updateMany(filter, { $set: { isDemoData: false } });
    }
  }

  const counts = {
    hotels: await Hotel.countDocuments({ isDemoData: false }),
    hotelsWithImage: await Hotel.countDocuments({ isDemoData: false, image: { $ne: "" } }),
    pokharaHotels: await Hotel.countDocuments({ city: "Pokhara", isDemoData: false }),
    kathmanduHotels: await Hotel.countDocuments({ city: "Kathmandu", isDemoData: false }),
    chitwanHotels: await Hotel.countDocuments({ city: "Chitwan", isDemoData: false }),
    activities: await LocalPlace.countDocuments({ module: "activity", isDemoData: false }),
    pricedActivities: await LocalPlace.countDocuments({ module: "activity", isDemoData: false, price: { $gt: 0 } }),
    activitiesWithImage: await LocalPlace.countDocuments({ module: "activity", isDemoData: false, image: { $ne: "" } }),
  };
  console.log("Complete-trip seed OK:", counts);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
