// ============================================================
// Trip Route Builder — Main Application (Improved)
// ============================================================

// --- Route line styles ---
const ROUTE_STYLES = {
  road:     { weight: 4, color: "#1b3a5c", opacity: 0.85 },
  walking:  { weight: 4, color: "#1e6b3f", opacity: 0.75, dashArray: "6, 8" },
  rail:     { weight: 5, color: "#b07d2a", opacity: 0.9 },
  fallback: { weight: 3, color: "#8a837a", opacity: 0.6, dashArray: "8, 10" }
};

// --- State ---
let map        = null;
let destinations  = [];   // { originalQuery, label, lat, lng }
let routeLayers   = [];   // Leaflet polylines
let markerLayers  = [];   // Leaflet markers
let isBuilding    = false;
let rebuildTimer  = null;

// --- Geocode cache (session memory, key = normalized query) ---
const geocodeCache = new Map();

// --- DOM shorthand ---
const $ = (sel) => document.querySelector(sel);

// ============================================================
// Map initialisation
// ============================================================
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([40.4, -3.7], 6);
  L.control.zoom({ position: "topright" }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 20
  }).addTo(map);
}

// ============================================================
// Geocoding — with in-memory cache
// ============================================================
async function geocodePlace(query) {
  const key = normalizePlaceName(query);
  if (geocodeCache.has(key)) {
    return { ...geocodeCache.get(key), originalQuery: query };
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const response = await fetch(url, { headers: { "Accept-Language": "en" } });

  if (!response.ok) throw new Error(`Failed to geocode: ${query}`);

  const results = await response.json();
  if (!results.length) throw new Error(`No result found for: ${query}`);

  const resolved = {
    label: results[0].display_name,
    lat:   Number(results[0].lat),
    lng:   Number(results[0].lon),
    originalQuery: query
  };

  geocodeCache.set(key, { label: resolved.label, lat: resolved.lat, lng: resolved.lng });
  return resolved;
}

// --- Sequential geocoding with progress feedback ---
async function geocodeAll(rawPlaces) {
  const results = [];
  const errors  = [];
  const total   = rawPlaces.filter(Boolean).length;

  showProgress(0, total);

  for (let i = 0; i < rawPlaces.length; i++) {
    const place = rawPlaces[i].trim();
    if (!place) continue;

    const current = results.length + errors.length + 1;
    setStatus(`Geocoding ${current}/${total}: ${place}…`, "info");
    showProgress(current - 1, total);

    try {
      results.push(await geocodePlace(place));
    } catch {
      errors.push(place);
      setStatus(`Could not find: "${place}". Try adding a country or city.`, "error");
    }

    // Respect Nominatim rate limit (1 req/s) — skip delay after last item
    if (i < rawPlaces.length - 1) {
      await sleep(1100);
    }
  }

  hideProgress();
  return { results, errors };
}

// ============================================================
// Build / draw route
// ============================================================
async function buildRoute() {
  if (isBuilding) return;

  const rawInput = $("#destinationsInput").value.trim();
  if (!rawInput) {
    setStatus("Enter at least two destinations to build a route.", "error");
    return;
  }

  const rawPlaces = rawInput.split("\n").map(s => s.trim()).filter(Boolean);

  if (rawPlaces.length < 2) {
    isBuilding = true;
    setBuildingUI(true);
    try {
      const resolved = await geocodePlace(rawPlaces[0]);
      clearMap();
      destinations = [resolved];
      addMarkers();
      renderDestinationList();
      map.setView([resolved.lat, resolved.lng], 10);
      setStatus("Add another destination to draw a route.", "info");
    } catch {
      setStatus(`Could not find: "${rawPlaces[0]}". Try adding country context.`, "error");
    }
    isBuilding = false;
    setBuildingUI(false);
    return;
  }

  isBuilding = true;
  setBuildingUI(true);

  try {
    clearMap();

    const { results, errors } = await geocodeAll(rawPlaces);

    if (results.length < 2) {
      setStatus("Need at least two valid destinations to build a route.", "error");
      isBuilding = false;
      setBuildingUI(false);
      return;
    }

    destinations = results;
    addMarkers();
    renderDestinationList();

    const mode = $("#routeMode").value;
    await drawRoute(mode);

    const errNote = errors.length ? ` (${errors.length} not found)` : "";
    setStatus(`Route built: ${destinations.length} stops via ${modeLabel(mode)}${errNote}.`, "success");
  } catch (err) {
    setStatus(`Error building route: ${err.message}`, "error");
  }

  isBuilding = false;
  setBuildingUI(false);
}

// --- Draw all segments ---
async function drawRoute(mode) {
  const warnings = [];

  for (let i = 0; i < destinations.length - 1; i++) {
    const from = destinations[i];
    const to   = destinations[i + 1];

    let segmentCoords = null;
    let style = ROUTE_STYLES[mode];

    try {
      if (mode === "road") {
        segmentCoords = await getRoadRouteSegment(from, to);
      } else if (mode === "walking") {
        try {
          segmentCoords = await getWalkingRouteSegment(from, to);
        } catch {
          segmentCoords = await getRoadRouteSegment(from, to);
          warnings.push(`Walking profile unavailable for ${from.originalQuery} → ${to.originalQuery}; showing road path.`);
        }
      } else if (mode === "rail") {
        const key = routeKey(from, to);
        if (PREDEFINED_RAIL_ROUTES[key]) {
          segmentCoords = PREDEFINED_RAIL_ROUTES[key];
          style = ROUTE_STYLES.rail;
        } else {
          segmentCoords = [[from.lat, from.lng], [to.lat, to.lng]];
          style = ROUTE_STYLES.fallback;
          warnings.push(`No rail geometry for ${from.originalQuery} → ${to.originalQuery}; showing approximate line.`);
        }
      }
    } catch {
      segmentCoords = [[from.lat, from.lng], [to.lat, to.lng]];
      style = ROUTE_STYLES.fallback;
      warnings.push(`Routing failed for ${from.originalQuery} → ${to.originalQuery}; showing straight line.`);
    }

    if (segmentCoords) {
      routeLayers.push(L.polyline(segmentCoords, style).addTo(map));
    }
  }

  if (warnings.length) {
    setStatus(warnings.join("\n"), "warning");
  }

  fitMap();
}

// ============================================================
// OSRM fetchers
// ============================================================
async function getRoadRouteSegment(from, to) {
  return fetchOsrmSegment("driving", from, to);
}

async function getWalkingRouteSegment(from, to) {
  return fetchOsrmSegment("foot", from, to);
}

async function fetchOsrmSegment(profile, from, to) {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`OSRM error (${profile})`);
  const data = await res.json();
  if (!data.routes?.length) throw new Error("No route found");
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

// ============================================================
// Markers
// ============================================================
function addMarkers() {
  const mode = $("#routeMode").value;
  destinations.forEach((dest, i) => {
    const marker = L.marker([dest.lat, dest.lng]).addTo(map);
    marker.bindPopup(buildPopupHtml(dest, i, mode));
    markerLayers.push(marker);
  });
}

function buildPopupHtml(dest, i, mode) {
  return `
    <strong>${i + 1}. ${dest.originalQuery}</strong><br>
    <span style="color:#8a837a;font-size:11px">${dest.label}</span><br>
    <span style="font-size:11px">${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}</span><br>
    <span style="font-size:11px">Mode: ${modeLabel(mode)}</span>
  `;
}

// ============================================================
// Destination list rendering — uses event delegation
// ============================================================
function renderDestinationList() {
  const container = $("#destinationList");

  if (!destinations.length) {
    container.innerHTML = '<p class="empty-state">Add destinations above and click Build Route.</p>';
    return;
  }

  const html = destinations.map((dest, i) => {
    const connector = i < destinations.length - 1
      ? `<div class="dest-connector"></div>`
      : "";
    return `
      <div class="dest-card" data-index="${i}">
        <span class="dest-number">${i + 1}</span>
        <div class="dest-info">
          <div class="dest-original">${escapeHtml(dest.originalQuery)}</div>
          <div class="dest-matched">${escapeHtml(dest.label)}</div>
        </div>
        <div class="dest-actions">
          <button class="move-up-btn"   data-index="${i}" title="Move up"   ${i === 0 ? "disabled" : ""}>▴</button>
          <button class="move-down-btn" data-index="${i}" title="Move down" ${i === destinations.length - 1 ? "disabled" : ""}>▾</button>
          <button class="remove-btn"    data-index="${i}" title="Remove">&times;</button>
        </div>
      </div>
      ${connector}
    `;
  }).join("");

  container.innerHTML = html;
}

// Event delegation — single listener on the container
function initDestinationListEvents() {
  $("#destinationList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    if (btn.classList.contains("move-up-btn"))   moveDestination(index, -1);
    if (btn.classList.contains("move-down-btn"))  moveDestination(index,  1);
    if (btn.classList.contains("remove-btn"))     removeDestination(index);
  });
}

function moveDestination(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= destinations.length) return;
  [destinations[index], destinations[newIndex]] = [destinations[newIndex], destinations[index]];
  renderDestinationList();
  debouncedRebuild();
}

function removeDestination(index) {
  destinations.splice(index, 1);
  renderDestinationList();
  if (destinations.length >= 2) {
    debouncedRebuild();
  } else {
    clearMapLayers();
    addMarkers();
  }
}

// Debounced rebuild to avoid rapid consecutive calls
function debouncedRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuildRoute, 120);
}

async function rebuildRoute() {
  if (destinations.length < 2) return;
  clearRouteLines();
  await drawRoute($("#routeMode").value);
}

// ============================================================
// Clear helpers
// ============================================================
function clearMap() {
  clearMapLayers();
  destinations = [];
}

function clearMapLayers() {
  clearRouteLines();
  markerLayers.forEach(m => map.removeLayer(m));
  markerLayers = [];
}

function clearRouteLines() {
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
}

// ============================================================
// Fit map
// ============================================================
function fitMap() {
  if (!markerLayers.length) return;
  const group = L.featureGroup(markerLayers);
  map.fitBounds(group.getBounds().pad(0.15));
}

// ============================================================
// Share URL
// ============================================================
function buildShareUrl() {
  const params = new URLSearchParams();
  params.set("places", destinations.map(d => encodeURIComponent(d.originalQuery)).join("|"));
  params.set("mode", $("#routeMode").value);
  const startDate = $("#startDate").value;
  const endDate   = $("#endDate").value;
  const budget    = $("#budgetStyle").value;
  const style     = $("#travelStyle").value;
  if (startDate) params.set("start", startDate);
  if (endDate)   params.set("end", endDate);
  if (budget)    params.set("budget", budget);
  if (style)     params.set("style", style);
  return `${location.origin}${location.pathname}?${params}`;
}

async function copyShareUrl() {
  if (!destinations.length) {
    setStatus("Build a route first to generate a share link.", "error");
    return;
  }
  await copyToClipboard(buildShareUrl());
  setStatus("Share link copied to clipboard!", "success");
}

// ============================================================
// Load state from URL
// ============================================================
function loadStateFromUrl() {
  const params = new URLSearchParams(location.search);

  const places = params.get("places");
  if (places) {
    $("#destinationsInput").value = places.split("|").map(decodeURIComponent).join("\n");
  }

  const mode = params.get("mode");
  if (mode) {
    $("#routeMode").value = mode;
    syncModeTabs(mode);
  }

  if (params.get("start")) $("#startDate").value = params.get("start");
  if (params.get("end"))   $("#endDate").value   = params.get("end");
  if (params.get("budget")) $("#budgetStyle").value = params.get("budget");
  if (params.get("style"))  $("#travelStyle").value = params.get("style");

  if (places) buildRoute();
}

// ============================================================
// AI Prompt Generator
// ============================================================
function generatePrompt() {
  if (!destinations.length) {
    setStatus("Build a route first, then generate an AI prompt.", "error");
    return;
  }

  const destString  = destinations.map(d => d.originalQuery).join(" → ");
  const startDate   = $("#startDate").value   || "Not specified";
  const endDate     = $("#endDate").value     || "Not specified";
  const budgetStyle = $("#budgetStyle").value;
  const travelStyle = $("#travelStyle").value;

  const prompt = `Create a practical travel itinerary for this route:
${destString}

Transport preference: ${modeLabel($("#routeMode").value)}
Dates: ${startDate} to ${endDate}
Budget: ${capitalize(budgetStyle)}
Travel style: ${capitalize(travelStyle)}${getPoisForPrompt()}

Please include:
- Realistic transport options between each destination
- Estimated travel times
- Recommended daily plan
- Places to visit
- Food recommendations
- Public transport tips
- Budget-saving tips
- Warnings about tight connections
- Optional alternative routes

Assume the user prefers affordable options and public transport where possible.`;

  $("#aiPromptOutput").value = prompt;
}

async function copyPrompt() {
  const text = $("#aiPromptOutput").value;
  if (!text) {
    setStatus("Generate a prompt first.", "error");
    return;
  }
  await copyToClipboard(text);
  setStatus("AI prompt copied to clipboard!", "success");
}

// ============================================================
// Clipboard helper
// ============================================================
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

// ============================================================
// Status messages
// ============================================================
function setStatus(message, type = "info") {
  const section = $("#statusSection");
  const el      = $("#statusMessage");
  el.textContent = message;
  el.className   = `status-message ${type}`;
  section.style.display = "";
}

function clearStatus() {
  $("#statusSection").style.display = "none";
}

// ============================================================
// Progress bar
// ============================================================
function showProgress(done, total) {
  const bar  = $("#progressBar");
  const fill = $("#progressFill");
  bar.classList.add("active");
  fill.style.width = `${Math.round((done / total) * 100)}%`;
}

function hideProgress() {
  const bar  = $("#progressBar");
  const fill = $("#progressFill");
  bar.classList.remove("active");
  fill.style.width = "0%";
}

// ============================================================
// Building UI state
// ============================================================
function setBuildingUI(building) {
  const label = $("#buildBtnLabel");
  const btn   = $("#buildRouteBtn");
  if (building) {
    label.innerHTML = '<span class="spinner"></span> Building…';
    btn.disabled = true;
    ["fitMapBtn","clearRouteBtn","copyShareBtn","generatePromptBtn","copyPromptBtn"]
      .forEach(id => { const el = $(` #${id}`); if (el) el.disabled = true; });
  } else {
    label.textContent = "Build Route";
    btn.disabled = false;
    ["fitMapBtn","clearRouteBtn","copyShareBtn","generatePromptBtn","copyPromptBtn"]
      .forEach(id => { const el = $(`#${id}`); if (el) el.disabled = false; });
  }
}

// ============================================================
// Mode tabs (visual) synced with hidden <select>
// ============================================================
function initModeTabs() {
  const tabs   = document.querySelectorAll(".mode-tab");
  const select = $("#routeMode");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      select.value = mode;
      syncModeTabs(mode);

      if (destinations.length >= 2) {
        // Update marker popups
        markerLayers.forEach((m, i) => {
          m.setPopupContent(buildPopupHtml(destinations[i], i, mode));
        });
        clearRouteLines();
        debouncedRebuild();
      }
    });
  });
}

function syncModeTabs(mode) {
  document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
}

// ============================================================
// Sidebar toggle (mobile)
// ============================================================
function initSidebarToggle() {
  const sidebar = $("#sidebar");
  $("#sidebarToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  $("#closeSidebar").addEventListener("click",  () => sidebar.classList.remove("open"));
}

// ============================================================
// Event listeners
// ============================================================
function initEvents() {
  $("#buildRouteBtn").addEventListener("click", buildRoute);
  $("#fitMapBtn").addEventListener("click", fitMap);
  $("#clearRouteBtn").addEventListener("click", () => {
    clearMap();
    renderDestinationList();
    clearStatus();
    hideProgress();
    $("#destinationsInput").value = "";
  });
  $("#copyShareBtn").addEventListener("click", copyShareUrl);
  $("#generatePromptBtn").addEventListener("click", generatePrompt);
  $("#copyPromptBtn").addEventListener("click", copyPrompt);
}

// ============================================================
// Helpers
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function modeLabel(mode) {
  return { road: "Road", walking: "Walking", rail: "Train / Metro" }[mode] || mode;
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// Places of Interest (POI)
// ============================================================

const POI_CATEGORIES = {
  hostel:    { label: "Hostel",    color: "#1b3a5c", bg: "#d6e4f0", emoji: "🛏" },
  culture:   { label: "Culture",   color: "#7b3fa0", bg: "#f0e6f8", emoji: "🏛" },
  food:      { label: "Food",      color: "#c0392b", bg: "#fdecea", emoji: "🍽" },
  nature:    { label: "Nature",    color: "#1e6b3f", bg: "#e6f4ed", emoji: "🌿" },
  transport: { label: "Transport", color: "#b07d2a", bg: "#fdf5e6", emoji: "🚉" },
  other:     { label: "Other",     color: "#5a5a5a", bg: "#efefef", emoji: "📌" }
};

let pois         = [];   // { id, name, note, cat, lat, lng, visible }
let poiMarkers   = {};   // id → Leaflet marker
let activeCat    = "hostel";

function initPoi() {
  // Category chip clicks
  $("#poiCategories").addEventListener("click", (e) => {
    const btn = e.target.closest(".poi-cat");
    if (!btn) return;
    document.querySelectorAll(".poi-cat").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeCat = btn.dataset.cat;
    // Update button color to match category
    document.querySelectorAll(".poi-cat.active").forEach(b => {
      b.style.background = POI_CATEGORIES[activeCat].color;
      b.style.borderColor = POI_CATEGORIES[activeCat].color;
    });
  });

  // Reset other chips' inline styles when deselected
  document.querySelectorAll(".poi-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".poi-cat:not(.active)").forEach(b => {
        b.style.background = "";
        b.style.borderColor = "";
      });
    });
  });

  // Add pin button
  $("#addPoiBtn").addEventListener("click", addPoi);
  $("#poiInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPoi();
  });

  // List event delegation (toggle visibility + remove)
  $("#poiList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains("poi-remove-btn")) removePoi(id);
    if (btn.classList.contains("poi-toggle-btn")) togglePoiVisibility(id);
  });

  renderPoiList();
}

async function addPoi() {
  const input = $("#poiInput");
  const noteEl = $("#poiNote");
  const name = input.value.trim();
  if (!name) {
    setStatus("Enter a place name or address to add a pin.", "error");
    return;
  }

  $("#addPoiBtn").disabled = true;
  $("#addPoiBtn").textContent = "Searching…";

  try {
    const resolved = await geocodePlace(name);
    const id = `poi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const poi = {
      id,
      name: resolved.originalQuery,
      label: resolved.label,
      note: noteEl.value.trim(),
      cat: activeCat,
      lat: resolved.lat,
      lng: resolved.lng,
      visible: true
    };
    pois.push(poi);
    addPoiMarker(poi);
    renderPoiList();
    input.value = "";
    noteEl.value = "";
    setStatus(`Pinned: ${poi.name}`, "success");
  } catch {
    setStatus(`Could not find "${name}". Try a more specific address.`, "error");
  }

  $("#addPoiBtn").disabled = false;
  $("#addPoiBtn").textContent = "+ Add Pin";
}

function addPoiMarker(poi) {
  const cat = POI_CATEGORIES[poi.cat];
  const icon = L.divIcon({
    className: "",
    html: `<div style="
      width:30px; height:30px; border-radius:50% 50% 50% 0;
      background:${cat.color}; border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.25);
      display:flex; align-items:center; justify-content:center;
      font-size:13px; transform:rotate(-45deg);
    "><span style="transform:rotate(45deg);display:block">${cat.emoji}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -32]
  });

  const marker = L.marker([poi.lat, poi.lng], { icon }).addTo(map);
  marker.bindPopup(`
    <strong>${escapeHtml(poi.name)}</strong><br>
    <span style="
      display:inline-block; padding:1px 8px; border-radius:99px;
      background:${cat.bg}; color:${cat.color};
      font-size:10px; font-weight:600; text-transform:uppercase;
      letter-spacing:0.5px; margin:4px 0 2px;
    ">${cat.emoji} ${cat.label}</span>
    ${poi.note ? `<br><em style="font-size:11px;color:#8a837a">${escapeHtml(poi.note)}</em>` : ""}
    <br><span style="font-size:10px;color:#aaa">${poi.lat.toFixed(4)}, ${poi.lng.toFixed(4)}</span>
  `);

  poiMarkers[poi.id] = marker;
}

function removePoi(id) {
  const marker = poiMarkers[id];
  if (marker) { map.removeLayer(marker); delete poiMarkers[id]; }
  pois = pois.filter(p => p.id !== id);
  renderPoiList();
}

function togglePoiVisibility(id) {
  const poi = pois.find(p => p.id === id);
  if (!poi) return;
  poi.visible = !poi.visible;
  const marker = poiMarkers[id];
  if (marker) {
    if (poi.visible) {
      marker.addTo(map);
    } else {
      map.removeLayer(marker);
    }
  }
  renderPoiList();
}

function renderPoiList() {
  const container = $("#poiList");
  if (!pois.length) {
    container.innerHTML = '<p class="empty-state">No pins yet — pick a category and add a place.</p>';
    return;
  }

  container.innerHTML = pois.map(poi => {
    const cat = POI_CATEGORIES[poi.cat];
    return `
      <div class="poi-card">
        <div class="poi-dot" style="background:${cat.color}"></div>
        <div class="poi-card-info">
          <div class="poi-card-name">${escapeHtml(poi.name)}</div>
          <div class="poi-card-meta">
            <span class="poi-badge" style="background:${cat.bg};color:${cat.color}">${cat.emoji} ${cat.label}</span>
            ${poi.note ? `<span class="poi-card-note">${escapeHtml(poi.note)}</span>` : ""}
          </div>
        </div>
        <button class="poi-toggle-btn ${poi.visible ? "" : "hidden-pin"}" data-id="${poi.id}" title="${poi.visible ? "Hide on map" : "Show on map"}">
          ${poi.visible ? "👁" : "🚫"}
        </button>
        <button class="poi-remove-btn" data-id="${poi.id}" title="Remove pin">&times;</button>
      </div>
    `;
  }).join("");
}

// Expose pois to generatePrompt (patch it in place below)
function getPoisForPrompt() {
  if (!pois.length) return "";
  const byCategory = {};
  pois.forEach(p => {
    const label = POI_CATEGORIES[p.cat].label;
    if (!byCategory[label]) byCategory[label] = [];
    byCategory[label].push(p.name + (p.note ? ` (${p.note})` : ""));
  });
  return "\n\nPoints of interest:\n" +
    Object.entries(byCategory)
      .map(([cat, places]) => `${cat}: ${places.join(", ")}`)
      .join("\n");
}

// ============================================================
// Boot
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initSidebarToggle();
  initModeTabs();
  initEvents();
  initDestinationListEvents();
  initPoi();
  loadStateFromUrl();
});
