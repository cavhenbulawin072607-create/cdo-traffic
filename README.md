# CDO Smart Traffic Light

A smart traffic light simulator and 3D city traffic monitor for Cagayan de Oro City, Misamis Oriental, Philippines. It compares fixed-timer traffic lights with adaptive (Smart) lights that give longer green to busier roads.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Close-up 2D simulation of one intersection (Cogon, Carmen, or the National Highway) with jeepneys, motorelas, trucks, and more |
| `city.html` | 3D map of the whole city with 40 real signalized intersections, live monitoring, charts, replay, and tools |
| `runs.html` | Saved runs from both simulators, filterable by location and mode |

## Real data vs. simulated

**Real**
- Map, roads, buildings, lane counts, traffic light locations, markets, hospitals: [OpenStreetMap](https://www.openstreetmap.org)
- Philippine holidays: [Nager.Date](https://date.nager.at)
- Hourly rain in CDO: [Open-Meteo](https://open-meteo.com)
- Ambulance routes on real roads: [OSRM](https://project-osrm.org)
- Live speeds, traffic colors, and incidents (optional): [TomTom Traffic API](https://developer.tomtom.com)

**Simulated**
- Vehicle queues at each light, and signal timings
- Road capacity uses the standard 1,800 vehicles per hour per lane, adjusted for rain, incidents, and side friction near markets
- Demand depends on time of day (CDO peak hours 7–8 AM and 4:30–7 PM), road size, nearby markets and terminals, and day type (weekday, weekend, payday, holiday, Kagay-an Festival)
- Any intersection can be calibrated with a real vehicle count

## Features (city map)

- Fixed Timer vs. Smart comparison with an hourly wait chart and a full-day simulation
- Green wave on C. M. Recto Ave
- Ambulance signal priority
- Pedestrian walk phase near markets
- Alerts feed, time-lapse replay, flood-prone zones, and custom traffic lights
- Live mode that follows Philippine time and real TomTom traffic

## Setup

1. **Supabase**: create a project, then run `supabase.sql` and `supabase-city.sql` in the SQL Editor. Put your Project URL and anon or publishable key in `supabase.js`.
2. **TomTom (optional)**: copy `config.example.js` to `config.js` and paste your free key from developer.tomtom.com. `config.js` is git-ignored so the key is never uploaded.
3. Open `city.html` or `index.html` in a browser (VS Code Live Server works well).

## Built with

HTML, CSS, vanilla JavaScript, MapLibre GL JS, Chart.js, and Supabase.

Map data © OpenStreetMap contributors (ODbL).
