# SuvYatra MongoDB Backend

This is the upgraded Node.js + Express + MongoDB backend for the SuvYatra React Native/Expo app.

## 1. Requirements

Install:
- Node.js (LTS)
- MongoDB Community Server, OR use MongoDB Atlas

Check Node:
```powershell
node -v
npm -v
```

## 2. Install

Open PowerShell inside this folder:

```powershell
npm install
```

## 3. Create .env

Copy `.env.example` to `.env`.

For local MongoDB:
```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/suvyatra
```

For MongoDB Atlas, replace `MONGO_URI` with your Atlas connection string.

To enable password-reset email, configure these SMTP settings in `.env`:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=no-reply@example.com
SMTP_FROM_NAME=SuvYatra
```

Use port `465` with `SMTP_SECURE=true` for implicit TLS, or port `587` with
`SMTP_SECURE=false` for STARTTLS. Use credentials from your email provider or
transactional email service. Password-reset codes expire after 10 minutes and
are single-use. Do not put SMTP credentials in the frontend or commit `.env`.

Configure the separate administrator login in `.env` with an administrator
email and a bcrypt password hash (`ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`).
Generate the hash locally with:

```powershell
node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "your-admin-password"
```

Never put an administrator password or its hash in frontend code or commit
either value. The admin login issues a separate, four-hour administrator token;
normal user sign-in remains unchanged.

## 4. Seed the database

```powershell
npm run seed
```

This creates demo data matching the SuvYatra frontend concepts:
- user/profile
- destinations
- hotels
- restaurants
- transport
- bookings
- saved items
- reviews
- notifications
- settings

The seed is additive and idempotent: it upserts by stable keys and does not
delete existing collections. It also publishes eight curated listings for each
of restaurants, transport, activities, shopping, petrol pumps, hospitals, and
ATMs. Those records are returned by the existing verified-listing APIs. Fuel
and ATM locations retain their OpenStreetMap links and coordinates. Run the
seed again to update these catalog entries without creating duplicates.

To add or refresh the Home dashboard's popular destinations and their
attributed, reusable Wikimedia images, run:

```powershell
npm run seed:popular-destinations
```

This adds Chitwan National Park, Lumbini, Bhaktapur, Ilam, Bandipur, and
Janakpur alongside Pokhara, Kathmandu, and Manang. It only adds/updates these
destination records and tags; it does not delete existing data.

Every curated listing has a distinct image and source/credit/license metadata.
Exact licensed photographs are used where a match was found; otherwise the
listing uses a distinct project-owned category illustration labeled as
illustrative, not as a photograph of the named venue. These illustrations are
served from `/catalog-images/` and are stored under `public/catalog-images/`.
To regenerate them on Windows, run:

```powershell
.\scripts\generateCatalogArtwork.ps1
```

## 5. Start the API

Development:
```powershell
npm run dev
```

Normal:
```powershell
npm start
```

API:
- http://localhost:5000
- http://localhost:5000/api/health

## 6. Main endpoints

Authentication:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/verify-reset-otp`
- `POST /api/auth/reset-password`
- `GET /api/auth/me`
- `POST /api/admin/login`
- `GET /api/admin/session`
- `GET /api/admin/overview`
- `GET /api/admin/registered-users`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id/status`
- `GET|POST /api/admin/resources/:resource`
- `PUT|DELETE /api/admin/resources/:resource/:id`
- `GET /api/admin/bookings`
- `PATCH /api/admin/bookings/:id/status`
- `GET /api/admin/chatbot/status`
- `POST /api/admin/chatbot/knowledge`
- `GET /api/support` (administrator only)
- `GET /api/support/:id` (administrator only)
- `PUT|DELETE /api/support/:id` (administrator only)

The protected admin resource API manages destinations, hotels, restaurants,
activities (the existing `LocalPlace` collection), transport, reviews, and
support feedback. These endpoints write to the same MongoDB collections read by
the user-facing APIs. User accounts can be disabled or re-enabled; authentication
middleware rejects sessions for disabled accounts.

To enable the chatbot status and knowledge-ingest controls, set
`CHATBOT_API_URL` and the existing chatbot's `ADMIN_API_KEY` as
`CHATBOT_ADMIN_API_KEY` in the backend environment. The key stays on the server.
The chatbot currently supports adding text/URL sources and reloading its data
directory, but does not provide listing, editing, or deletion of individual
knowledge sources.

GET:
- `/api/users`
- `/api/destinations`
- `/api/hotels`
- `/api/restaurants`
- `/api/transports`
- `/api/flights`
- `/api/bookings`
- `/api/saved-items`
- `/api/reviews`
- `/api/notifications`
- `/api/trips`
- `/api/settings`

Chat:
- `GET /api/chat/sessions?userId=USER_ID`
- `POST /api/chat/sessions`
- `GET /api/chat/sessions/SESSION_ID/messages`
- `POST /api/chat/sessions/SESSION_ID/messages`
- `GET /api/images/resolve?name=ENTITY&type=TYPE&location=LOCATION`

### Entity images and attribution

Entity images are resolved by name and location through Wikimedia Commons, not
by generated or guessed URLs. The API returns licensed image URLs together
with the source-page URL, license, photographer/credit, and image description.
The frontend uses the same resolver on cards and details, retries alternatives
when a URL fails, and displays attribution. A category image, when available,
is explicitly marked illustrative and is not used for destinations or
activities. Curated catalog records may use the distinct, project-owned
category artwork described above when no suitable licensed entity photo is
available; unrelated resolver matches are not used.
The Nepal country hero uses a separate project-owned trip-planning illustration
generated by the same script. Its `country`/`Nepal` resolver path is pinned to
that artwork instead of broad remote image search, and the frontend shows its
illustrative label and project credit.

To inspect image candidates for existing database records without changing
data, run from this folder:

```powershell
node scripts/refreshEntityImages.js
```

Review the entity names, locations, relevance, and licenses in the output
before applying. To persist the resolved `image`, `images[]`, source, license,
credit, description, and source-page metadata for records with a licensed
match, and whether it is an exact entity match or a category illustration,
run:

```powershell
node scripts/refreshEntityImages.js --apply
```

To preview or apply only destinations, hotels, restaurants, or transport, add
`--type=` (for example, `--type=transport`) to either command.

This updates records in place and does not seed, delete, or recreate data.
Other unverified pre-existing images are preserved for manual review rather
than treated as relevant merely because a URL exists. Known Unsplash demo
images are treated as untrusted: the script replaces them with a distinct
licensed match or removes their image fields if no relevant candidate exists.

Each CRUD resource also supports:
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

Most list endpoints support `?search=` and `?userId=` where relevant.
`GET /api/destinations?featured=popular` filters to `popular`-tagged records
when any exist, otherwise it returns the full destination list; `featured=hidden`
returns only `hidden`-tagged records.

### Plan My Trip

- `POST /api/trips/plan` accepts a Nepal destination, duration or dates, traveler counts, budget preferences, travel style, interests, and optional natural-language prompt. It returns a day-by-day itinerary assembled from matching stored destination, verified activity, and verified restaurant records. It is available without login; trip planning does not itself save a trip.
- The planner includes only itinerary listings with stored images and database IDs. On save, authenticated `POST /api/trips` and `PUT /api/trips/:id` re-check each itinerary, hotel, and transport reference against the database and rebuild its displayed fields from that record.
- Date ranges are inclusive itinerary days; duration is limited to 14 days. Time-of-day blocks are a suggested ordering only, not verified opening hours or travel times.
- A saved trip stores its itinerary, preferences, recommendations, and information-gap warnings. `GET /api/trips` and `GET /api/trips/:id` remain scoped to the authenticated owner. The frontend supports renaming and editing a saved itinerary.
- The planner reports missing records, images, and integrations. There is no live weather provider, route-time service, room inventory, restaurant reservation provider, transport inventory, or payment gateway configured. It therefore does not claim live weather, prices as guaranteed, availability, reservations, or payment confirmation.

### Hotels and booking requests

- `GET /api/hotels/filters` returns location and accommodation/facility facets derived from stored hotel records.
- `GET /api/hotels` supports `search`, `city`, `district`, `province`, `destination`, `propertyType`, `facility`, `travelerType`, `specialFeature`, `minPrice`, `maxPrice`, and `sort` (`price-asc`, `price-desc`, `newest`, or `relevance`). List filters accept comma-separated values.
- Add `checkIn`, `checkOut`, `adults`, `children`, and `rooms` together to `GET /api/hotels` to filter by future date-range availability. Results include each room type's `availableRooms` and `matchesOccupancy`; hotels without a suitable, sufficiently stocked room type are omitted. `GET /api/hotels/:id/availability` returns availability for one hotel using the same five query parameters.
- Hotel records can contain embedded `roomTypes`, managed in the Super Admin hotel editor. Each type has a name, per-room adult and child capacities, total inventory, and an optional nightly rate (which falls back to the hotel's rate).
- Hotel room availability uses the maximum number of concurrent `pending` and `confirmed` booking requests for each room type during the requested stay, so bookings on separate nights do not incorrectly reduce the same night's inventory. Canceled and completed bookings do not consume inventory. Older bookings without a room type conservatively make that hotel's room types unavailable on the nights they overlap.
- Seeded hotel records are marked `isDemoData: true`; demo and unmarked legacy listings may be browsed but cannot be booked. An administrator must explicitly set `isDemoData: false` for a verified listing.
- `POST /api/bookings` requires a room type, validates occupancy and rechecks overlapping inventory before creating a pending request. The request total uses the room-type nightly rate, or the hotel's rate when none is set, multiplied by nights and rooms. Pending requests consume displayed inventory until canceled; a pending request still requires provider confirmation and does not process payment. `POST /api/bookings` also supports verified `transport`, `restaurant`, and `activity` listings with real seat/slot checks; `POST /api/bookings/:id/pay` initiates a clearly-labeled sandbox payment (initiated, not confirmed) and `POST /api/bookings/:id/confirm` simulates provider confirmation.

The current application has no room inventory, external accommodation provider, or payment-gateway integration. Do not treat a saved pending request as a confirmed reservation.

### Restaurants, transport, activities, and local services

- `GET /api/restaurants/filters` and `GET /api/restaurants` return facets and results only for records explicitly marked `isDemoData: false`. Search accepts `search`, `city`, `district`, `province`, `category`, `cuisine`, `foodType`, `mealTime`, `facility`, and `priceRange`. `GET /api/restaurants/:id` returns verified details. Admin-authenticated `POST`, `PUT`, and `DELETE` manage listings.
- `GET /api/transports/filters` and `GET /api/transports` return explicitly verified records. Search supports text, `type`, partial `origin`/`destination`, `serviceMode`, and stored-price/duration sorting. `GET /api/transports/:id` returns details. Admin-authenticated `POST`, `PUT`, and `DELETE` manage listings.
- `GET /api/places/filters?module=...` and `GET /api/places?module=...` provide verified, paginated activity, shopping, petrol, hospital, and ATM records. Filters include search, category, city/district/province, activity budget/duration/difficulty/season/participant type/indoor-outdoor. `GET /api/places/:id` returns details; admin-authenticated `POST`, `PUT`, and `DELETE` manage records.
- Restaurant, transport, and local-place search excludes unmarked legacy records and demo records. The seed's illustrative demo restaurant/transport options remain hidden; curated catalog items are separately marked verified for directory display. Transport entries are informational references, not live schedules, prices, availability, or bookable inventory.
- Trip records can include `plannedItems` with the selected item's actual ID, category, name, location, and available coordinates.
- For open-now/24-hour filtering, `openingHours` must contain verified local Nepal-time ranges keyed by lowercase weekday abbreviations (`sun` through `sat`), such as `"09:00-17:00"`; overnight ranges and `"24/7"`/`"24 hours"` are supported. Missing or unrecognized hours never match these filters.

No Google Places API, activity booking provider, transport reservation provider, device location-permission integration, or live opening-hours/availability feed is configured. Open-now/near-me and live booking are therefore not offered as working database filters or confirmations; the UI identifies this limitation. Google Maps links use stored coordinates when available and place-name search otherwise.

## 7. Important Expo/React Native note

If the Expo app runs on a physical Android phone, `localhost` points to the phone, not your PC.

Use your PC's local IPv4 address instead, for example:
```text
http://192.168.1.10:5000/api
```

Both phone and PC must be on the same Wi-Fi network.

For Android emulator, you can usually use:
```text
http://10.0.2.2:5000/api
```

## 8. Frontend API helper example

Create something like `src/services/api.ts`:

```ts
const API_BASE_URL = "http://10.0.2.2:5000/api";

export async function apiGet(path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error("API request failed");
  return response.json();
}

export async function apiPost(path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("API request failed");
  return response.json();
}
```

Change `API_BASE_URL` according to where Expo is running.

## 9. Chatbot architecture

Keep ChromaDB/RAG for your travel knowledge if your existing chatbot already uses it.

Recommended:
- MongoDB = users, bookings, hotels, saved items, notifications, chat history, etc.
- ChromaDB = Nepal travel knowledge / RAG documents
- Your chatbot service = combines the retrieved travel knowledge with MongoDB user context when appropriate

This backend stores chat sessions/messages but does not replace your existing ChromaDB/RAG implementation.

## 10. Security

Do not commit `.env`.
Do not put MongoDB passwords in frontend code.
For a production app, add authentication (JWT/session provider), authorization, request validation, rate limiting, and stronger error handling.
