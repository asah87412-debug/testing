const API_URL = "https://commons.wikimedia.org/w/api.php";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RESULTS = 8;
const MIN_REQUEST_INTERVAL_MS = 1200;
const MAX_RATE_LIMIT_RETRIES = 3;
const cache = new Map();
const categoryCache = new Map();
let requestQueue = Promise.resolve();
let nextRequestAt = 0;
const NEPAL_LOCATIONS = [
  "bhaktapur",
  "chitwan",
  "dharan",
  "ilam",
  "kathmandu",
  "kaski",
  "khumbu",
  "lalitpur",
  "lumbini",
  "manang",
  "mustang",
  "pokhara",
];
const GENERIC_NAME_TOKENS = new Set([
  "at",
  "and",
  "cafe",
  "guest",
  "guesthouse",
  "hotel",
  "house",
  "in",
  "lake",
  "lodge",
  "of",
  "grand",
  "resort",
  "restaurant",
  "the",
  "view",
]);
const BUSINESS_TYPES = new Set([
  "atm",
  "hospital",
  "hotel",
  "petrol",
  "restaurant",
  "transport",
]);

const CATEGORY_SEARCHES = {
  hotel: {
    terms: "hotel Nepal",
    matches: /\b(hotel|resort|lodge|hostel|homestay|guest house|guesthouse)\b/i,
  },
  restaurant: {
    terms: "restaurant Nepal",
    matches: /\b(restaurant|cafe|caf[eé]|dining|eatery)\b/i,
  },
  transport: {
    terms: "vehicle Nepal",
    matches: /\b(bus|coach|jeep|motorbike|motorcycle|scooter|taxi|vehicle)\b/i,
  },
  hospital: {
    terms: "hospital Nepal",
    matches: /\b(hospital|clinic|medical center|medical centre)\b/i,
  },
  petrol: {
    terms: "petrol station Nepal",
    matches: /\b(petrol station|fuel station|gas station|filling station)\b/i,
  },
  atm: {
    terms: "ATM Nepal",
    matches: /\b(ATM|bank|cash machine|cashpoint)\b/i,
  },
};

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(entity) {
  const name = normalize(entity.name);
  const categoryLead = {
    hotel: /^(?:hotel|resort|hostel|lodge)\s+/,
    restaurant: /^(?:restaurant|cafe|cafeteria)\s+/,
    hospital: /^(?:hospital|clinic)\s+/,
    petrol: /^(?:petrol pump|petrol station|gas station)\s+/,
    atm: /^(?:atm|bank)\s+/,
  }[normalize(entity.type)];
  const core = categoryLead ? name.replace(categoryLead, "") : name;
  const type = normalize(entity.type);
  return core
    .split(/\s+/)
    .filter((token) =>
      token.length > 1 &&
      !GENERIC_NAME_TOKENS.has(token) &&
      !(BUSINESS_TYPES.has(type) && NEPAL_LOCATIONS.includes(token))
    );
}

function exactMatchScore(entity, candidate) {
  const tokens = nameTokens(entity);
  if (!tokens.length) return 0;
  const text = ` ${normalize(candidate.title)} `;
  const phrase = ` ${tokens.join(" ")} `;
  return text.includes(phrase) ? 1 : 0;
}

function hasLocationConflict(entity, candidate) {
  const entityLocation = normalize([
    entity.location,
    entity.city,
    entity.district,
    entity.province,
  ].filter(Boolean).join(" "));
  const candidateText = normalize(`${candidate.title} ${candidate.description}`);
  const requested = NEPAL_LOCATIONS.filter((place) => entityLocation.includes(place));
  if (!requested.length) return false;
  const mentioned = NEPAL_LOCATIONS.filter((place) => candidateText.includes(place));
  return mentioned.length > 0 && !mentioned.some((place) => requested.includes(place));
}

function hasCategoryLocationMatch(entity, candidate) {
  const entityLocation = normalize([
    entity.location,
    entity.city,
    entity.district,
    entity.province,
  ].filter(Boolean).join(" "));
  const candidateText = normalize(candidate.title);
  const requested = NEPAL_LOCATIONS.filter((place) => entityLocation.includes(place));
  return requested.some((place) => candidateText.includes(place)) || candidateText.includes("nepal");
}

function hasEntityTypeEvidence(entity, candidate) {
  const type = normalize(entity.type);
  const text = normalize(candidate.title);
  if (
    type === "destination" &&
    /\b(agriculture|cultivation|farming|harvest|ploughing|plowing|rice field)\b/i.test(text)
  ) {
    return false;
  }
  if (
    type === "destination" &&
    (
      /\b(beetle|bird|birds|butterflies|butterfly|cuckoo|fauna|fish|flora|frog|fungus|insect|lizard|moth|mushroom|snake|spider|specimen|species|waterhen)\b/i.test(text) ||
      /^File:[A-Z][a-z]{4,}\s+[a-z]{4,}(?:[\s_.]|$)/.test(cleanText(candidate.title))
    )
  ) {
    return false;
  }
  if (
    type === "activity" &&
    /\b(camp|certificate|document|itinerary|map|permit|poster|route|ticket)\b/i.test(text)
  ) {
    return false;
  }
  if (
    type === "transport" &&
    /\b(badge|license|logo|park|parking|plate|registration|schedule|station|terminal|ticket|timetable)\b/i.test(text)
  ) {
    return false;
  }
  const evidence = {
    atm: /\b(atm|bank|cash machine|cashpoint)\b/i,
    hospital: /\b(hospital|clinic|medical center|medical centre)\b/i,
    hotel: /\b(hotel|resort|lodge|hostel|homestay|guest house|guesthouse)\b/i,
    petrol: /\b(petrol station|fuel station|gas station|filling station)\b/i,
    restaurant: /\b(restaurant|cafe|caf[eé]|dining|eatery)\b/i,
    transport: /\b(bus|coach|jeep|motorbike|motorcycle|scooter|taxi|vehicle)\b/i,
  }[type];
  if (evidence && !evidence.test(text)) return false;
  if (type === "transport") {
    const tokens = text.split(/\s+/);
    const vehicleTerms = [
      "bus", "car", "coach", "jeep", "bike", "motorbike", "motorcycle", "scooter", "taxi", "vehicle",
    ];
    const firstVehicleToken = tokens.findIndex((token) => vehicleTerms.includes(token));
    if (firstVehicleToken < 0 || firstVehicleToken > 5) return false;
  }
  return true;
}

function getCategorySearch(entity) {
  const type = normalize(entity.type);
  if (type === "activity" || type === "destination" || type === "country" || type === "shopping") {
    return null;
  }
  const category = CATEGORY_SEARCHES[type];
  if (!category) return null;
  let terms = category.terms;
  let matches = category.matches;
  if (type === "transport") {
    const name = normalize(entity.name);
    if (/\b(bus|coach)\b/.test(name)) {
      terms = "tourist bus";
      matches = /\b(bus|coach)\b/i;
    } else if (/\b(jeep|4wd)\b/.test(name)) {
      terms = "jeep";
      matches = /\b(jeep|4wd)\b/i;
    } else if (/\b(bike|motorbike|motorcycle|scooter)\b/.test(name)) {
      terms = "motorcycle";
      matches = /\b(motorbike|motorcycle|scooter|bike)\b/i;
    } else if (/\b(car|taxi)\b/.test(name)) {
      terms = "car";
      matches = /\b(car|taxi)\b/i;
    }
  }
  const location = [entity.location, entity.city, entity.district, entity.province, "Nepal"]
    .filter(Boolean)
    .join(" ");
  const queryWords = `${terms} ${location}`.split(/\s+/);
  let includedNepal = false;
  const query = queryWords.filter((word) => {
    if (normalize(word) !== "nepal") return true;
    if (includedNepal) return false;
    includedNepal = true;
    return true;
  }).join(" ");
  const additionalQueries = type === "transport"
    ? [`${terms} Nepal`, terms]
    : [];
  return { ...category, matches, query, additionalQueries };
}

function isReusableLicense(license, usageTerms = "") {
  const approvedLicense =
    /^(?:CC0|CC BY(?:-SA)?(?:\s+\d(?:\.\d+)?)?|Public domain|PD-[A-Z0-9-]+|GFDL(?:\s|$)|GNU Free Documentation License|Free Art License|MIT|BSD(?:\s|$))/i;
  return approvedLicense.test(license) &&
    !/all rights reserved|non-free|unknown|fair use|\b(?:NC|ND)\b/i.test(`${license} ${usageTerms}`);
}

function isReusableImage(info) {
  return isReusableLicense(
    cleanText(info.extmetadata?.LicenseShortName?.value),
    cleanText(info.extmetadata?.UsageTerms?.value)
  );
}

function toImageReference(page, info, relevance) {
  if (!isReusableImage(info)) return null;
  const uri = info.thumburl || info.url;
  if (!uri || !/^https:\/\/(?:thumb\.wikimedia\.org|upload\.wikimedia\.org)\//i.test(uri)) {
    return null;
  }
  const ext = info.extmetadata || {};
  const license = cleanText(ext.LicenseShortName?.value || ext.UsageTerms?.value);
  const credit = cleanText(ext.AttributionRequired?.value) === "true"
    ? cleanText(ext.Attribution?.value || ext.Artist?.value || ext.Credit?.value)
    : cleanText(ext.Artist?.value || ext.Credit?.value);
  const title = page.title || "";
  const sourcePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/gi, ":")}`;
  return {
    uri,
    source: "Wikimedia Commons",
    sourcePage,
    license,
    credit,
    description: cleanText(ext.ImageDescription?.value),
    relevance,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForCommonsSlot() {
  const slot = requestQueue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await sleep(delay);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  });
  requestQueue = slot.catch(() => {});
  return slot;
}

function retryDelay(response, attempt) {
  const header = response.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    const retryAt = Number.isFinite(seconds)
      ? Date.now() + seconds * 1000
      : Date.parse(header);
    if (Number.isFinite(retryAt)) {
      return Math.min(300_000, Math.max(250, retryAt - Date.now()));
    }
  }
  return Math.min(30_000, 1500 * 2 ** attempt);
}

async function searchCommons(query, fetchImpl) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(MAX_RESULTS),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1000",
    iiextmetadatafilter: "LicenseShortName|UsageTerms|AttributionRequired|Attribution|Artist|Credit|ImageDescription",
    format: "json",
    origin: "*",
  });
  let response;
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    if (fetchImpl === fetch) await waitForCommonsSlot();
    response = await fetchImpl(`${API_URL}?${params}`, {
      headers: { "User-Agent": "SuvYatra/1.0 (licensed entity image lookup)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 429 && response.status !== 503) break;
    if (attempt === MAX_RATE_LIMIT_RETRIES) break;
    const delay = retryDelay(response, attempt);
    if (fetchImpl === fetch) {
      nextRequestAt = Math.max(nextRequestAt, Date.now() + delay);
    } else {
      await sleep(delay);
    }
  }
  if (!response.ok) {
    const retryAfter = response.headers?.get?.("retry-after");
    throw new Error(
      `Wikimedia Commons image search failed (${response.status})${retryAfter ? `; retry after ${retryAfter}` : ""}.`
    );
  }
  const result = await response.json();
  const pages = result?.query?.pages;
  const pageList = Array.isArray(pages) ? pages : Object.values(pages || {});
  return pageList.flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info) return [];
    const candidate = {
      title: page.title || "",
      description: info.extmetadata?.ImageDescription?.value || "",
    };
    return [{ page, info, candidate }];
  });
}

function searchCommonsCategory(query, fetchImpl) {
  if (fetchImpl !== fetch) return searchCommons(query, fetchImpl);
  const key = normalize(query);
  const cached = categoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) categoryCache.delete(key);

  const entry = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    promise: searchCommons(query, fetchImpl).catch((error) => {
      categoryCache.delete(key);
      throw error;
    }),
  };
  categoryCache.set(key, entry);
  return entry.promise;
}

function entityCacheKey(entity) {
  return [entity.name, entity.type, entity.location, entity.city, entity.district]
    .map(normalize)
    .join("|");
}

async function resolveRelevantImagesInner(entity, fetchImpl = fetch) {
  if (!entity || typeof entity.name !== "string" || !entity.name.trim()) {
    return [];
  }
  const key = entityCacheKey(entity);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.images;
  if (cached) cache.delete(key);

  const exactQueries = [];
  const location = [entity.location, entity.city, entity.district, entity.province]
    .filter(Boolean)
    .join(" ");
  if (location) exactQueries.push(`${entity.name} ${location}`);
  exactQueries.push(`${entity.name} Nepal`);
  if (normalize(entity.type) === "activity") {
    exactQueries.push(`${entity.name} photo ${location || "Nepal"}`);
  }

  const candidates = new Map();
  for (const query of [...new Set(exactQueries)]) {
    const results = await searchCommons(query, fetchImpl);
    for (const result of results) {
      const score = exactMatchScore(entity, result.candidate);
      if (
        score > 0 &&
        !hasLocationConflict(entity, result.candidate) &&
        hasEntityTypeEvidence(entity, result.candidate) &&
        (!CATEGORY_SEARCHES[normalize(entity.type)] || hasCategoryLocationMatch(entity, result.candidate)) &&
        toImageReference(result.page, result.info, "entity")
      ) {
        candidates.set(result.page.title, {
          ...result,
          relevance: "entity",
          score,
        });
      }
    }
    if (candidates.size) break;
  }

  if (!candidates.size) {
    const fallback = getCategorySearch(entity);
    if (fallback) {
      const queries = [...new Set([fallback.query, ...fallback.additionalQueries])];
      for (const [index, query] of queries.entries()) {
        const results = await searchCommonsCategory(query, fetchImpl);
        for (const result of results) {
          const text = normalize(result.page.title);
          const isGlobalTransportFallback =
            normalize(entity.type) === "transport" && index === queries.length - 1;
          if (
            fallback.matches.test(text) &&
            hasEntityTypeEvidence(entity, result.candidate) &&
            !hasLocationConflict(entity, result.candidate) &&
            (isGlobalTransportFallback || hasCategoryLocationMatch(entity, result.candidate)) &&
            toImageReference(result.page, result.info, "category")
          ) {
            candidates.set(result.page.title, { ...result, relevance: "category" });
          }
        }
        if (candidates.size) break;
      }
    }
  }

  const images = [...candidates.values()]
    .sort((left, right) => right.score - left.score)
    .map(({ page, info, relevance }) => toImageReference(page, info, relevance))
    .filter(Boolean);
  cache.set(key, { images, expiresAt: Date.now() + CACHE_TTL_MS });
  return images;
}

// Overall deadline: one lookup fans out to several sequential Commons calls
// behind a shared rate-limit queue, so under throttling (HTTP 429/backoff)
// a single call could otherwise hang the API for minutes. Resolve with no
// images on timeout instead — every caller already treats [] as unavailable.
// Injected-fetch callers (tests/scripts) keep identical behavior.
const RESOLVE_OVERALL_TIMEOUT_MS = 25_000;

async function resolveRelevantImages(entity, fetchImpl = fetch) {
  return Promise.race([
    resolveRelevantImagesInner(entity, fetchImpl),
    sleep(RESOLVE_OVERALL_TIMEOUT_MS).then(() => []),
  ]);
}

module.exports = {
  exactMatchScore,
  getCategorySearch,
  hasLocationConflict,
  isReusableLicense,
  resolveRelevantImages,
};
