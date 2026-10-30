const restaurant = (name, city, location, cuisine, description) => ({
  name,
  city,
  location,
  cuisine,
  description,
  category: "Restaurant",
});

const transport = (name, type, origin, destination, serviceMode, description) => ({
  name,
  type,
  origin,
  destination,
  route: origin && destination ? `${origin} → ${destination}` : origin || destination,
  serviceMode,
  description,
});

const place = (module, name, city, location, category, description, details = {}) => ({
  module,
  name,
  city,
  location,
  category,
  description,
  ...details,
});

const definitions = [
  {
    collection: "restaurants",
    items: [
      restaurant("Roadhouse Cafe", "Kathmandu", "Thamel, Kathmandu", ["Pizza", "Italian"], "A casual cafe and pizzeria in Thamel."),
      restaurant("OR2K", "Kathmandu", "Thamel, Kathmandu", ["Middle Eastern", "Vegetarian"], "A vegetarian Middle Eastern restaurant in Thamel."),
      restaurant("Krishnarpan Restaurant", "Kathmandu", "Dwarika's Hotel, Battisputali, Kathmandu", ["Nepali", "Newari"], "A Nepali fine-dining restaurant at Dwarika's Hotel."),
      restaurant("Thamel House Restaurant", "Kathmandu", "Thamel, Kathmandu", ["Nepali", "Newari"], "A Nepali restaurant in Thamel."),
      restaurant("The Workshop Eatery", "Lalitpur", "Jhamsikhel, Lalitpur", ["Cafe", "International"], "A neighborhood eatery in Jhamsikhel, Lalitpur."),
      restaurant("Moondance Restaurant", "Pokhara", "Lakeside, Pokhara", ["Nepali", "International"], "A restaurant in Pokhara's Lakeside area."),
      restaurant("Fresh Elements Restaurant", "Pokhara", "Lakeside, Pokhara", ["Nepali", "International"], "A restaurant in Pokhara's Lakeside area."),
      restaurant("Pokhara Java", "Pokhara", "Lakeside, Pokhara", ["Cafe", "Coffee"], "A cafe in Pokhara's Lakeside area."),
    ],
  },
  {
    collection: "transports",
    items: [
      transport("Tourist Bus", "bus", "Kathmandu", "Pokhara", "scheduled", "Intercity tourist-bus travel in Nepal; check operators for current schedules."),
      transport("Kathmandu–Pokhara Tourist Bus", "bus", "Kathmandu", "Pokhara", "scheduled", "Tourist-bus route reference; check operators for current schedules."),
      transport("Kathmandu Taxi", "taxi", "Kathmandu", "Kathmandu", "private", "Taxi travel reference for Kathmandu; confirm a licensed driver and fare before travel."),
      transport("Pokhara Taxi", "taxi", "Pokhara", "Pokhara", "private", "Taxi travel reference for Pokhara; confirm a licensed driver and fare before travel."),
      // Nationwide rentals have no fixed origin/destination: keep those fields
      // empty (never a "Nepal" placeholder) and describe the coverage in route.
      { ...transport("Jeep Rental", "jeep", "", "", "rental", "Four-wheel-drive rental reference; verify vehicle, route, and operator before travel."), route: "Nepal-wide 4WD rental" },
      { ...transport("Motorbike Rental", "motorbike", "", "", "rental", "Motorbike rental reference; verify operator, license, insurance, and availability."), route: "Nepal-wide motorbike rental" },
      { ...transport("Car Rental", "car", "", "", "rental", "Car-rental reference; confirm the vehicle, driver, and terms with the operator."), route: "Nepal-wide car rental" },
      transport("Domestic Flight", "flight", "Kathmandu", "Pokhara", "scheduled", "Domestic-flight route reference; check the airline for current schedules."),
    ],
  },
  {
    collection: "places",
    items: [
      place("activity", "Paragliding — Pokhara", "Pokhara", "Sarangkot, Pokhara", "Adventure", "Tandem paragliding from Sarangkot with views over Pokhara and Phewa Lake."),
      place("activity", "White Water Rafting — Trishuli", "Dhading", "Trishuli River, Nepal", "Water Sports", "White-water rafting on the Trishuli River; confirm river conditions and a licensed operator."),
      place("activity", "Bungee Jumping — The Last Resort", "Sindhupalchok", "The Last Resort, Nepal", "Adventure", "Bungee-jumping activity at The Last Resort; confirm operating status and safety requirements.", { minAge: 18 }),
      place("activity", "Everest Base Camp Trek", "Solukhumbu", "Khumbu, Nepal", "Trekking", "High-altitude trek to Everest Base Camp; permits, acclimatization, and a current local guide are essential."),
      place("activity", "Annapurna Base Camp Trek", "Kaski", "Annapurna Sanctuary, Nepal", "Trekking", "Trek to Annapurna Base Camp; check current permits, weather, and route conditions."),
      place("activity", "Zipline — Pokhara", "Pokhara", "Sarangkot, Pokhara", "Adventure", "Zipline activity near Sarangkot; verify the operator and current safety information."),
      place("activity", "Jungle Safari — Chitwan", "Chitwan", "Chitwan National Park, Nepal", "Wildlife", "Guided wildlife safari in the Chitwan area; follow park rules and use an authorized operator."),
      place("activity", "Mountain Flight — Kathmandu", "Kathmandu", "Tribhuvan International Airport, Kathmandu", "Flightseeing", "Scenic mountain-flight activity from Kathmandu; check airline schedules and weather."),
      place("shopping", "Thamel Market", "Kathmandu", "Thamel, Kathmandu", "Market", "Tourist shopping streets and shops in Thamel, Kathmandu."),
      place("shopping", "Asan Market", "Kathmandu", "Asan, Kathmandu", "Market", "Traditional market streets around Asan, Kathmandu."),
      place("shopping", "Indra Chowk", "Kathmandu", "Indra Chowk, Kathmandu", "Market", "Historic market square and shopping streets in central Kathmandu."),
      place("shopping", "Boudha Market", "Kathmandu", "Boudhanath, Kathmandu", "Market", "Shops and market streets around Boudhanath."),
      place("shopping", "Labim Mall", "Lalitpur", "Pulchowk, Lalitpur", "Shopping Mall", "Shopping mall in Pulchowk, Lalitpur."),
      place("shopping", "Civil Mall", "Kathmandu", "Sundhara, Kathmandu", "Shopping Mall", "Shopping mall in Sundhara, Kathmandu."),
      place("shopping", "Kathmandu Mall", "Kathmandu", "Sundhara, Kathmandu", "Shopping Mall", "Shopping mall in Sundhara, Kathmandu."),
      place("shopping", "Lakeside Shopping Area", "Pokhara", "Lakeside, Pokhara", "Shopping Area", "Shops along Pokhara's Lakeside tourist district."),
      place("hospital", "Grande International Hospital", "Kathmandu", "Dhapasi, Kathmandu", "Hospital", "Hospital listing for Grande International Hospital in Dhapasi, Kathmandu."),
      place("hospital", "Norvic International Hospital", "Kathmandu", "Thapathali, Kathmandu", "Hospital", "Hospital listing for Norvic International Hospital in Thapathali, Kathmandu."),
      place("hospital", "Kathmandu Model Hospital", "Kathmandu", "Pradarshani Marg, Kathmandu", "Hospital", "Hospital listing for Kathmandu Model Hospital."),
      place("hospital", "Bir Hospital", "Kathmandu", "Mahaboudha, Kathmandu", "Hospital", "Hospital listing for Bir Hospital in central Kathmandu."),
      place("hospital", "Tribhuvan University Teaching Hospital", "Kathmandu", "Maharajgunj, Kathmandu", "Teaching Hospital", "Hospital listing for Tribhuvan University Teaching Hospital."),
      place("hospital", "B&B Hospital", "Lalitpur", "Gwarko, Lalitpur", "Hospital", "Hospital listing for B&B Hospital in Lalitpur."),
      place("hospital", "Manipal Teaching Hospital", "Pokhara", "Phulbari, Pokhara", "Teaching Hospital", "Hospital listing for Manipal Teaching Hospital in Pokhara."),
      place("hospital", "Fishtail Hospital & Research Center", "Pokhara", "Pokhara, Nepal", "Hospital", "Hospital listing for Fishtail Hospital & Research Center in Pokhara."),
      place("petrol", "Sambridhi Petrol Station", "Kathmandu", "Kathmandu-32, Kathmandu", "Petrol Pump", "Mapped fuel station in Kathmandu.", { latitude: 27.6972534, longitude: 85.3662132, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4834657621" }),
      place("petrol", "Bhadrakali Petrol Station", "Kathmandu", "Kageshwori Manohara, Kathmandu", "Petrol Pump", "Mapped fuel station in the Kathmandu area.", { latitude: 27.6957026, longitude: 85.375749, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4834657321" }),
      place("petrol", "Maitidevi Petrol Station", "Kathmandu", "Ghattekulo, Kathmandu", "Petrol Pump", "Mapped fuel station in Kathmandu.", { latitude: 27.7028872, longitude: 85.3356413, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/1497159560" }),
      place("petrol", "Kalika Fuel Station", "Pokhara", "Zero Kilometer, Pokhara", "Petrol Pump", "Mapped fuel station on the Pokhara–Baglung road.", { latitude: 28.218694, longitude: 83.9776398, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/way/419437276" }),
      place("petrol", "Bagmara Fuel Station", "Pokhara", "Bagmara, Pokhara-33", "Petrol Pump", "Mapped fuel station in Pokhara.", { latitude: 28.1474537, longitude: 84.0392334, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/way/513826809" }),
      place("petrol", "Ranipauwa Oil Stores", "Pokhara", "Hospital Marg, Pokhara-11", "Petrol Pump", "Mapped fuel station in Pokhara.", { latitude: 28.2197133, longitude: 83.9975123, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/1654158549" }),
      place("petrol", "Baral Petrol Pump", "Pokhara", "Baidam Road, Pokhara-07", "Petrol Pump", "Mapped fuel station on Baidam Road in Pokhara.", { latitude: 28.2131093, longitude: 83.9707853, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/3808120883" }),
      place("petrol", "National Trading Limited Petrol Pump", "Pokhara", "Prithvi Highway, Pokhara-09", "Petrol Pump", "Mapped fuel station on Prithvi Highway in Pokhara.", { latitude: 28.2088047, longitude: 83.9890651, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4061489855" }),
      place("atm", "Himalayan Bank ATM — Lakeside", "Pokhara", "Lakeside Road, Pokhara-06", "ATM", "Mapped Himalayan Bank ATM location on Lakeside Road.", { latitude: 28.2134052, longitude: 83.9569757, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4631858311" }),
      place("atm", "Nepal SBI Bank ATM — Pokhara-15", "Pokhara", "Machhapuchre Marg, Pokhara-15", "ATM", "Mapped Nepal SBI Bank ATM location in Pokhara-15.", { latitude: 28.198626, longitude: 83.9957572, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4601064349" }),
      place("atm", "NIC Asia Bank ATM — New Road", "Pokhara", "New Road, Pokhara-08", "ATM", "Mapped NIC Asia Bank ATM location on New Road.", { latitude: 28.2112217, longitude: 83.9843725, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4793368228" }),
      place("atm", "Siddhartha Bank ATM — Lakeside", "Pokhara", "Lakeside Road, Pokhara-06", "ATM", "Mapped Siddhartha Bank ATM location on Lakeside Road.", { latitude: 28.213336, longitude: 83.9570119, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4631858316" }),
      place("atm", "Standard Chartered ATM — Lakeside", "Pokhara", "Lakeside Road, Pokhara-06", "ATM", "Mapped Standard Chartered Bank ATM location on Lakeside Road.", { latitude: 28.2133623, longitude: 83.95697, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4631858317" }),
      place("atm", "Muktinath Bikas Bank ATM — New Road", "Pokhara", "New Road, Pokhara-09", "ATM", "Mapped Muktinath Bikas Bank ATM location on New Road.", { latitude: 28.2232682, longitude: 83.9878505, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4623078363" }),
      place("atm", "Nepal Bank ATM — Babarmahal", "Kathmandu", "Ram Shah Path, Babarmahal, Kathmandu-11", "ATM", "Mapped Nepal Bank ATM location in Babarmahal.", { latitude: 27.6967584, longitude: 85.3211009, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/9916725535" }),
      place("atm", "Prime Bank ATM — Nayabazar", "Kathmandu", "Pushpalal Path, Nayabazar, Kathmandu-16", "ATM", "Mapped Prime Bank ATM location in Nayabazar.", { latitude: 27.7188623, longitude: 85.30897, dataSource: "OpenStreetMap", dataSourceUrl: "https://www.openstreetmap.org/node/4430996540" }),
    ],
  },
];

module.exports = definitions;
