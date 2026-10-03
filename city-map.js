const CONG_COLOR = ["step", ["get", "c"], "#63d668", 0.35, "#ff974d", 0.6, "#f23c32", 0.85, "#811f1f"];
const ROAD_SCALE = ["case", [">=", ["get", "k"], 4], 1, [">=", ["get", "k"], 3], 0.8, 0.6];
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const HOUSE_COLORS = [
    "match", ["%", ["to-number", ["id"], 0], 8],
    0, "#efe3c8",
    1, "#d9946b",
    2, "#c3d6e4",
    3, "#ecc79a",
    4, "#b9d3ae",
    5, "#f4f1ea",
    6, "#e2aa98",
    "#d8cdb8"
];
const BUILDING_COLOR = [
    "case",
    ["has", "colour"], ["get", "colour"],
    [">=", ["get", "render_height"], 20],
    ["interpolate", ["linear"], ["get", "render_height"], 20, "#c4ced8", 60, "#9fb2c6", 120, "#7f95ad"],
    HOUSE_COLORS
];

let basemap = "satellite";
let terrainOn = false;
let styleLabelLayers = [];
let lastSunMinute = -1;
let styleRoadLayers = [];

let mapReady = false;
let popup = null;
let selectedId = null;
let ambulanceMarker = null;
let pickMarker = null;
let showRealColors = false;

function circlePolygon(lat, lon, radius) {
    const points = [];
    for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        points.push([
            lon + (radius * Math.cos(a)) / (111320 * Math.cos(lat * Math.PI / 180)),
            lat + (radius * Math.sin(a)) / 111320
        ]);
    }
    return [points];
}

function collection(features) {
    return { type: "FeatureCollection", features: features };
}

const roadGeo = collection(ROADS.map(r => ({
    type: "Feature",
    properties: { k: r.k, c: 0 },
    geometry: { type: "LineString", coordinates: r.c }
})));

let signalGeo = collection([]);
let barGeo = collection([]);

function buildSignalGeo() {
    signalGeo = collection(INTERSECTIONS.map(it => ({
        type: "Feature",
        properties: { id: it.id, name: it.name, c: 0, light: "#dc2626" },
        geometry: { type: "Point", coordinates: [it.lon, it.lat] }
    })));
    barGeo = collection(INTERSECTIONS.map(it => ({
        type: "Feature",
        properties: { id: it.id, c: 0, hgt: 10 },
        geometry: { type: "Polygon", coordinates: circlePolygon(it.lat, it.lon, 10) }
    })));
}

function floodGeo() {
    return collection(sim.floodZones.map(z => ({
        type: "Feature",
        properties: { name: z.name },
        geometry: { type: "Polygon", coordinates: circlePolygon(z.lat, z.lon, z.radius_m) }
    })));
}

const hotspotGeo = collection(HOTSPOTS.map(h => ({
    type: "Feature",
    properties: { name: h.name },
    geometry: { type: "Point", coordinates: [h.lon, h.lat] }
})));

const hospitalGeo = collection(HOSPITALS.map(h => ({
    type: "Feature",
    properties: { name: h.name },
    geometry: { type: "Point", coordinates: [h.lon, h.lat] }
})));

function realIncidentGeo() {
    return collection(sim.realIncidentList.map(x => ({
        type: "Feature",
        properties: { text: x.text },
        geometry: { type: "Point", coordinates: [x.lon, x.lat] }
    })));
}

function ambulanceRouteGeo() {
    const a = sim.ambulance;
    return collection(a ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: a.coords } }] : []);
}

const corridorGeo = collection([{
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: CORRIDOR.map(it => [it.lon, it.lat]) }
}]);

const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [124.6404, 8.4835],
    zoom: 14.3,
    pitch: 0,
    bearing: 0,
    maxBounds: [[124.5, 8.33], [124.85, 8.6]]
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

document.querySelectorAll("[data-basemap]").forEach(btn => {
    btn.addEventListener("click", () => {
        if (mapReady) setBasemap(btn.dataset.basemap);
    });
});

document.getElementById("terrainToggle").addEventListener("change", e => {
    if (mapReady) setTerrain3D(e.target.checked);
});

function labelLayer(id, source, minzoom, size, color) {
    return {
        id: id,
        type: "symbol",
        source: source,
        minzoom: minzoom,
        layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": size,
            "text-offset": [0, 1.2],
            "text-anchor": "top"
        },
        paint: { "text-color": "#ffffff", "text-halo-color": color, "text-halo-width": 1.6 }
    };
}

function setupRealisticMap() {
    const layers = map.getStyle().layers;
    styleRoadLayers = layers
        .filter(l => l.type === "line" && /^(road|bridge|tunnel)_/.test(l.id) && !/rail/.test(l.id))
        .map(l => l.id);
    const firstRoad = layers.find(l => /^(tunnel|road)_/.test(l.id));
    styleLabelLayers = layers
        .filter(l => l.type === "symbol" && l.layout && l.layout["text-field"])
        .map(l => ({
            id: l.id,
            color: map.getPaintProperty(l.id, "text-color"),
            halo: map.getPaintProperty(l.id, "text-halo-color"),
            haloWidth: map.getPaintProperty(l.id, "text-halo-width")
        }));
    styleRoadLayers = styleRoadLayers.map(id => ({ id: id, opacity: map.getPaintProperty(id, "line-opacity") }));

    map.addSource("satellite", {
        type: "raster",
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
    });
    map.addLayer({
        id: "satellite-layer",
        type: "raster",
        source: "satellite",
        layout: { visibility: "none" },
        paint: { "raster-fade-duration": 200 }
    }, firstRoad ? firstRoad.id : undefined);

    map.addSource("terrain-dem", {
        type: "raster-dem",
        tiles: [TERRAIN_TILES],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium",
        attribution: "Terrain: Mapzen / AWS Open Data"
    });
    map.addSource("hillshade-dem", {
        type: "raster-dem",
        tiles: [TERRAIN_TILES],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium"
    });
    map.addLayer({
        id: "hillshade",
        type: "hillshade",
        source: "hillshade-dem",
        paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#5a6b5a" }
    }, "water");

    if (map.getLayer("building-3d")) {
        map.setLayerZoomRange("building-3d", 13, 24);
        map.setPaintProperty("building-3d", "fill-extrusion-color", BUILDING_COLOR);
        map.setPaintProperty("building-3d", "fill-extrusion-vertical-gradient", true);
    }
    if (map.getLayer("building")) map.setLayoutProperty("building", "visibility", "none");

    try {
        basemap = localStorage.getItem("cdo-basemap-v2") || basemap;
        terrainOn = localStorage.getItem("cdo-terrain-v2") === "on";
    } catch (err) {
    }
    setBasemap(basemap);
    setTerrain3D(terrainOn);
}

function setBasemap(mode) {
    basemap = mode;
    const satellite = mode !== "map";
    map.setLayoutProperty("satellite-layer", "visibility", satellite ? "visible" : "none");
    map.setLayoutProperty("hillshade", "visibility", satellite ? "none" : "visible");
    styleRoadLayers.forEach(r => map.setPaintProperty(r.id, "line-opacity", satellite ? 0.22 : (r.opacity === undefined ? 1 : r.opacity)));
    styleLabelLayers.forEach(l => {
        map.setPaintProperty(l.id, "text-color", satellite ? "#ffffff" : l.color);
        map.setPaintProperty(l.id, "text-halo-color", satellite ? "rgba(0, 0, 0, 0.8)" : l.halo);
        map.setPaintProperty(l.id, "text-halo-width", satellite ? 1.4 : (l.haloWidth === undefined ? 1 : l.haloWidth));
    });
    if (map.getLayer("building-3d")) {
        map.setLayoutProperty("building-3d", "visibility", mode === "satellite" ? "none" : "visible");
        map.setPaintProperty("building-3d", "fill-extrusion-opacity", mode === "hybrid" ? 0.55 : 0.92);
        map.setPaintProperty("building-3d", "fill-extrusion-color", mode === "hybrid" ? "#f5f1e8" : BUILDING_COLOR);
    }
    document.querySelectorAll("[data-basemap]").forEach(b => b.classList.toggle("active", b.dataset.basemap === mode));
    try {
        localStorage.setItem("cdo-basemap-v2", mode);
    } catch (err) {
    }
    lastSunMinute = -1;
}

function setTerrain3D(on) {
    terrainOn = on;
    map.setTerrain(on ? { source: "terrain-dem", exaggeration: 1.4 } : null);
    const box = document.getElementById("terrainToggle");
    if (box) box.checked = on;
    try {
        localStorage.setItem("cdo-terrain-v2", on ? "on" : "off");
    } catch (err) {
    }
}

function updateSun(clock) {
    const minute = Math.floor(clock / 60);
    if (minute === lastSunMinute) return;
    lastSunMinute = minute;
    const hours = clock / 3600;
    const day = hours >= 6 && hours <= 18;
    const t = day ? (hours - 6) / 12 : 0;
    const azimuth = 90 + t * 180;
    const polar = day ? 80 - Math.sin(t * Math.PI) * 60 : 80;
    const dusk = hours >= 17.5 && hours <= 18.5 || hours >= 5.5 && hours <= 6.5;

    map.setLight({
        anchor: "map",
        position: [1.5, azimuth, polar],
        color: day ? (dusk ? "#ffc58a" : "#ffffff") : "#8ea2d8",
        intensity: day ? 0.45 : 0.2
    });

    if (map.getLayer("satellite-layer")) {
        map.setPaintProperty("satellite-layer", "raster-brightness-max", day ? 1 : 0.45);
        map.setPaintProperty("satellite-layer", "raster-saturation", day ? 0.05 : -0.4);
    }

    try {
        map.setSky({
            "sky-color": day ? (dusk ? "#f4a261" : "#7fb8f0") : "#0b1730",
            "horizon-color": day ? (dusk ? "#ffd6a5" : "#e6f2ff") : "#1f2d4d",
            "fog-color": day ? "#e6eef5" : "#1a2238",
            "sky-horizon-blend": 0.6,
            "horizon-fog-blend": 0.6,
            "fog-ground-blend": 0.9,
            "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0.6, 16, 0]
        });
    } catch (err) {
    }
}

map.on("load", () => {
    setupRealisticMap();
    const firstSymbol = map.getStyle().layers.find(l => l.type === "symbol");
    const before = firstSymbol ? firstSymbol.id : undefined;

    buildSignalGeo();
    map.addSource("traffic", { type: "geojson", data: roadGeo });
    map.addSource("signals", { type: "geojson", data: signalGeo });
    map.addSource("bars", { type: "geojson", data: barGeo });
    map.addSource("hotspots", { type: "geojson", data: hotspotGeo });
    map.addSource("hospitals", { type: "geojson", data: hospitalGeo });
    map.addSource("corridor", { type: "geojson", data: corridorGeo });
    map.addSource("floods", { type: "geojson", data: floodGeo() });
    map.addSource("real-incidents", { type: "geojson", data: realIncidentGeo() });
    map.addSource("ambulance-route", { type: "geojson", data: ambulanceRouteGeo() });

    map.addLayer({
        id: "flood-fill",
        type: "fill",
        source: "floods",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.25, "fill-outline-color": "#1d4ed8" }
    }, before);

    map.addLayer({
        id: "traffic-casing",
        type: "line",
        source: "traffic",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            "line-color": "rgba(0, 0, 0, 0.45)",
            "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, ["*", 2, ROAD_SCALE], 14, ["*", 4.5, ROAD_SCALE], 17, ["*", 11, ROAD_SCALE]]
        }
    }, before);

    map.addLayer({
        id: "traffic-roads",
        type: "line",
        source: "traffic",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            "line-color": CONG_COLOR,
            "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, ["*", 1, ROAD_SCALE], 14, ["*", 3, ROAD_SCALE], 17, ["*", 8, ROAD_SCALE]]
        }
    }, before);

    map.addLayer({
        id: "ambulance-route-line",
        type: "line",
        source: "ambulance-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ef4444", "line-width": 5, "line-opacity": 0.8, "line-dasharray": [1, 1.5] }
    });

    map.addLayer({
        id: "corridor-line",
        type: "line",
        source: "corridor",
        layout: { visibility: "none", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 3, "line-dasharray": [2, 2] }
    });

    map.addLayer({
        id: "queue-bars",
        type: "fill-extrusion",
        source: "bars",
        layout: { visibility: "none" },
        paint: {
            "fill-extrusion-color": CONG_COLOR,
            "fill-extrusion-height": ["get", "hgt"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.9
        }
    });

    map.addLayer({
        id: "hotspot-dots",
        type: "circle",
        source: "hotspots",
        minzoom: 13,
        paint: { "circle-color": "#a855f7", "circle-radius": 4, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 }
    });
    map.addLayer(labelLayer("hotspot-labels", "hotspots", 15, 11, "#581c87"));

    map.addLayer({
        id: "hospital-dots",
        type: "circle",
        source: "hospitals",
        minzoom: 12,
        paint: { "circle-color": "#ffffff", "circle-radius": 4.5, "circle-stroke-color": "#dc2626", "circle-stroke-width": 2.5 }
    });
    map.addLayer(labelLayer("hospital-labels", "hospitals", 15, 11, "#7f1d1d"));

    map.addLayer({
        id: "signal-dots",
        type: "circle",
        source: "signals",
        paint: {
            "circle-color": CONG_COLOR,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 14, 4.5, 17, 9],
            "circle-stroke-color": ["get", "light"],
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 15, 2.5]
        }
    });
    map.addLayer(labelLayer("signal-labels", "signals", 16, 11, "#111111"));

    map.addLayer({
        id: "real-incident-dots",
        type: "circle",
        source: "real-incidents",
        paint: { "circle-color": "#facc15", "circle-radius": 8, "circle-stroke-color": "#111111", "circle-stroke-width": 2 }
    });

    map.on("click", "real-incident-dots", e => {
        if (activeTool) return;
        new maplibregl.Popup({ offset: 10 })
            .setLngLat(e.lngLat)
            .setHTML("<strong>⚠ Real incident (TomTom)</strong><p>" + escapeHtml(e.features[0].properties.text) + "</p>")
            .addTo(map);
    });

    for (const layer of ["signal-dots", "queue-bars"]) {
        map.on("click", layer, e => {
            if (activeTool) return;
            openPopup(e.features[0].properties.id);
        });
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = activeTool ? "crosshair" : ""; });
    }

    map.on("click", e => {
        if (activeTool) onMapToolClick(e.lngLat);
    });

    const showBars = () => map.setLayoutProperty("queue-bars", "visibility", map.getPitch() > 20 ? "visible" : "none");
    map.on("pitchend", showBars);
    showBars();

    mapReady = true;
    render();
});

function refreshSignals() {
    if (!mapReady) return;
    buildSignalGeo();
    map.getSource("signals").setData(signalGeo);
    map.getSource("bars").setData(barGeo);
}

function refreshFloods() {
    if (!mapReady) return;
    map.getSource("floods").setData(floodGeo());
}

function refreshRealIncidents() {
    if (!mapReady) return;
    map.getSource("real-incidents").setData(settings.realIncidents ? realIncidentGeo() : collection([]));
}

function refreshAmbulanceRoute() {
    if (!mapReady) return;
    map.getSource("ambulance-route").setData(ambulanceRouteGeo());
}

function popupHtml(it) {
    const s = it.s;
    let phaseText = "All red: clearing the intersection";
    if (sim.replay) {
        phaseText = "Replay: showing recorded queues";
    } else if (s.light === "walk") {
        phaseText = "🚶 Pedestrian crossing · " + Math.ceil(Math.max(0, WALK - s.timer)) + "s left";
    } else if (s.light !== "allred") {
        const road = s.phase === 0 ? it.main || "Main road" : it.cross || "Cross road";
        const left = s.light === "green" ? Math.max(0, s.green - s.timer) : Math.max(0, YELLOW - s.timer);
        phaseText = (s.light === "green" ? "Green" : "Yellow") + " for " + road + " · " + Math.ceil(left) + "s left";
    }
    const lv = level(congestion(it));
    const notes = [];
    if (s.preempt) notes.push('<p class="warn">🚑 Ambulance priority: holding green</p>');
    if (it.real) {
        const age = Math.round((Date.now() - it.real.at) / 60000);
        notes.push("<p>🚦 <strong>Real speed now:</strong> " + Math.round(it.real.speed) + " km/h (normal " + Math.round(it.real.free) + " km/h)"
            + (it.real.closure ? " · <strong>ROAD CLOSED</strong>" : "") + " · " + age + " min ago</p>");
    }
    if (it.realIncident) notes.push('<p class="warn">⚠ Real incident: ' + escapeHtml(it.realIncident) + "</p>");
    if (s.incident > 0) notes.push('<p class="warn">⚠ Simulated stalled vehicle</p>');
    if (festivalClosed(it)) notes.push('<p class="warn">🎉 Festival road closure</p>');
    if (settings.rainLevel > 0 && it.flood) notes.push('<p class="warn">🌊 Flooded: much slower</p>');
    notes.push("<p>Lanes (OSM): " + it.lanes[0] + " main / " + it.lanes[1] + " cross</p>");
    if (settings.wave && it.corridor >= 0) notes.push("<p>🟢 Part of the C. M. Recto green wave</p>");
    if (it.hasPed) notes.push("<p>🚶 " + Math.round(s.ped) + " pedestrians waiting" + (settings.ped ? "" : " (walk phase off)") + "</p>");
    if (it.cal[0] !== 1 || it.cal[1] !== 1) notes.push("<p>📋 Calibrated from real count (×" + it.cal[0] + " / ×" + it.cal[1] + ")</p>");

    return "<strong>" + escapeHtml(it.name) + "</strong>"
        + "<table>"
        + '<tr><td><span class="dot" style="background:' + lightColor(it, 0) + '"></span>' + escapeHtml(it.main || "Main road") + "</td><td>" + Math.round(queueOf(it, 0)) + " waiting</td></tr>"
        + '<tr><td><span class="dot" style="background:' + lightColor(it, 1) + '"></span>' + escapeHtml(it.cross || "Cross road") + "</td><td>" + Math.round(queueOf(it, 1)) + " waiting</td></tr>"
        + "</table>"
        + "<p>" + escapeHtml(phaseText) + "</p>"
        + '<p>Level: <strong style="color:' + lv.color + '">' + lv.name + "</strong> · Est. wait: " + formatWait(estimatedWait(it)) + "</p>"
        + notes.join("")
        + '<p><a href="index.html?loc=' + it.preset + '">Open close-up simulation</a></p>'
        + (it.custom ? '<button type="button" class="small danger" data-remove-light="' + it.dbId + '">Remove this light</button>' : "");
}

function openPopup(id) {
    const it = INTERSECTIONS[id];
    if (!it) return;
    selectedId = id;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ offset: 14 })
        .setLngLat([it.lon, it.lat])
        .setHTML(popupHtml(it))
        .addTo(map);
    popup.on("close", () => {
        if (selectedId === id) selectedId = null;
    });
}

function flyToIntersection(id) {
    const it = INTERSECTIONS[id];
    if (!it) return;
    map.flyTo({ center: [it.lon, it.lat], zoom: 17 });
    openPopup(id);
}

let routeShownFor = null;

function updateAmbulanceMarker() {
    if (routeShownFor !== sim.ambulance) {
        routeShownFor = sim.ambulance;
        refreshAmbulanceRoute();
    }
    const pos = ambulancePosition();
    if (!pos) {
        if (ambulanceMarker) {
            ambulanceMarker.remove();
            ambulanceMarker = null;
        }
        return;
    }
    if (!ambulanceMarker) {
        const el = document.createElement("div");
        el.className = "ambulance";
        el.textContent = "🚑";
        ambulanceMarker = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map);
    } else {
        ambulanceMarker.setLngLat(pos);
    }
}

function showPickMarker(lngLat) {
    if (pickMarker) pickMarker.remove();
    pickMarker = lngLat ? new maplibregl.Marker({ color: "#3d7bd9" }).setLngLat(lngLat).addTo(map) : null;
}

function setLiveTraffic(on) {
    if (!mapReady) return;
    if (on && !map.getSource("live")) {
        map.addSource("live", {
            type: "raster",
            tiles: ["https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=" + encodeURIComponent(TOMTOM_KEY)],
            tileSize: 256,
            attribution: "Live traffic © TomTom"
        });
        map.addLayer({ id: "live-traffic", type: "raster", source: "live", paint: { "raster-opacity": 0.9 } }, "traffic-roads");
    }
    if (map.getLayer("live-traffic")) map.setLayoutProperty("live-traffic", "visibility", on ? "visible" : "none");
}

function setSimRoadsVisible(visible) {
    if (!mapReady) return;
    map.setLayoutProperty("traffic-roads", "visibility", visible ? "visible" : "none");
}

function updateMap() {
    ROADS.forEach((r, i) => {
        roadGeo.features[i].properties.c = roadCongestion(r);
    });
    INTERSECTIONS.forEach((it, i) => {
        if (!signalGeo.features[i]) return;
        const real = !sim.replay && showRealColors ? realCongestion(it) : null;
        const c = real === null ? congestion(it) : real;
        signalGeo.features[i].properties.c = c;
        signalGeo.features[i].properties.light = lightColor(it, 0);
        barGeo.features[i].properties.c = c;
        barGeo.features[i].properties.hgt = Math.min(300, 15 + totalQueue(it) * 3);
    });
    map.getSource("traffic").setData(roadGeo);
    map.getSource("signals").setData(signalGeo);
    map.getSource("bars").setData(barGeo);
    map.setLayoutProperty("corridor-line", "visibility", settings.wave ? "visible" : "none");
    updateSun(viewClock());
    updateAmbulanceMarker();
    if (popup && selectedId !== null && popup.isOpen()) popup.setHTML(popupHtml(INTERSECTIONS[selectedId]));
}
