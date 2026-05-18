# Trip Route Builder — Static HTML Map App Specification

## 1. Project Goal

Create a simple public web app that allows a user to enter travel destinations, automatically locate them on a map, build a route, choose the route style, share the generated route, and generate a copyable AI prompt for a prepared travel itinerary.

The app must be fully static and deployable to GitHub Pages.

The initial use case is a trip from Porto to Vigo, Madrid, and Barcelona, but the app should be generic enough to support any user-entered destinations.

---

## 2. Core Concept

The app should work like this:

```txt
User enters destinations
↓
App geocodes destinations
↓
User confirms / reorders / removes destinations
↓
User chooses route mode
↓
App draws the route on a CARTO map
↓
User copies a shareable URL
↓
Optional: user copies an AI itinerary prompt
```

---

## 3. Technical Stack

Use only:

- HTML
- CSS
- JavaScript
- Leaflet.js
- CARTO basemap tiles
- OpenStreetMap / Nominatim for geocoding
- OSRM public routing API for road routes
- Static predefined route geometries for train / metro routes

Do not use:

- Backend server
- Database
- Authentication
- Google Maps
- Mapbox
- Build tools
- Frameworks unless explicitly needed later

The app must run directly on GitHub Pages.

---

## 4. Hosting Target

The project must be deployable through GitHub Pages.

Suggested repository structure:

```txt
trip-route-builder/
  ├─ index.html
  ├─ style.css
  ├─ app.js
  ├─ routes-data.js
  ├─ README.md
  └─ docs/
      └─ screenshots/
```

No build command should be required.

---

## 5. Map Requirements

Use Leaflet.js with CARTO Positron normal/light basemap.

Use this tile layer:

```js
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: "abcd",
  maxZoom: 20
}).addTo(map);
```

Requirements:

- Full-screen responsive map.
- Sidebar overlay for route controls.
- Markers for destinations.
- Route line between destinations.
- Fit map to route button.
- Good mobile layout.
- CARTO normal/light map only, not terrain.

---

## 6. Destination Input

The user should be able to enter destinations manually, one per line.

Example:

```txt
Porto
Vigo
Madrid
Barcelona
```

The app should then:

1. Split the input by lines.
2. Trim empty lines.
3. Geocode each destination.
4. Show the matched result.
5. Allow the user to remove bad matches.
6. Allow the user to reorder destinations.
7. Build the route in the selected order.

---

## 7. Geocoding

Use Nominatim / OpenStreetMap for geocoding.

Example request:

```txt
https://nominatim.openstreetmap.org/search?format=json&q=Porto&limit=1
```

Implementation notes:

- Use `encodeURIComponent()` for destination names.
- Add a small delay between requests to avoid rate-limit problems.
- Show loading status while geocoding.
- If a destination is not found, show an error for that specific destination.
- Keep geocoding logic isolated in a function so it can be replaced later.

Example JavaScript function:

```js
async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to geocode: ${query}`);
  }

  const results = await response.json();

  if (!results.length) {
    throw new Error(`No result found for: ${query}`);
  }

  return {
    label: results[0].display_name,
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    originalQuery: query
  };
}
```

---

## 8. Route Modes

The app should support three route modes:

1. Road
2. Walking
3. Train / Metro

### 8.1 Road Mode

Road mode should use OSRM public API.

Example OSRM request:

```txt
https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson
```

For multiple destinations, request routes segment by segment:

```txt
Porto → Vigo
Vigo → Madrid
Madrid → Barcelona
```

Then combine the returned GeoJSON coordinates into one route line.

Example function idea:

```js
async function getRoadRouteSegment(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to fetch road route");
  }

  const data = await response.json();

  if (!data.routes || !data.routes.length) {
    throw new Error("No road route found");
  }

  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}
```

### 8.2 Walking Mode

For the first MVP, walking mode may either:

- Use OSRM if the public foot profile is available, or
- Fall back to the road route with a warning, or
- Use OpenRouteService later if an API key is acceptable.

Recommended MVP behavior:

```txt
Walking route provider not configured yet. Showing road-following route as fallback.
```

### 8.3 Train / Metro Mode

For train and metro, do not simply draw straight lines if a known route exists.

Because generic public road routing APIs do not follow railway tracks, the MVP should support predefined train-like route segments.

Initial predefined train segments:

- Porto → Vigo
- Vigo → Madrid
- Madrid → Barcelona

If a predefined segment exists, draw it.

If no predefined rail segment exists, draw a dashed approximate line and show:

```txt
Exact rail route not available yet. Showing approximate connection.
```

---

## 9. Predefined Train Route Data

Create a separate file:

```txt
routes-data.js
```

Example structure:

```js
const PREDEFINED_RAIL_ROUTES = {
  "porto|vigo": [
    [41.1579, -8.6291],
    [41.5518, -8.4229],
    [42.0260, -8.6440],
    [42.2406, -8.7207]
  ],

  "vigo|madrid": [
    [42.2406, -8.7207],
    [42.3358, -7.8639],
    [41.6523, -4.7245],
    [40.4168, -3.7038]
  ],

  "madrid|barcelona": [
    [40.4168, -3.7038],
    [41.6488, -0.8891],
    [41.6176, 0.6200],
    [41.3874, 2.1686]
  ]
};
```

Important:

- These are approximate route-shaping coordinates.
- They should be improved later with more accurate railway geometry.
- Use normalized lowercase keys.

Example key builder:

```js
function routeKey(from, to) {
  return `${normalizePlaceName(from.originalQuery)}|${normalizePlaceName(to.originalQuery)}`;
}

function normalizePlaceName(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
```

---

## 10. Route Drawing Behavior

When drawing route lines:

### Road route

- Solid line.
- Uses OSRM geometry.

### Walking route

- Solid or dotted line.
- Use provider result if configured.
- Otherwise show fallback warning.

### Train / Metro route

- Solid line if predefined route exists.
- Dashed line if only approximate fallback exists.

Suggested line styles:

```js
const ROUTE_STYLES = {
  road: {
    weight: 4,
    opacity: 0.85
  },
  walking: {
    weight: 4,
    opacity: 0.75,
    dashArray: "6, 8"
  },
  rail: {
    weight: 5,
    opacity: 0.9
  },
  fallback: {
    weight: 3,
    opacity: 0.6,
    dashArray: "8, 10"
  }
};
```

---

## 11. Markers and Popups

For every destination, add a marker.

Popup content should include:

- Destination number
- Original user input
- Matched location name
- Latitude / longitude
- Route mode context

Example:

```txt
1. Porto
Matched: Porto, Portugal
Coordinates: 41.1579, -8.6291
```

---

## 12. Sidebar UI

The sidebar should include:

### Destination input

- Textarea
- Placeholder with example destinations
- Build route button

### Route controls

- Route mode selector:
  - Road
  - Walking
  - Train / Metro
- Fit map button
- Clear route button
- Copy share link button

### Destination list

For each resolved destination:

- Number
- Original name
- Matched result
- Move up button
- Move down button
- Remove button

### AI prompt section

Inputs:

- Start date
- End date
- Budget style
  - Budget
  - Balanced
  - Comfortable
- Travel style
  - Fast-paced
  - Relaxed
  - Cultural
  - Nightlife
  - Food-focused
- Generate prompt button
- Copy prompt button

---

## 13. Shareable Route URLs

The app should generate a shareable URL based on selected destinations and settings.

Example:

```txt
https://yourusername.github.io/trip-route-builder/?places=Porto|Vigo|Madrid|Barcelona&mode=rail&start=2026-08-04&end=2026-08-07&budget=budget&style=fast-paced
```

Required query parameters:

- `places`
- `mode`

Optional query parameters:

- `start`
- `end`
- `budget`
- `style`

When the app loads:

1. Check URL parameters.
2. If `places` exists, populate the textarea.
3. If `mode` exists, select that route mode.
4. If date/budget/style exist, fill the AI prompt fields.
5. Automatically geocode and build the route.

Example parse logic:

```js
function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const places = params.get("places");

  if (places) {
    const decodedPlaces = places.split("|").map(decodeURIComponent);
    document.querySelector("#destinationsInput").value = decodedPlaces.join("\n");
  }

  const mode = params.get("mode");
  if (mode) {
    document.querySelector("#routeMode").value = mode;
  }
}
```

Example share link builder:

```js
function buildShareUrl(destinations, settings) {
  const params = new URLSearchParams();

  params.set(
    "places",
    destinations.map(place => encodeURIComponent(place.originalQuery)).join("|")
  );

  params.set("mode", settings.mode);

  if (settings.startDate) params.set("start", settings.startDate);
  if (settings.endDate) params.set("end", settings.endDate);
  if (settings.budget) params.set("budget", settings.budget);
  if (settings.style) params.set("style", settings.style);

  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}
```

---

## 14. AI Itinerary Prompt Generator

The app must not call any AI API.

It should only generate a copyable prompt that the user can paste into ChatGPT or another AI assistant.

Prompt template:

```txt
Create a practical travel itinerary for this route:
{{destinations}}

Transport preference:
{{routeMode}}

Dates:
{{startDate}} to {{endDate}}

Budget:
{{budgetStyle}}

Travel style:
{{travelStyle}}

Please include:
- realistic transport options between each destination
- estimated travel times
- recommended daily plan
- places to visit
- food recommendations
- public transport tips
- budget-saving tips
- warnings about tight connections
- optional alternative routes

Assume the user prefers affordable options and public transport when possible.
```

For the Porto → Vigo → Madrid → Barcelona example:

```txt
Create a practical travel itinerary for this route:
Porto → Vigo → Madrid → Barcelona

Transport preference:
Train / Metro

Dates:
2026-08-04 to 2026-08-07

Budget:
Budget

Travel style:
Fast-paced

Please include:
- realistic transport options between each destination
- estimated travel times
- recommended daily plan
- places to visit
- food recommendations
- public transport tips
- budget-saving tips
- warnings about tight connections
- optional alternative routes

Assume the user prefers affordable options and public transport when possible.
```

---

## 15. Error Handling

The app should handle:

### Geocoding errors

Show:

```txt
Could not find: {{destination}}
Try adding country or city context.
```

Example:

```txt
Paris, France
Porto, Portugal
Vigo, Spain
```

### Routing errors

Show:

```txt
Could not build route segment: {{from}} → {{to}}
Showing approximate fallback line.
```

### Empty input

Show:

```txt
Add at least two destinations to build a route.
```

### Single destination

Show marker only and message:

```txt
Add another destination to draw a route.
```

---

## 16. Recommended MVP Milestones

### Milestone 1 — Basic map

- Create index.html.
- Add Leaflet.
- Add CARTO Positron tiles.
- Show default map centered on Iberia.

### Milestone 2 — Destination input

- Add textarea.
- Parse destinations.
- Geocode using Nominatim.
- Add markers.

### Milestone 3 — Route drawing

- Draw straight fallback lines.
- Add fit map button.

### Milestone 4 — Road routing

- Add OSRM road-following route.
- Request segment by segment.
- Draw returned geometry.

### Milestone 5 — Train / Metro mode

- Add predefined rail route data.
- Use predefined segments when available.
- Use dashed fallback when unavailable.

### Milestone 6 — Sharing

- Encode route state in URL.
- Add copy share link button.
- Auto-load shared route from URL.

### Milestone 7 — AI prompt

- Add itinerary prompt form.
- Generate prompt from selected route.
- Add copy prompt button.

### Milestone 8 — Polish

- Mobile sidebar.
- Loading states.
- Better destination cards.
- README.
- GitHub Pages deployment instructions.

---

## 17. Initial Default Example

Use this as the default demo route:

```txt
Porto
Vigo
Madrid
Barcelona
```

Default settings:

```txt
Route mode: Train / Metro
Start date: 2026-08-04
End date: 2026-08-07
Budget: Budget
Travel style: Fast-paced
```

---

## 18. README Content

The project README should include:

```md
# Trip Route Builder

A simple static travel route planner using Leaflet, CARTO maps, OpenStreetMap geocoding, and shareable URLs.

## Features

- Enter destinations manually
- Geocode places using OpenStreetMap
- Show markers on a CARTO map
- Draw road routes with OSRM
- Draw predefined train/metro route segments
- Generate shareable route links
- Generate copyable AI itinerary prompts
- Deploy to GitHub Pages

## Run locally

Open index.html directly in a browser, or use a simple local server:

python -m http.server 8080

Then open:

http://localhost:8080

## Deploy to GitHub Pages

1. Push this project to GitHub.
2. Go to repository Settings.
3. Open Pages.
4. Select branch main.
5. Select root folder.
6. Save.
7. Open the generated GitHub Pages URL.

## Notes

This app is static. It does not store user data. Route sharing works through URL parameters.

Road routing uses the public OSRM API. Train and metro routing uses predefined route geometry where available.
```

---

## 19. Implementation Rules for the Agent

When implementing this project:

- Keep code simple.
- Use plain JavaScript.
- Do not introduce unnecessary dependencies.
- Do not add authentication.
- Do not add a backend.
- Do not use API keys in the MVP.
- Keep map provider as CARTO Positron.
- Keep files easy to understand.
- Make the app usable on mobile.
- Add comments for important functions.
- Keep routing providers modular.

---

## 20. Future Improvements

After the MVP works, possible improvements:

- Drag-and-drop destination reorder.
- Save route as JSON.
- Export route as GPX.
- Add more predefined train routes.
- Add metro-specific lines for cities.
- Add transport icons.
- Add travel duration estimates.
- Add real public transport routing using GTFS data.
- Add OpenRouteService integration for walking/cycling.
- Add local browser storage for recent routes.
- Add print-friendly itinerary page.
- Add QR code for share link.

---

## 21. Final Expected Behavior

A user should be able to:

1. Open the app.
2. Enter:

```txt
Porto
Vigo
Madrid
Barcelona
```

3. Choose `Train / Metro`.
4. Click `Build route`.
5. See the route on a CARTO map.
6. Copy a shareable route link.
7. Generate an AI itinerary prompt.
8. Paste that prompt into ChatGPT to get a prepared trip plan.

This should all work as a static GitHub Pages website.
