// ============================================================
// Hopway — Main Application
// ============================================================

const ROUTE_STYLES = {
  road:     { weight: 4, color: "#1b3a5c", opacity: 0.85 },
  walking:  { weight: 4, color: "#1e6b3f", opacity: 0.75, dashArray: "6, 8" },
  rail:     { weight: 5, color: "#b07d2a", opacity: 0.9 },
  fallback: { weight: 3, color: "#8a837a", opacity: 0.6, dashArray: "8, 10" }
};

const POI_CATEGORIES = {
  hostel:    { label: "Hostel",    color: "#1b3a5c", bg: "#d6e4f0", emoji: "🛏" },
  culture:   { label: "Culture",   color: "#7b3fa0", bg: "#f0e6f8", emoji: "🏛" },
  food:      { label: "Food",      color: "#c0392b", bg: "#fdecea", emoji: "🍽" },
  nature:    { label: "Nature",    color: "#1e6b3f", bg: "#e6f4ed", emoji: "🌿" },
  transport: { label: "Transport", color: "#b07d2a", bg: "#fdf5e6", emoji: "🚉" },
  other:     { label: "Other",     color: "#5a5a5a", bg: "#efefef", emoji: "📌" }
};

// --- State ---
let map          = null;
let destinations = [];   // { originalQuery, label, lat, lng, description, imageUrl }
let routeLayers  = [];
let markerLayers = [];
let isBuilding   = false;
let rebuildTimer = null;
let pois         = [];   // { id, name, label, note, description, imageUrl, cat, lat, lng, visible }
let poiMarkers   = {};
let activeCat    = "hostel";
let editingTarget = null;

const geocodeCache = new Map();
const $ = (sel) => document.querySelector(sel);

// ============================================================
// Presentation / view mode
// ============================================================
const IS_VIEW_MODE = new URLSearchParams(location.search).get("view") === "1";

// ============================================================
// Map init
// ============================================================
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([40.4, -3.7], 6);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: "abcd", maxZoom: 20
  }).addTo(map);
}

// ============================================================
// Geocoding
// ============================================================
async function geocodePlace(query) {
  const key = normalizePlaceName(query);
  if (geocodeCache.has(key)) return { ...geocodeCache.get(key), originalQuery: query };
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Failed to geocode: ${query}`);
  const results = await res.json();
  if (!results.length) throw new Error(`No result found for: ${query}`);
  const resolved = { label: results[0].display_name, lat: Number(results[0].lat), lng: Number(results[0].lon), originalQuery: query };
  geocodeCache.set(key, { label: resolved.label, lat: resolved.lat, lng: resolved.lng });
  return resolved;
}

async function geocodeAll(rawPlaces) {
  const results = [], errors = [];
  const total = rawPlaces.filter(Boolean).length;
  showProgress(0, total);
  for (let i = 0; i < rawPlaces.length; i++) {
    const place = rawPlaces[i].trim();
    if (!place) continue;
    // Check for manually entered coordinates for this row
    const latEl = document.getElementById(`destLat${i}`);
    const lngEl = document.getElementById(`destLng${i}`);
    const manualLat = latEl ? parseFloat(latEl.value) : NaN;
    const manualLng = lngEl ? parseFloat(lngEl.value) : NaN;
    if (!isNaN(manualLat) && !isNaN(manualLng)) {
      results.push({ originalQuery: place, label: `${place} (manual)`, lat: manualLat, lng: manualLng });
      showProgress(results.length + errors.length, total);
      continue;
    }
    setStatus(`Geocoding ${results.length + errors.length + 1}/${total}: ${place}...`, "info");
    showProgress(results.length + errors.length, total);
    try { results.push(await geocodePlace(place)); }
    catch { errors.push(place); }
    if (i < rawPlaces.length - 1) await sleep(1100);
  }
  hideProgress();
  return { results, errors };
}

// ============================================================
// Build route
// ============================================================
async function buildRoute() {
  if (isBuilding) return;
  const rawInput = $("#destinationsInput").value.trim();
  if (!rawInput) { setStatus("Enter at least two destinations.", "error"); return; }
  const rawPlaces = rawInput.split("\n").map(s => s.trim()).filter(Boolean);

  isBuilding = true;
  setBuildingUI(true);

  try {
    // Preserve existing customisations by originalQuery key
    const existingMeta = {};
    destinations.forEach(d => { existingMeta[d.originalQuery] = { description: d.description, imageUrl: d.imageUrl }; });

    clearMap();
    if (rawPlaces.length < 2) {
      const resolved = await geocodePlace(rawPlaces[0]);
      destinations = [Object.assign(resolved, existingMeta[resolved.originalQuery] || {})];
      addMarkers(); renderDestinationList();
      map.setView([resolved.lat, resolved.lng], 10);
      setStatus("Add another destination to draw a route.", "info");
    } else {
      const { results, errors } = await geocodeAll(rawPlaces);
      if (results.length < 2) { setStatus("Need at least two valid destinations.", "error"); isBuilding = false; setBuildingUI(false); return; }
      destinations = results.map(r => Object.assign(r, existingMeta[r.originalQuery] || {}));
      addMarkers(); renderDestinationList();
      await drawRoute($("#routeMode").value);
      const errNote = errors.length ? ` (${errors.length} not found)` : "";
      setStatus(`Route built: ${destinations.length} stops${errNote}.`, "success");
    }
  } catch (err) { setStatus(`Error: ${err.message}`, "error"); }

  isBuilding = false; setBuildingUI(false);
}

// ============================================================
// Draw route segments
// ============================================================
async function drawRoute(mode) {
  const warnings = [];
  for (let i = 0; i < destinations.length - 1; i++) {
    const from = destinations[i], to = destinations[i + 1];
    let coords = null, style = ROUTE_STYLES[mode];
    try {
      if (mode === "road") coords = await fetchOsrmSegment("driving", from, to);
      else if (mode === "walking") {
        try { coords = await fetchOsrmSegment("foot", from, to); }
        catch { coords = await fetchOsrmSegment("driving", from, to); warnings.push(`Walking fallback: ${from.originalQuery} to ${to.originalQuery}`); }
      } else if (mode === "rail") {
        const key = routeKey(from, to);
        if (PREDEFINED_RAIL_ROUTES[key]) { coords = PREDEFINED_RAIL_ROUTES[key]; }
        else { coords = [[from.lat, from.lng], [to.lat, to.lng]]; style = ROUTE_STYLES.fallback; warnings.push(`Approximate line: ${from.originalQuery} to ${to.originalQuery}`); }
      }
    } catch { coords = [[from.lat, from.lng], [to.lat, to.lng]]; style = ROUTE_STYLES.fallback; warnings.push(`Routing failed: ${from.originalQuery} to ${to.originalQuery}`); }
    if (coords) routeLayers.push(L.polyline(coords, style).addTo(map));
  }
  if (warnings.length) setStatus(warnings.join(" | "), "warning");
  fitMap();
}

async function fetchOsrmSegment(profile, from, to) {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("OSRM error");
  const data = await res.json();
  if (!data.routes?.length) throw new Error("No route");
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

// ============================================================
// Markers - route destinations
// ============================================================
function makeDestIcon(index) {
  return L.divIcon({
    className: "",
    html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:#1b3a5c;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;color:#fff;font-size:12px;font-weight:600;transform:rotate(-45deg)"><span style="transform:rotate(45deg)">${index + 1}</span></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -36]
  });
}

function addMarkers() {
  const mode = $("#routeMode") ? $("#routeMode").value : "rail";
  destinations.forEach((dest, i) => {
    const marker = L.marker([dest.lat, dest.lng], { icon: makeDestIcon(i) }).addTo(map);
    marker.bindPopup(buildDestPopup(dest, i, mode), { maxWidth: 280 });
    if (!IS_VIEW_MODE) {
      marker.on("popupopen", () => {
        const btn = document.querySelector(`.popup-edit-btn[data-index="${i}"]`);
        if (btn) btn.addEventListener("click", () => openEditModal("dest", i));
      });
    }
    markerLayers.push(marker);
  });
}

function refreshDestMarkerPopup(index) {
  const marker = markerLayers[index];
  if (!marker) return;
  const mode = $("#routeMode") ? $("#routeMode").value : "rail";
  marker.setPopupContent(buildDestPopup(destinations[index], index, mode));
}

function buildDestPopup(dest, i, mode) {
  const hasImg  = dest.imageUrl;
  const hasDesc = dest.description;
  return `<div class="map-popup">${hasImg ? `<img src="${dest.imageUrl}" alt="" class="popup-img">` : ""}<div class="popup-body"><div class="popup-stop-num">${modeLabel(mode)} &middot; Stop ${i + 1}</div><strong class="popup-title">${escapeHtml(dest.originalQuery)}</strong>${hasDesc ? `<p class="popup-desc">${escapeHtml(dest.description)}</p>` : ""}<div class="popup-coords">${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}</div>${!IS_VIEW_MODE ? `<button class="popup-edit-btn" data-index="${i}">&#9998; Edit details</button>` : ""}</div></div>`;
}

// ============================================================
// Markers - POIs
// ============================================================
function makePoiIcon(cat) {
  const c = POI_CATEGORIES[cat];
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;width:36px"><div style="width:34px;height:34px;border-radius:50%;background:#fff;border:3px solid ${c.color};box-shadow:0 2px 8px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1">${c.emoji}</div><div style="width:3px;height:8px;background:${c.color};border-radius:0 0 2px 2px;margin-top:-1px"></div></div>`,
    iconSize: [36, 44], iconAnchor: [18, 44], popupAnchor: [0, -46]
  });
}

function addPoiMarker(poi) {
  const marker = L.marker([poi.lat, poi.lng], { icon: makePoiIcon(poi.cat) }).addTo(map);
  marker.bindPopup(buildPoiPopup(poi), { maxWidth: 280 });
  if (!IS_VIEW_MODE) {
    marker.on("popupopen", () => {
      const btn = document.querySelector(`.popup-edit-btn[data-poi-id="${poi.id}"]`);
      if (btn) btn.addEventListener("click", () => openEditModal("poi", poi.id));
    });
  }
  poiMarkers[poi.id] = marker;
}

function refreshPoiMarkerPopup(id) {
  const poi = pois.find(p => p.id === id);
  if (!poi || !poiMarkers[id]) return;
  poiMarkers[id].setPopupContent(buildPoiPopup(poi));
}

function buildPoiPopup(poi) {
  const cat = POI_CATEGORIES[poi.cat];
  const hasImg  = poi.imageUrl;
  const hasDesc = poi.description || poi.note;
  return `<div class="map-popup">${hasImg ? `<img src="${poi.imageUrl}" alt="" class="popup-img">` : ""}<div class="popup-body"><span class="popup-badge" style="background:${cat.bg};color:${cat.color}">${cat.emoji} ${cat.label}</span><strong class="popup-title">${escapeHtml(poi.name)}</strong>${hasDesc ? `<p class="popup-desc">${escapeHtml(poi.description || poi.note)}</p>` : ""}<div class="popup-coords">${poi.lat.toFixed(4)}, ${poi.lng.toFixed(4)}</div>${!IS_VIEW_MODE ? `<button class="popup-edit-btn" data-poi-id="${poi.id}">&#9998; Edit details</button>` : ""}</div></div>`;
}

// ============================================================
// Edit modal
// ============================================================
function openEditModal(type, indexOrId) {
  editingTarget = { type, indexOrId };
  const item = type === "dest" ? destinations[indexOrId] : pois.find(p => p.id === indexOrId);
  if (!item) return;
  $("#editModalTitle").textContent = type === "dest" ? `Edit stop: ${item.originalQuery}` : `Edit pin: ${item.name}`;
  $("#editDescription").value = item.description || "";
  $("#editImageUrl").value = item.imageUrl || "";
  const wrap = $("#editImagePreviewWrap");
  const preview = $("#editImagePreview");
  if (item.imageUrl) {
    preview.src = item.imageUrl;
    wrap.style.display = "block";
  } else {
    preview.src = "";
    wrap.style.display = "none";
  }
  $("#editModal").classList.add("open");
  setTimeout(() => $("#editDescription").focus(), 50);
}

function closeEditModal() {
  $("#editModal").classList.remove("open");
  editingTarget = null;
}

function saveEditModal() {
  if (!editingTarget) return;
  const { type, indexOrId } = editingTarget;
  const description = $("#editDescription").value.trim();
  const imageUrl    = $("#editImageUrl").value.trim();

  if (type === "dest") {
    destinations[indexOrId].description = description;
    destinations[indexOrId].imageUrl    = imageUrl;
    refreshDestMarkerPopup(indexOrId);
    renderDestinationList();
  } else {
    const poi = pois.find(p => p.id === indexOrId);
    if (poi) { poi.description = description; poi.imageUrl = imageUrl; refreshPoiMarkerPopup(indexOrId); renderPoiList(); }
  }
  closeEditModal();
}

function initEditModal() {
  $("#editModal").addEventListener("click", (e) => { if (e.target === $("#editModal")) closeEditModal(); });
  $("#editModalClose").addEventListener("click", closeEditModal);
  $("#editModalSave").addEventListener("click", saveEditModal);
  $("#editModalCancel").addEventListener("click", closeEditModal);

  // Load image from URL
  function loadImageUrl() {
    const url = $("#editImageUrl").value.trim();
    const wrap = $("#editImagePreviewWrap");
    const preview = $("#editImagePreview");
    if (!url) { wrap.style.display = "none"; preview.src = ""; return; }
    preview.src = url;
    preview.onload  = () => { wrap.style.display = "block"; };
    preview.onerror = () => { wrap.style.display = "none"; setStatus("Could not load image — check the URL is a direct image link.", "error"); };
  }

  $("#editImageLoad").addEventListener("click", loadImageUrl);
  $("#editImageUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); loadImageUrl(); } });

  $("#editImageRemove").addEventListener("click", () => {
    $("#editImageUrl").value = "";
    $("#editImagePreview").src = "";
    $("#editImagePreviewWrap").style.display = "none";
  });

  document.addEventListener("keydown", (e) => {
    if (!$("#editModal").classList.contains("open")) return;
    if (e.key === "Escape") closeEditModal();
  });
}

// ============================================================
// Destination list rendering
// ============================================================
function renderDestinationList() {
  const container = $("#destinationList");
  if (!destinations.length) {
    container.innerHTML = '<p class="empty-state">Add destinations above and click Build Route.</p>';
    return;
  }
  container.innerHTML = destinations.map((dest, i) => {
    const hasCustom = dest.description || dest.imageUrl;
    const connector = i < destinations.length - 1 ? `<div class="dest-connector"></div>` : "";
    return `<div class="dest-card" data-index="${i}"><span class="dest-number">${i + 1}</span><div class="dest-info"><div class="dest-original">${escapeHtml(dest.originalQuery)}${hasCustom ? ' <span class="dest-has-custom" title="Has details">&#9733;</span>' : ""}</div><div class="dest-matched">${escapeHtml(dest.label)}</div></div><div class="dest-actions"><button class="edit-dest-btn" data-index="${i}" title="Edit details">&#9998;</button><button class="move-up-btn" data-index="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>&#9652;</button><button class="move-down-btn" data-index="${i}" title="Move down" ${i === destinations.length - 1 ? "disabled" : ""}>&#9662;</button><button class="remove-btn" data-index="${i}" title="Remove">&times;</button></div></div>${connector}`;
  }).join("");
}

function initDestinationListEvents() {
  $("#destinationList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    if (btn.classList.contains("edit-dest-btn"))  openEditModal("dest", index);
    if (btn.classList.contains("move-up-btn"))    moveDestination(index, -1);
    if (btn.classList.contains("move-down-btn"))  moveDestination(index,  1);
    if (btn.classList.contains("remove-btn"))     removeDestination(index);
  });
}

function moveDestination(index, direction) {
  const ni = index + direction;
  if (ni < 0 || ni >= destinations.length) return;
  [destinations[index], destinations[ni]] = [destinations[ni], destinations[index]];
  renderDestinationList(); debouncedRebuild();
}

function removeDestination(index) {
  destinations.splice(index, 1);
  renderDestinationList();
  if (destinations.length >= 2) debouncedRebuild();
  else { clearMapLayers(); addMarkers(); }
}

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
function clearMap() { clearMapLayers(); destinations = []; }
function clearMapLayers() { clearRouteLines(); markerLayers.forEach(m => map.removeLayer(m)); markerLayers = []; }
function clearRouteLines() { routeLayers.forEach(l => map.removeLayer(l)); routeLayers = []; }
function fitMap() {
  const all = [...markerLayers, ...Object.values(poiMarkers).filter(m => map.hasLayer(m))];
  if (!all.length) return;
  map.fitBounds(L.featureGroup(all).getBounds().pad(0.15));
}

// ============================================================
// POI section
// ============================================================
function initPoi() {
  $("#poiCategories").addEventListener("click", (e) => {
    const btn = e.target.closest(".poi-cat");
    if (!btn) return;
    document.querySelectorAll(".poi-cat").forEach(b => { b.classList.remove("active"); b.style.background = ""; b.style.borderColor = ""; });
    btn.classList.add("active");
    activeCat = btn.dataset.cat;
    btn.style.background  = POI_CATEGORIES[activeCat].color;
    btn.style.borderColor = POI_CATEGORIES[activeCat].color;
  });
  $("#addPoiBtn").addEventListener("click", addPoi);
  $("#poiInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addPoi(); });
  $("#poiList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains("poi-edit-btn"))   openEditModal("poi", id);
    if (btn.classList.contains("poi-remove-btn")) removePoi(id);
    if (btn.classList.contains("poi-toggle-btn")) togglePoiVisibility(id);
  });
  renderPoiList();
}

async function addPoi() {
  const input = $("#poiInput"), noteEl = $("#poiNote");
  const name = input.value.trim();
  if (!name) { setStatus("Enter a place name to add a pin.", "error"); return; }

  const manualLat = parseFloat($("#poiLat").value);
  const manualLng = parseFloat($("#poiLng").value);
  const hasManual = !isNaN(manualLat) && !isNaN(manualLng);

  $("#addPoiBtn").disabled = true; $("#addPoiBtn").textContent = hasManual ? "Adding..." : "Searching...";
  try {
    let lat, lng, label;
    if (hasManual) {
      lat = manualLat; lng = manualLng; label = `${name} (manual)`;
    } else {
      const resolved = await geocodePlace(name);
      lat = resolved.lat; lng = resolved.lng; label = resolved.label;
    }
    const id = `poi_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const poi = { id, name, label, note: noteEl.value.trim(), description: "", imageUrl: "", cat: activeCat, lat, lng, visible: true };
    pois.push(poi); addPoiMarker(poi); renderPoiList();
    input.value = ""; noteEl.value = "";
    $("#poiLat").value = ""; $("#poiLng").value = "";
    setStatus(`Pinned: ${poi.name}`, "success");
  } catch { setStatus(`Could not find "${name}".`, "error"); }
  $("#addPoiBtn").disabled = false; $("#addPoiBtn").textContent = "+ Add Pin";
}

function removePoi(id) {
  const m = poiMarkers[id]; if (m) { map.removeLayer(m); delete poiMarkers[id]; }
  pois = pois.filter(p => p.id !== id); renderPoiList();
}

function togglePoiVisibility(id) {
  const poi = pois.find(p => p.id === id); if (!poi) return;
  poi.visible = !poi.visible;
  const m = poiMarkers[id];
  if (m) { poi.visible ? m.addTo(map) : map.removeLayer(m); }
  renderPoiList();
}

function renderPoiList() {
  const container = $("#poiList");
  if (!pois.length) { container.innerHTML = '<p class="empty-state">No pins yet.</p>'; return; }
  container.innerHTML = pois.map(poi => {
    const cat = POI_CATEGORIES[poi.cat];
    const hasCustom = poi.description || poi.imageUrl;
    return `<div class="poi-card"><div class="poi-dot" style="background:${cat.color}"></div><div class="poi-card-info"><div class="poi-card-name">${escapeHtml(poi.name)}${hasCustom ? ' <span class="dest-has-custom">&#9733;</span>' : ""}</div><div class="poi-card-meta"><span class="poi-badge" style="background:${cat.bg};color:${cat.color}">${cat.emoji} ${cat.label}</span>${poi.note ? `<span class="poi-card-note">${escapeHtml(poi.note)}</span>` : ""}</div></div><button class="poi-edit-btn" data-id="${poi.id}" title="Edit details">&#9998;</button><button class="poi-toggle-btn ${poi.visible ? "" : "hidden-pin"}" data-id="${poi.id}" title="${poi.visible ? "Hide" : "Show"}">${poi.visible ? "&#128065;" : "&#128683;"}</button><button class="poi-remove-btn" data-id="${poi.id}" title="Remove">&times;</button></div>`;
  }).join("");
}

// ============================================================
// Share — full state encoded, opens presentation view
// ============================================================
function buildShareUrl() {
  // imageUrl is a plain URL string — tiny, safe to embed directly in the share URL
  const state = {
    places: destinations.map(d => ({ q: d.originalQuery, lat: d.lat, lng: d.lng, label: d.label, desc: d.description || "", img: d.imageUrl || "" })),
    pois:   pois.map(p => ({ id: p.id, name: p.name, label: p.label, note: p.note || "", cat: p.cat, lat: p.lat, lng: p.lng, visible: p.visible, desc: p.description || "", img: p.imageUrl || "" })),
    mode: $("#routeMode").value
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  return `${location.origin}${location.pathname}?view=1&state=${encoded}`;
}

async function openShareUrl() {
  if (!destinations.length) { setStatus("Build a route first.", "error"); return; }
  const url = buildShareUrl();
  if (url.length > 8000) {
    setStatus(`Share URL is too long (${url.length} chars). Try removing some destinations or POIs.`, "error");
    return;
  }
  await copyToClipboard(url);
  setStatus("Presentation link copied! Photos and all data are included in the link.", "success");
}

// ============================================================
// Load state from URL
// ============================================================
function loadStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const stateParam = params.get("state");

  if (stateParam) {
    try {
      const state = JSON.parse(decodeURIComponent(escape(atob(stateParam))));

      if (state.places?.length) {
        destinations = state.places.map(p => ({
          originalQuery: p.q, label: p.label, lat: p.lat, lng: p.lng,
          description: p.desc || "",
          imageUrl: p.img || ""
        }));
        state.places.forEach(p => geocodeCache.set(normalizePlaceName(p.q), { label: p.label, lat: p.lat, lng: p.lng }));
      }
      if (state.pois?.length) {
        pois = state.pois.map(p => ({
          ...p, description: p.desc || "",
          imageUrl: p.img || ""
        }));
      }
      if (!IS_VIEW_MODE) {
        if (state.mode)   { const el = $("#routeMode"); if (el) el.value = state.mode; syncModeTabs(state.mode); }
        if (state.start)  { const el = $("#startDate");  if (el) el.value = state.start; }
        if (state.end)    { const el = $("#endDate");    if (el) el.value = state.end; }
        if (state.budget) { const el = $("#budgetStyle"); if (el) el.value = state.budget; }
        if (state.style)  { const el = $("#travelStyle"); if (el) el.value = state.style; }
      } else {
        if (state.mode) syncModeTabs(state.mode);
      }
      if (destinations.length) {
        addMarkers();
        if (!IS_VIEW_MODE) { renderDestinationList(); renderPoiList(); }
        pois.forEach(p => { if (p.visible) addPoiMarker(p); });
        const mode = state.mode || "rail";
        drawRoute(mode).then(() => {
          if (IS_VIEW_MODE) buildPresentationPanel();
        });
        const destInput = $("#destinationsInput");
        if (destInput) destInput.value = destinations.map(d => d.originalQuery).join("\n");
      }
      return;
    } catch(e) { console.warn("Could not restore state:", e); }
  }

  // Legacy simple params
  const places = params.get("places");
  if (places) {
    const destInput = $("#destinationsInput");
    if (destInput) destInput.value = places.split("|").map(decodeURIComponent).join("\n");
    const mode = params.get("mode");
    if (mode) { const el = $("#routeMode"); if (el) el.value = mode; syncModeTabs(mode); }
    if (params.get("start")) { const el = $("#startDate"); if (el) el.value = params.get("start"); }
    if (params.get("end"))   { const el = $("#endDate");   if (el) el.value = params.get("end"); }
    buildRoute();
  }
}

// ============================================================
// Presentation view panel
// ============================================================
function buildPresentationPanel() {
  const panel = document.createElement("div");
  panel.className = "presentation-panel";

  const header = document.createElement("div");
  header.className = "presentation-header";
  const title = destinations.length > 3
    ? `${destinations[0].originalQuery} → ... → ${destinations[destinations.length-1].originalQuery}`
    : destinations.map(d => d.originalQuery).join(" → ");
  header.innerHTML = `<div class="presentation-eyebrow">Itinerary</div><div class="presentation-title">${escapeHtml(title)}</div>`;
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "presentation-list";

  destinations.forEach((dest, i) => {
    const item = document.createElement("div");
    item.className = "presentation-stop";
    item.innerHTML = `<div class="presentation-num">${i + 1}</div><div class="presentation-info"><div class="presentation-place">${escapeHtml(dest.originalQuery)}</div>${dest.description ? `<div class="presentation-desc">${escapeHtml(dest.description)}</div>` : ""}</div>`;
    item.addEventListener("click", () => { map.setView([dest.lat, dest.lng], 13, { animate: true }); markerLayers[i]?.openPopup(); });
    list.appendChild(item);
  });

  if (pois.length) {
    const sep = document.createElement("div");
    sep.className = "presentation-sep";
    sep.textContent = "Points of interest";
    list.appendChild(sep);
    pois.forEach(poi => {
      const cat = POI_CATEGORIES[poi.cat];
      const item = document.createElement("div");
      item.className = "presentation-stop presentation-poi";
      item.innerHTML = `<div class="presentation-poi-dot" style="background:${cat.color}">${cat.emoji}</div><div class="presentation-info"><div class="presentation-place">${escapeHtml(poi.name)}</div>${(poi.description || poi.note) ? `<div class="presentation-desc">${escapeHtml(poi.description || poi.note)}</div>` : ""}</div>`;
      item.addEventListener("click", () => { map.setView([poi.lat, poi.lng], 15, { animate: true }); poiMarkers[poi.id]?.openPopup(); });
      list.appendChild(item);
    });
  }

  panel.appendChild(list);
  document.body.appendChild(panel);

  const editLink = document.createElement("a");
  editLink.className = "presentation-edit-link";
  editLink.href = location.origin + location.pathname;
  editLink.textContent = "Back to editor";
  document.body.appendChild(editLink);
}

// ============================================================
// AI Prompt
// ============================================================
function generatePrompt() {
  if (!destinations.length) { setStatus("Build a route first.", "error"); return; }
  const destStr = destinations.map(d => d.originalQuery).join(" -> ");
  const prompt = `Create a practical travel itinerary for this route:\n${destStr}\n\nTransport: ${modeLabel($("#routeMode").value)}${getPoisForPrompt()}\n\nPlease include:\n- Transport options and travel times between each destination\n- Daily plan with recommended places to visit\n- Food recommendations\n- Budget and public transport tips\n- Optional alternative routes`;
  $("#aiPromptOutput").value = prompt;
}

function getPoisForPrompt() {
  if (!pois.length) return "";
  const by = {};
  pois.forEach(p => { const l = POI_CATEGORIES[p.cat].label; if (!by[l]) by[l] = []; by[l].push(p.name + (p.note ? ` (${p.note})` : "")); });
  return "\n\nPoints of interest:\n" + Object.entries(by).map(([c, ps]) => `${c}: ${ps.join(", ")}`).join("\n");
}

async function copyPrompt() {
  const text = $("#aiPromptOutput").value;
  if (!text) { setStatus("Generate a prompt first.", "error"); return; }
  await copyToClipboard(text); setStatus("AI prompt copied!", "success");
}

// ============================================================
// Clipboard
// ============================================================
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const el = document.createElement("textarea");
    el.value = text; el.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(el); el.focus(); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
  }
}

// ============================================================
// Status
// ============================================================
function setStatus(msg, type = "info") {
  const s = $("#statusSection"), el = $("#statusMessage");
  if (!s || !el) return;
  el.textContent = msg; el.className = `status-message ${type}`; s.style.display = "";
}
function clearStatus() { const s = $("#statusSection"); if (s) s.style.display = "none"; }

// ============================================================
// Progress
// ============================================================
function showProgress(done, total) {
  const bar = $("#progressBar"), fill = $("#progressFill");
  if (!bar || !fill) return;
  bar.classList.add("active");
  fill.style.width = `${Math.round((done / total) * 100)}%`;
}
function hideProgress() {
  const bar = $("#progressBar"), fill = $("#progressFill");
  if (!bar || !fill) return;
  bar.classList.remove("active"); fill.style.width = "0%";
}

// ============================================================
// Building UI
// ============================================================
function setBuildingUI(on) {
  const label = $("#buildBtnLabel"), btn = $("#buildRouteBtn");
  if (!label || !btn) return;
  if (on) { label.innerHTML = '<span class="spinner"></span> Building...'; btn.disabled = true; }
  else    { label.textContent = "Build Route"; btn.disabled = false; }
}

// ============================================================
// Mode tabs
// ============================================================
function initModeTabs() {
  document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      const sel = $("#routeMode"); if (sel) sel.value = mode;
      syncModeTabs(mode);
      if (destinations.length >= 2) {
        markerLayers.forEach((m, i) => m.setPopupContent(buildDestPopup(destinations[i], i, mode)));
        clearRouteLines(); debouncedRebuild();
      }
    });
  });
}
function syncModeTabs(mode) {
  document.querySelectorAll(".mode-tab").forEach(t => t.classList.toggle("active", t.dataset.mode === mode));
}

// ============================================================
// Sidebar toggle (mobile)
// ============================================================
function initSidebarToggle() {
  const sidebar = $("#sidebar");
  $("#sidebarToggle")?.addEventListener("click", () => sidebar.classList.toggle("open"));
  $("#closeSidebar")?.addEventListener("click", () => sidebar.classList.remove("open"));
}

// ============================================================
// Events
// ============================================================
function initEvents() {
  $("#buildRouteBtn")?.addEventListener("click", buildRoute);
  $("#fitMapBtn")?.addEventListener("click", fitMap);
  $("#clearRouteBtn")?.addEventListener("click", () => { clearMap(); renderDestinationList(); clearStatus(); hideProgress(); const i = $("#destinationsInput"); if (i) i.value = ""; });
  $("#copyShareBtn")?.addEventListener("click", openShareUrl);
}

// ============================================================
// Helpers
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function modeLabel(m) { return { road: "Road", walking: "Walking", rail: "Train / Metro" }[m] || m; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }

// ============================================================
// Boot
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();

  if (IS_VIEW_MODE) {
    const sidebar = document.getElementById("sidebar");
    const toggle  = document.getElementById("sidebarToggle");
    if (sidebar) sidebar.style.display = "none";
    if (toggle)  toggle.style.display  = "none";
    loadStateFromUrl();
    return;
  }

  initSidebarToggle();
  initModeTabs();
  initEvents();
  initDestinationListEvents();
  initPoi();
  initEditModal();
  loadStateFromUrl();
});
