const STOP_WORDS = new Set([
  "area", "district", "nepal", "province", "region", "the", "valley",
]);

function parseDate(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function extractRequest(prompt) {
  const text = typeof prompt === "string" ? prompt.trim().slice(0, 1000) : "";
  if (!text) return {};
  const result = {};
  const duration = text.match(/\b(\d{1,2})\s*[- ]?\s*days?\b/i);
  if (duration) result.durationDays = Number(duration[1]);
  const travelers = text.match(/\b(\d{1,2})\s*(?:people|travelers?|travellers?|persons?|adults?)\b/i);
  if (travelers) result.adults = Number(travelers[1]);
  const budget = text.match(/\b(?:under|below|budget(?:\s+of)?|npr)\s*(?:npr\s*)?([\d,]+)/i);
  if (budget) result.budgetAmount = Number(budget[1].replace(/,/g, ""));
  const destination = text.match(/\b(?:to|in|around)\s+(.+?)(?=\s+(?:for|under|below|with|on|interested|and)\b|[,.;!?]|$)/i);
  if (destination) result.destination = destination[1].trim().replace(/^(?:the\s+)/i, "");
  const interests = [
    ["trekking", /\btrek(?:king)?\b/i],
    ["hiking", /\bhik(?:e|ing)\b/i],
    ["sightseeing", /\bsightseeing\b/i],
    ["food", /\bfood|restaurant|dining\b/i],
    ["shopping", /\bshopping\b/i],
    ["wildlife", /\bwildlife|safari\b/i],
    ["photography", /\bphotograph(?:y|ic)\b/i],
    ["adventure", /\badventure|paragliding|rafting|bungee|zipline\b/i],
    ["culture", /\bcultur(?:e|al)|heritage|historical\b/i],
    ["religious", /\breligi(?:ous|on)|temple|monastery\b/i],
    ["local experiences", /\blocal experience|local life\b/i],
  ];
  result.interests = interests.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return result;
}

function significantTokens(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function matchesDestination(record, destination) {
  const tokens = significantTokens(destination);
  if (!tokens.length) return false;
  const fields = [
    record.name,
    record.destination,
    record.city,
    record.district,
    record.province,
    record.location,
    record.address,
    record.route,
    record.origin,
    record.description,
    ...(Array.isArray(record.tags) ? record.tags : []),
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.nearbyAttractions) ? record.nearbyAttractions : []),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return tokens.every((token) => fields.includes(token));
}

function hasImage(record) {
  return Boolean(record.image || (Array.isArray(record.images) && record.images.some(Boolean)));
}

function locationLabel(record) {
  return [
    record.address,
    record.location,
    record.city,
    record.district,
    record.province,
  ].filter(Boolean).join(", ");
}

function makeItineraryEntity(record, entityType) {
  return {
    entityType,
    entityId: String(record._id),
    name: record.name,
    description: record.description,
    category: record.category || record.module || entityType,
    location: locationLabel(record) || record.destination,
    address: record.address,
    latitude: record.latitude,
    longitude: record.longitude,
    durationMinutes: record.durationMinutes,
    estimatedCost: Number.isFinite(record.price) ? record.price : undefined,
    currency: record.currency || "NPR",
    rating: Number.isFinite(record.rating) ? record.rating : undefined,
    reviewCount: Number.isFinite(record.reviewCount) ? record.reviewCount : undefined,
    amenities: Array.isArray(record.amenities) ? record.amenities.filter(Boolean).slice(0, 12) : undefined,
    openingHours: record.openingHours,
    image: record.image,
    images: record.images,
    imageSource: record.imageSource,
    imageSourcePage: record.imageSourcePage,
    imageLicense: record.imageLicense,
    imageCredit: record.imageCredit,
    imageDescription: record.imageDescription,
    imageRelevance: record.imageRelevance,
    source: record.dataSource,
    sourceUrl: record.dataSourceUrl,
  };
}

function listingText(record) {
  return [
    record.name,
    record.category,
    record.module,
    record.description,
    ...(record.tags || []),
    ...(record.highlights || []),
    ...(record.cuisine || []),
    ...(record.amenities || []),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function preferenceScore(record, preferences) {
  const text = listingText(record);
  const interestTerms = {
    adventure: ["adventure", "trek", "hike", "rafting", "paraglid", "bungee", "climb", "safari"],
    trekking: ["trek", "trail", "hike"],
    hiking: ["hike", "trail", "trek"],
    culture: ["cultur", "heritage", "museum", "local", "historic"],
    "historical places": ["historic", "heritage", "museum", "monument"],
    "religious places": ["temple", "monastery", "religious", "stupa"],
    religious: ["temple", "monastery", "religious", "stupa"],
    wildlife: ["wildlife", "safari", "bird", "nature"],
    nature: ["nature", "lake", "mountain", "forest", "wildlife"],
    sightseeing: ["view", "sight", "scenic", "landmark"],
    food: ["restaurant", "cuisine", "food", "dining"],
    shopping: ["shopping", "market", "craft"],
    photography: ["view", "scenic", "photography"],
    "local experiences": ["local", "cultur", "village", "community"],
  };
  const wanted = [...(preferences.interests || []), preferences.travelStyle]
    .filter(Boolean)
    .flatMap((value) => interestTerms[String(value).toLocaleLowerCase()] || [String(value).toLocaleLowerCase()]);
  let score = wanted.reduce((total, term) => total + (text.includes(term) ? 3 : 0), 0);
  if (preferences.travelStyle?.toLocaleLowerCase() === "family" &&
      /child|family|all ages/i.test(`${record.participantType || ""} ${text}`)) score += 3;
  if (preferences.transportPreference && `${record.type || ""} ${record.serviceMode || ""}`.toLocaleLowerCase()
    .includes(preferences.transportPreference.toLocaleLowerCase())) score += 2;
  if (preferences.accommodationPreference && `${record.name || ""} ${record.propertyType || ""}`
    .toLocaleLowerCase().includes(preferences.accommodationPreference.toLocaleLowerCase())) score += 2;
  if (preferences.foodPreferences?.length && preferences.foodPreferences.some((value) =>
    text.includes(value.toLocaleLowerCase()))) score += 2;

  const price = Number.isFinite(record.price) ? record.price
    : Number.isFinite(record.pricePerNight) ? record.pricePerNight
      : undefined;
  if (price !== undefined) {
    const budgetLevel = preferences.budgetLevel?.toLocaleLowerCase();
    if (budgetLevel === "budget" || preferences.travelStyle?.toLocaleLowerCase() === "budget") {
      score += Math.max(0, 4 - Math.floor(price / 2500));
    } else if (budgetLevel === "premium" || preferences.travelStyle?.toLocaleLowerCase() === "luxury") {
      score += Math.min(3, Math.floor(price / 5000));
    }
    if (Number.isFinite(preferences.budgetAmount) && preferences.budgetAmount > 0 &&
        price > preferences.budgetAmount / Math.max(preferences.durationDays, 1)) score -= 2;
  }
  return score;
}

function distanceKm(first, second) {
  if (![first.latitude, first.longitude, second.latitude, second.longitude].every(Number.isFinite)) return undefined;
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(first.latitude);
  const lat2 = radians(second.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(second.longitude - first.longitude);
  const arc = Math.min(1, Math.max(0,
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  ));
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc)) * 10) / 10;
}

function orderNearby(items) {
  const remaining = [...items];
  const ordered = [];
  while (remaining.length) {
    const previous = ordered[ordered.length - 1];
    let nextIndex = 0;
    if (previous && Number.isFinite(previous.latitude) && Number.isFinite(previous.longitude)) {
      let closestDistance = Infinity;
      remaining.forEach((item, index) => {
        const distance = distanceKm(previous, item);
        if (distance !== undefined && distance < closestDistance) {
          closestDistance = distance;
          nextIndex = index;
        }
      });
    }
    const [next] = remaining.splice(nextIndex, 1);
    if (ordered.length) next.distanceFromPreviousKm = distanceKm(ordered[ordered.length - 1], next);
    ordered.push(next);
  }
  return ordered;
}

function dayGuidance(dayIndex, durationDays, destination) {
  return {
    Morning: dayIndex === 0
      ? "Keep time flexible for arrival, check-in, or a relaxed start."
      : `Choose a listed stop or explore ${destination} at your own pace.`,
    Afternoon: `Allow time for breaks and travel between places in ${destination}.`,
    Evening: dayIndex === durationDays - 1
      ? "Leave time for packing and onward travel."
      : "Keep the evening flexible for rest or local exploration.",
  };
}

function buildDays({ durationDays, startDate, destination, destinations, activities, restaurants, preferences }) {
  const pool = [
    ...destinations.map((record) => ({ record, entityType: "destination" })),
    ...activities.map((record) => ({ record, entityType: "activity" })),
    ...restaurants.map((record) => ({ record, entityType: "restaurant" })),
  ].map(({ record, entityType }) => ({
    ...makeItineraryEntity(record, entityType),
    _score: preferenceScore(record, preferences),
  })).sort((first, second) => second._score - first._score);
  const days = Array.from({ length: durationDays }, (_, dayIndex) => {
    const dayDate = startDate ? new Date(startDate.getTime() + dayIndex * 86400000) : undefined;
    return {
      day: dayIndex + 1,
      date: dayDate?.toISOString().slice(0, 10),
      focus: durationDays === 1
        ? "Flexible exploration"
        : dayIndex === 0
          ? "Arrival and local orientation"
          : dayIndex === durationDays - 1
            ? "Local highlights and departure"
            : "Explore local highlights",
      guidance: dayGuidance(dayIndex, durationDays, destination),
      items: [],
    };
  });
  pool.slice(0, durationDays * 3).forEach((item, index) => {
    const dayIndex = index % durationDays;
    days[dayIndex].items.push({
      ...item,
      suggestedTimeOfDay: ["Morning", "Afternoon", "Evening"][Math.floor(index / durationDays)],
    });
  });
  days.forEach((day) => {
    day.items = orderNearby(day.items);
    day.items.forEach((item, index) => {
      item.suggestedTimeOfDay = ["Morning", "Afternoon", "Evening"][index];
      delete item._score;
    });
  });
  return days;
}

function makePlan({ destination, durationDays, startDate, endDate, adults, children, budgetAmount, budgetLevel, travelStyle, interests, transportPreference, accommodationPreference, foodPreferences }, records, { excludeEntityIds = [] } = {}) {
  const matches = (record) => matchesDestination(record, destination);
  const excluded = new Set(excludeEntityIds);
  const verifiedActivities = records.activities.filter((item) => item.isDemoData === false && matches(item) && !excluded.has(String(item._id)));
  const verifiedRestaurants = records.restaurants.filter((item) => item.isDemoData === false && matches(item) && !excluded.has(String(item._id)));
  const verifiedHotels = records.hotels.filter((item) => item.isDemoData === false && item.available !== false && matches(item));
  const verifiedTransport = records.transport.filter((item) => item.isDemoData === false && matches(item));
  const matchingDestinations = records.destinations.filter(matches);
  const days = buildDays({
    durationDays,
    startDate,
    destination,
    destinations: matchingDestinations.filter((item) => !excluded.has(String(item._id))),
    activities: verifiedActivities,
    restaurants: verifiedRestaurants,
    preferences: { interests, travelStyle, budgetAmount, budgetLevel, durationDays, transportPreference, accommodationPreference, foodPreferences },
  });
  const listedActivityCosts = days.flatMap((day) => day.items)
    .filter((item) => item.entityType === "activity" && Number.isFinite(item.estimatedCost))
    .reduce((sum, item) => sum + item.estimatedCost, 0);
  const nights = Math.max(durationDays - 1, 0);
  const rankedHotels = verifiedHotels.map((hotel) => ({
    hotel,
    score: preferenceScore(hotel, { interests, travelStyle, budgetAmount, budgetLevel, durationDays, accommodationPreference }),
  })).sort((first, second) => second.score - first.score);
  const hotels = rankedHotels.slice(0, 5).map(({ hotel }) => ({
    ...makeItineraryEntity(hotel, "hotel"),
    pricePerNight: Number.isFinite(hotel.pricePerNight) ? hotel.pricePerNight : undefined,
    rating: hotel.rating,
    isDemoData: false,
  }));
  const lowestPricedHotel = [...hotels]
    .filter((hotel) => Number.isFinite(hotel.pricePerNight))
    .sort((first, second) => first.pricePerNight - second.pricePerNight)[0];
  const accommodation = lowestPricedHotel && nights > 0 ? lowestPricedHotel.pricePerNight * nights : null;
  const knownSubtotal = listedActivityCosts + (accommodation ?? 0);
  const transport = verifiedTransport.map((item) => ({
    item,
    score: preferenceScore(item, { interests, travelStyle, budgetAmount, budgetLevel, durationDays, transportPreference }),
  })).sort((first, second) => second.score - first.score).slice(0, 5).map(({ item }) => ({
    ...makeItineraryEntity(item, "transport"),
    type: item.type,
    provider: item.provider,
    route: item.route,
    origin: item.origin,
    destination: item.destination,
    price: Number.isFinite(item.price) ? item.price : undefined,
  }));
  const dataAvailability = [];
  if (!verifiedRestaurants.length) dataAvailability.push("Restaurant listings are limited for this destination.");
  if (!hotels.length) dataAvailability.push("No matching stay is listed; browse accommodation before booking.");
  if (!transport.length) dataAvailability.push("No matching transport option is listed.");
  dataAvailability.push("Forecasts and live road directions are not available in this itinerary.");

  return {
    name: `Trip to ${destination}`,
    destination,
    startDate,
    endDate,
    durationDays,
    adults,
    children,
    budget: {
      amount: budgetAmount,
      currency: "NPR",
      level: budgetLevel || undefined,
    },
    travelStyle,
    interests,
    transportPreference,
    accommodationPreference,
    foodPreferences,
    days,
    recommendations: {
      hotels,
      transport,
      restaurants: verifiedRestaurants.sort((first, second) =>
        preferenceScore(second, { interests, travelStyle, budgetAmount, budgetLevel, durationDays, foodPreferences }) -
        preferenceScore(first, { interests, travelStyle, budgetAmount, budgetLevel, durationDays, foodPreferences }))
        .slice(0, 5).map((restaurant) => ({
          ...makeItineraryEntity(restaurant, "restaurant"),
          cuisine: restaurant.cuisine,
          priceLevel: restaurant.priceLevel,
        })),
      weather: { available: false, message: "A forecast is not available for these trip dates." },
      costSummary: {
        currency: "NPR",
        listedActivityCosts,
        accommodation,
        transportation: null,
        food: null,
        bookingFees: null,
        total: knownSubtotal,
        perPerson: adults + children > 0 ? knownSubtotal / (adults + children) : knownSubtotal,
        perDay: durationDays > 0 ? knownSubtotal / durationDays : knownSubtotal,
        note: "Known-price estimate only. It includes listed activity prices and, when available, one room at the lowest listed nightly rate. Transport options, food, booking fees, and live room availability are not included.",
      },
    },
    dataAvailability,
    warnings: [],
  };
}

function validatePlanRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Enter trip details to generate an itinerary." };
  }
  const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1000) : "";
  const extracted = extractRequest(prompt);
  const destination = typeof input.destination === "string" && input.destination.trim()
    ? input.destination.trim()
    : extracted.destination;
  if (!destination || destination.length > 120) {
    return { error: "Enter a Nepal destination (up to 120 characters)." };
  }

  let startDate = parseDate(input.startDate);
  let endDate = parseDate(input.endDate);
  if (startDate === null || endDate === null) return { error: "Use valid dates in YYYY-MM-DD format." };
  if (endDate && !startDate) return { error: "Choose a start date when entering an end date." };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (startDate && startDate < today) return { error: "The trip start date cannot be in the past." };

  let durationDays = input.durationDays ?? extracted.durationDays;
  if (startDate && endDate) {
    if (endDate < startDate) return { error: "The trip end date must be on or after its start date." };
    durationDays = Math.floor((endDate - startDate) / 86400000) + 1;
  } else if (startDate && Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 14) {
    endDate = new Date(startDate.getTime() + (durationDays - 1) * 86400000);
  } else if (Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 14) {
    startDate = undefined;
  } else {
    return { error: "Choose start and end dates or a trip duration from 1 to 14 days." };
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 14) {
    return { error: "Trip duration must be from 1 to 14 days." };
  }

  const adults = input.adults ?? extracted.adults ?? 1;
  const children = input.children ?? 0;
  if (!Number.isInteger(adults) || adults < 1 || adults > 12 ||
      !Number.isInteger(children) || children < 0 || children > 12 || adults + children > 12) {
    return { error: "Enter 1–12 adults and 0–12 children, with no more than 12 travelers in total." };
  }
  const budgetAmount = input.budgetAmount ?? extracted.budgetAmount;
  if (budgetAmount !== undefined && (!Number.isFinite(budgetAmount) || budgetAmount < 0 || budgetAmount > 10000000)) {
    return { error: "Enter a budget between NPR 0 and NPR 10,000,000." };
  }
  const stringValue = (value, maxLength = 40) =>
    typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  const interests = Array.isArray(input.interests)
    ? [...new Set(input.interests.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))].slice(0, 12)
    : extracted.interests || [];

  return {
    value: {
      destination: destination.slice(0, 120),
      durationDays,
      startDate,
      endDate,
      adults,
      children,
      budgetAmount,
      budgetLevel: stringValue(input.budgetLevel),
      travelStyle: stringValue(input.travelStyle),
      interests,
      transportPreference: stringValue(input.transportPreference),
      accommodationPreference: stringValue(input.accommodationPreference),
      foodPreferences: Array.isArray(input.foodPreferences)
        ? input.foodPreferences.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 8)
        : [],
    },
  };
}

module.exports = {
  hasImage,
  makeItineraryEntity,
  makePlan,
  matchesDestination,
  distanceKm,
  validatePlanRequest,
};
