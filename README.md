# Hopway — Plan Your Trip, Build Your Route

**Hopway** is a free, lightweight travel route planner that turns a list of destinations into a visual route on a beautiful map. No sign-ups, no downloads, no backend — just open, type, and go.

> Try it now: [danieljvsa.github.io/hopway](https://danieljvsa.github.io/hopway)

## What You Can Do

- **Enter any destinations** — type them one per line and Hopway finds them on the map
- **Choose your travel mode** — Road, Walking, or Train/Metro
- **See your route drawn live** — real road geometry from OSRM, predefined rail lines, or smart fallbacks
- **Reorder & remove stops** — adjust your trip on the fly
- **Share your route** — copy a link that anyone can open to see the exact same route
- **Generate an AI itinerary prompt** — paste it into ChatGPT or any AI assistant and get a full day-by-day plan with transport tips, food picks, and budget advice

## Quick Start

```
Porto
Vigo
Madrid
Barcelona
```

Paste that in, pick **Train / Metro**, hit **Build Route**, and watch it come together.

## Why Hopway?

| | Hopway | Other Planners |
|---|---|---|
| **Sign-up** | None required | Usually required |
| **Backend** | None — fully static | Server-dependent |
| **Privacy** | No data stored | Often tracked |
| **Share** | One link, no account | Account needed |
| **AI Itinerary** | Built-in prompt generator | Rarely included |
| **Cost** | Free, open-source | Often freemium |

## Tech Behind It

- **Leaflet.js** — interactive map rendering
- **CARTO Positron** — clean, light basemap tiles
- **Nominatim / OpenStreetMap** — free geocoding
- **OSRM** — public road routing API
- **Zero dependencies** — plain HTML, CSS, and JavaScript

## Run Locally

Open `index.html` directly in your browser, or start a local server:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`

## Share a Route

After building a route, click **Copy Share Link**. The URL encodes your destinations, travel mode, dates, budget, and style. Anyone who opens it will see the same route and can generate the same AI prompt.

Example shared URL:

```
https://danieljvsa.github.io/hopway/?places=Porto|Vigo|Madrid|Barcelona&mode=rail&start=2026-08-04&end=2026-08-07&budget=budget&style=fast-paced
```

## Roadmap

- Drag-and-drop destination reordering
- Export route as GPX
- More predefined train routes across Europe
- Real GTFS-based public transport routing
- Local storage for recent routes
- QR code generation for share links

## License

MIT — use it, modify it, deploy it.
