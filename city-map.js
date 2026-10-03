const CONG_COLOR = ["interpolate", ["linear"], ["get", "c"], 0, "#22c55e", 0.35, "#eab308", 0.6, "#f97316", 0.85, "#dc2626"];

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
    center: [124.645, 8.479],
    zoom: 13.6,
    pitch: 55,
    bearing: -15,
    maxBounds: [[124.5, 8.33], [124.85, 8.6]]
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

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
        paint: { "text-color": color, "text-halo-color": "#ffffff", "text-halo-width": 1.5 }
    };
}

map.on("load", () => {
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
        id: "traffic-roads",
        type: "line",
        source: "traffic",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            "line-color": CONG_COLOR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 12, ["*", 0.6, ["get", "k"]], 16, ["*", 2.2, ["get", "k"]]],
            "line-opacity": 0.85
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
        paint: { "circle-color": "#a855f7", "circle-radius": 4, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 }
    });
    map.addLayer(labelLayer("hotspot-labels", "hotspots", 14.5, 11, "#6b21a8"));

    map.addLayer({
        id: "hospital-dots",
        type: "circle",
        source: "hospitals",
        paint: { "circle-color": "#ffffff", "circle-radius": 5, "circle-stroke-color": "#dc2626", "circle-stroke-width": 3 }
    });
    map.addLayer(labelLayer("hospital-labels", "hospitals", 14.5, 11, "#b91c1c"));

    map.addLayer({
        id: "signal-dots",
        type: "circle",
        source: "signals",
        paint: {
            "circle-color": CONG_COLOR,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 11],
            "circle-stroke-color": ["get", "light"],
            "circle-stroke-width": 3
        }
    });
    map.addLayer(labelLayer("signal-labels", "signals", 15, 12, "#111111"));

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
    map.flyTo({ center: [it.lon, it.lat], zoom: 16.5, pitch: 60 });
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
    updateAmbulanceMarker();
    if (popup && selectedId !== null && popup.isOpen()) popup.setHTML(popupHtml(INTERSECTIONS[selectedId]));
}
