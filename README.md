# Hopway

A simple static travel route planner using Leaflet, CARTO maps, OpenStreetMap geocoding, and shareable URLs.

## Features

- Enter destinations manually
- Geocode places using OpenStreetMap
- Show markers on a CARTO map
- Draw road routes with OSRM
- Draw predefined train/metro route segments
- Generate shareable route links
- Generate copyable AI itinerary prompts

## Run locally

Open index.html directly in a browser, or use a simple local server:

```
python -m http.server 8080
```

Then open:

```
http://localhost:8080
```

## Notes

This app is static. It does not store user data. Route sharing works through URL parameters.

Road routing uses the public OSRM API. Train and metro routing uses predefined route geometry where available.
