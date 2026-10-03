const $ = id => document.getElementById(id);

const CDO_LAT = 8.48;
const CDO_LON = 124.65;
const CDO_BBOX = "124.58,8.40,124.77,8.53";
const TOMTOM_REFRESH_MS = 10 * 60 * 1000;

const dateInput = $("simDate");
const timeInput = $("startTime");
const modeSel = $("mode");
const speedSel = $("speed");
const weatherSel = $("weather");
const playBtn = $("playBtn");
const message = $("message");
const worstList = $("worstList");
const alertList = $("alertList");
const replaySlider = $("replaySlider");
const replayModeSel = $("replayMode");

let running = true;
let liveClock = false;
let activeTool = null;
let pickedPoint = null;
let chart = null;
let replayTimer = null;
let lastChartUpdate = 0;
let tomtomTimer = null;
let tomtomBusy = false;

const hasDb = typeof db !== "undefined";
const hasTomTom = typeof TOMTOM_KEY !== "undefined" && TOMTOM_KEY !== "";

function showMessage(text) {
    message.textContent = text;
}

function manilaNow() {
    const parts = {};
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return {
        dateKey: parts.year + "-" + parts.month + "-" + parts.day,
        time: hour + ":" + parts.minute,
        seconds: Number(hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
    };
}

function selectedDate() {
    const parts = (dateInput.value || manilaNow().dateKey).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function setHtmlIfChanged(el, html) {
    if (el.innerHTML !== html) el.innerHTML = html;
}

function setRunning(value) {
    running = value;
    playBtn.textContent = running ? "Pause" : "Resume";
}

function stopLiveClock() {
    liveClock = false;
    $("liveBadge").classList.add("hidden");
}

function tableMissing(error) {
    return error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|Could not find the table/i.test(error.message));
}

function dbErrorText(error) {
    return tableMissing(error) ? "Run supabase-city.sql in the Supabase SQL Editor first." : error.message;
}

function refreshProfile() {
    settings.dateKey = dateInput.value || manilaNow().dateKey;
    settings.profile = dayProfile(selectedDate());
}

document.querySelectorAll(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".tab").forEach(t => t.classList.toggle("hidden", t.id !== "tab-" + btn.dataset.tab));
        if (btn.dataset.tab === "charts" && chart) {
            chart.resize();
            updateChart();
        }
    });
});

async function loadHolidays(year) {
    if (sim.holidays[year]) return;
    try {
        const res = await fetch("https://date.nager.at/api/v3/PublicHolidays/" + year + "/PH");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const list = await res.json();
        sim.holidays[year] = {};
        list.forEach(h => { sim.holidays[year][h.date] = h.localName || h.name; });
        sim.holidaySource = "Nager.Date";
        $("holidayStatus").textContent = "Real PH holidays (" + list.length + " in " + year + ")";
    } catch (err) {
        $("holidayStatus").textContent = "Offline: built-in list";
    }
    refreshProfile();
}

async function loadWeather(dateKey) {
    const status = $("weatherStatus");
    status.textContent = "Loading…";
    const query = "latitude=" + CDO_LAT + "&longitude=" + CDO_LON + "&hourly=precipitation&timezone=Asia%2FManila&start_date=" + dateKey + "&end_date=" + dateKey;
    const urls = [
        "https://api.open-meteo.com/v1/forecast?" + query,
        "https://archive-api.open-meteo.com/v1/archive?" + query
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            const mm = data.hourly && data.hourly.precipitation;
            if (!mm || mm.length < 24 || mm.every(v => v === null)) continue;
            sim.weather = { date: dateKey, mm: mm.slice(0, 24).map(v => v || 0) };
            const total = sim.weather.mm.reduce((a, b) => a + b, 0);
            const rainyHours = sim.weather.mm.filter(v => v >= 0.5).length;
            status.textContent = "Real: " + total.toFixed(1) + " mm, " + rainyHours + " rainy hour(s)";
            settings.rainLevel = rainLevelAt(sim.clock);
            return;
        } catch (err) {
        }
    }
    sim.weather = null;
    status.textContent = "Not available for this date";
}

function setupChart() {
    if (!window.Chart) return;
    const peakShade = {
        id: "peakShade",
        beforeDatasetsDraw(c) {
            const x = c.scales.x;
            const area = c.chartArea;
            c.ctx.save();
            c.ctx.fillStyle = "rgba(220, 38, 38, 0.15)";
            for (const band of [[7, 8], [16.5, 19]]) {
                const x1 = x.getPixelForValue(band[0]);
                const x2 = x.getPixelForValue(band[1]);
                c.ctx.fillRect(x1, area.top, x2 - x1, area.bottom - area.top);
            }
            c.ctx.restore();
        }
    };
    const hourLabel = v => {
        if (v === 0 || v === 24) return "12AM";
        if (v === 12) return "12PM";
        return v < 12 ? v + "AM" : (v - 12) + "PM";
    };
    chart = new Chart($("waitChart"), {
        type: "line",
        data: {
            datasets: [
                { label: "Fixed", data: [], borderColor: "#f97316", backgroundColor: "#f97316", tension: 0.3, pointRadius: 2 },
                { label: "Smart", data: [], borderColor: "#22c55e", backgroundColor: "#22c55e", tension: 0.3, pointRadius: 2 }
            ]
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            scales: {
                x: { type: "linear", min: 0, max: 24, ticks: { stepSize: 3, color: "#9aa4ad", callback: hourLabel }, grid: { color: "#2f363e" } },
                y: { beginAtZero: true, title: { display: true, text: "Avg wait (seconds)", color: "#9aa4ad" }, ticks: { color: "#9aa4ad" }, grid: { color: "#2f363e" } }
            },
            plugins: { legend: { labels: { color: "#e8e8e8" } } }
        },
        plugins: [peakShade]
    });
}

function updateChart() {
    if (!chart) return;
    ["fixed", "smart"].forEach((mode, i) => {
        chart.data.datasets[i].data = sim.stats[mode].hours
            .map((h, hour) => (h.served > 0 ? { x: hour + 0.5, y: Math.round(h.wait / h.served) } : null))
            .filter(Boolean);
    });
    chart.update("none");
}

function updateStatsTable() {
    $("colFixed").className = settings.mode === "fixed" ? "active" : "";
    $("colSmart").className = settings.mode === "smart" ? "active" : "";
    const rows = [
        ["Sim time", s => formatDuration(s.duration)],
        ["Avg wait", s => (s.served > 0 ? formatWait(s.waitSum / s.served) : "-")],
        ["Vehicles passed", s => Math.round(s.served).toLocaleString()],
        ["Longest queue", s => Math.round(s.worst)],
        ["Worst spot", s => escapeHtml(s.worstName || "-")],
        ["Pedestrians crossed", s => Math.round(s.peds).toLocaleString()]
    ];
    setHtmlIfChanged($("statsBody"), rows
        .map(r => "<tr><td>" + r[0] + "</td><td>" + r[1](sim.stats.fixed) + "</td><td>" + r[1](sim.stats.smart) + "</td></tr>")
        .join(""));
}

function updateAmbulanceResult() {
    const parts = [];
    if (sim.ambulance) parts.push("🚑 On the way… " + formatWait(sim.ambulance.elapsed) + " so far, " + ((sim.ambulance.total - sim.ambulance.pos) / 1000).toFixed(1) + " km left");
    const on = sim.ambulanceResults.on;
    const off = sim.ambulanceResults.off;
    if (on) parts.push("With priority: <strong>" + formatWait(on.time) + "</strong> (" + on.km.toFixed(1) + " km, stopped " + formatWait(on.stopped) + ")");
    if (off) parts.push("Without priority: <strong>" + formatWait(off.time) + "</strong> (" + off.km.toFixed(1) + " km, stopped " + formatWait(off.stopped) + ")");
    if (on && off && Math.abs(on.km - off.km) < 0.2) parts.push("Priority saved <strong>" + formatWait(Math.max(0, off.time - on.time)) + "</strong>");
    setHtmlIfChanged($("ambulanceResult"), parts.join("<br>"));
}

function updateMonitor() {
    let queued = 0;
    let jams = 0;
    let incidents = 0;
    for (const it of INTERSECTIONS) {
        queued += totalQueue(it);
        if (congestion(it) >= 0.6) jams++;
        if (!sim.replay && (it.s.incident > 0 || it.realIncident)) incidents++;
    }
    $("kQueued").textContent = Math.round(queued);
    $("kJam").textContent = jams;
    $("kIncidents").textContent = incidents;

    const worst = INTERSECTIONS.slice().sort((a, b) => congestion(b) - congestion(a) || totalQueue(b) - totalQueue(a)).slice(0, 8);
    setHtmlIfChanged(worstList, worst.map(it => {
        const lv = level(congestion(it));
        const flag = !sim.replay && (it.s.incident > 0 || it.realIncident) ? " ⚠" : "";
        const real = it.real ? " · real " + Math.round(it.real.speed) + " km/h" : "";
        return '<li data-id="' + it.id + '"><span class="badge" style="background:' + lv.color + '">' + lv.name + "</span>"
            + escapeHtml(it.name) + " · " + Math.round(totalQueue(it)) + flag + real + "</li>";
    }).join(""));

    setHtmlIfChanged(alertList, sim.alerts.length === 0
        ? '<li class="empty">No alerts yet.</li>'
        : sim.alerts.slice(0, 25).map(a => '<li data-id="' + (a.id === undefined ? "" : a.id) + '"><span class="time">' + formatClock(a.time) + "</span>" + escapeHtml(a.text) + "</li>").join(""));
}

function updateHeader() {
    const clock = viewClock();
    const peak = peakFactor(clock);
    $("clock").textContent = formatClock(clock);
    const tag = $("peak");
    const busy = !settings.profile.weekend && !settings.profile.holiday && peak >= 2;
    tag.textContent = busy ? "Peak hour" : peak > 1 ? "Busy" : peak < 1 ? "Late night" : "Normal";
    tag.className = busy ? "tag peak" : "tag";
    $("dayLabel").textContent = settings.profile.label + " · " + RAIN_NAMES[settings.rainLevel] + (settings.weather === "auto" && sim.weather ? " (real)" : "");
    $("replayBadge").classList.toggle("hidden", !sim.replay);
}

function render() {
    updateHeader();
    updateMonitor();
    updateStatsTable();
    updateAmbulanceResult();
    if (sim.replay) updateReplayLabel();
    if (mapReady) updateMap();
    const now = performance.now();
    if (now - lastChartUpdate > 1000) {
        lastChartUpdate = now;
        updateChart();
    }
}

function clickToFly(e) {
    const li = e.target.closest("li");
    if (!li || li.dataset.id === "" || li.dataset.id === undefined) return;
    flyToIntersection(Number(li.dataset.id));
}

worstList.addEventListener("click", clickToFly);
alertList.addEventListener("click", clickToFly);

function restartMode() {
    stopReplay();
    resetMode(settings.mode);
    resetSim();
}

dateInput.addEventListener("change", async () => {
    stopLiveClock();
    stopReplay();
    refreshProfile();
    resetAll();
    showMessage("New day: " + settings.profile.label + ". Stats were reset.");
    await loadHolidays(selectedDate().getFullYear());
    await loadWeather(settings.dateKey);
});

timeInput.addEventListener("change", () => {
    stopLiveClock();
    sim.startTime = timeInput.value || "07:00";
    restartMode();
});

$("nowBtn").addEventListener("click", () => goLive(false));
$("liveClockBtn").addEventListener("click", () => goLive(true));

async function goLive(realSpeed) {
    const now = manilaNow();
    const dateChanged = dateInput.value !== now.dateKey;
    dateInput.value = now.dateKey;
    timeInput.value = now.time;
    sim.startTime = now.time;
    refreshProfile();
    restartMode();
    if (realSpeed) {
        speedSel.value = "1";
        liveClock = true;
        $("liveBadge").classList.remove("hidden");
        setRunning(true);
        showMessage("Live: following Philippine time.");
    }
    if (dateChanged || !sim.weather) {
        await loadHolidays(selectedDate().getFullYear());
        await loadWeather(settings.dateKey);
    }
}

speedSel.addEventListener("change", () => {
    if (speedSel.value !== "1") stopLiveClock();
});

modeSel.addEventListener("change", () => {
    settings.mode = modeSel.value;
    restartMode();
});

weatherSel.addEventListener("change", () => {
    settings.weather = weatherSel.value;
    checkWeather();
});

$("wave").addEventListener("change", e => {
    settings.wave = e.target.checked;
    addAlert(settings.wave ? "🟢 Green wave ON for " + CORRIDOR.length + " lights on C. M. Recto Ave" : "Green wave OFF", CORRIDOR.length ? CORRIDOR[0].id : undefined);
});

$("ped").addEventListener("change", e => {
    settings.ped = e.target.checked;
    const count = INTERSECTIONS.filter(it => it.hasPed).length;
    addAlert(settings.ped ? "🚶 Walk phase ON at " + count + " intersections near markets" : "Walk phase OFF", undefined);
});

$("priority").addEventListener("change", e => {
    settings.priority = e.target.checked;
});

playBtn.addEventListener("click", () => {
    if (sim.replay) stopReplay();
    if (running) stopLiveClock();
    setRunning(!running);
});

$("resetBtn").addEventListener("click", () => {
    stopLiveClock();
    stopReplay();
    resetAll();
    sim.alerts = [];
    sim.ambulanceResults = {};
    setRunning(true);
});

const AMBULANCE_STARTS = [
    { label: "Gusa / East Coastal Rd (C. M. Recto)", find: "C. M. Recto Ave x East Coastal Rd" },
    { label: "Bulua side (C. M. Recto x Macapagal Dr)", find: "C. M. Recto Ave x Macapagal Drive" },
    { label: "Uptown (Masterson x Macapagal Dr)", find: "Masterson Ave x Macapagal Drive" },
    { label: "Puerto (C. M. Recto x Sayre Hwy)", find: "C. M. Recto Ave x Sayre Hwy" },
    { label: "Carmen Public Market", hotspot: "Carmen Public Market" },
    { label: "Cogon Public Market", hotspot: "Cogon Public Market" }
].map(s => {
    const it = s.find ? INTERSECTIONS.find(x => x.name === s.find) : null;
    const h = s.hotspot ? HOTSPOTS.find(x => x.name === s.hotspot) : null;
    const p = it || h;
    return p ? { label: s.label, lat: p.lat, lon: p.lon } : null;
}).filter(Boolean);

$("ambulanceFrom").innerHTML = AMBULANCE_STARTS.map((s, i) => '<option value="' + i + '">' + escapeHtml(s.label) + "</option>").join("");
$("ambulanceTo").innerHTML = HOSPITALS.map((h, i) => '<option value="' + i + '"' + (h.name === "Northern Mindanao Medical Center" ? " selected" : "") + ">" + escapeHtml(h.name) + "</option>").join("");

async function fetchRoute(from, to) {
    try {
        const url = "https://router.project-osrm.org/route/v1/driving/" + from.lon + "," + from.lat + ";" + to.lon + "," + to.lat + "?overview=full&geometries=geojson";
        const res = await fetch(url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data.code !== "Ok" || !data.routes.length) throw new Error(data.code);
        return { coords: data.routes[0].geometry.coordinates, source: "real road route" };
    } catch (err) {
        return { coords: [[from.lon, from.lat], [to.lon, to.lat]], source: "straight line (routing offline)" };
    }
}

$("ambulanceBtn").addEventListener("click", async () => {
    if (sim.replay) stopReplay();
    if (sim.ambulance) {
        showMessage("An ambulance is already on the way.");
        return;
    }
    const from = AMBULANCE_STARTS[Number($("ambulanceFrom").value)];
    const to = HOSPITALS[Number($("ambulanceTo").value)];
    if (!from || !to) return;
    showMessage("Finding the route…");
    $("ambulanceBtn").disabled = true;
    const route = await fetchRoute(from, to);
    $("ambulanceBtn").disabled = false;
    startAmbulance(route.coords, to.name, route.source);
    showMessage("Ambulance on the way (" + route.source + ").");
    setRunning(true);
    const bounds = route.coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(route.coords[0], route.coords[0]));
    map.fitBounds(bounds, { padding: 80, pitch: 50, maxZoom: 16 });
});

$("fullDayBtn").addEventListener("click", () => {
    stopLiveClock();
    stopReplay();
    showMessage("Simulating 24 hours for Fixed and Smart…");
    $("fullDayBtn").disabled = true;
    setTimeout(() => {
        runFullDay();
        setRunning(false);
        $("fullDayBtn").disabled = false;
        updateChart();
        const f = sim.stats.fixed;
        const s = sim.stats.smart;
        const saved = f.served > 0 && s.served > 0 ? Math.round((1 - (s.waitSum / s.served) / (f.waitSum / f.served)) * 100) : 0;
        showMessage("Full day done. Smart cut the average wait by " + saved + "%. Use replay to watch it, or press Resume to go live.");
    }, 50);
});

$("saveCityBtn").addEventListener("click", async () => {
    if (!hasDb) {
        showMessage("Supabase is not loaded.");
        return;
    }
    const modes = ["fixed", "smart"].filter(m => sim.stats[m].duration >= 600);
    if (modes.length === 0) {
        showMessage("Run at least 10 simulated minutes first.");
        return;
    }
    const rows = modes.map(m => {
        const s = sim.stats[m];
        return {
            mode: m,
            weather: settings.rainLevel > 0 ? "rainy" : "clear",
            sim_date: settings.dateKey,
            day_type: settings.profile.label.slice(0, 120),
            start_time: sim.startTime,
            duration_sec: Math.round(s.duration),
            avg_wait: s.served > 0 ? Number((s.waitSum / s.served).toFixed(2)) : 0,
            vehicles_passed: Math.round(s.served),
            worst_intersection: s.worstName || null,
            worst_queue: Math.round(s.worst),
            green_wave: settings.wave,
            ped_phase: settings.ped,
            hourly_wait: s.hours.map(h => (h.served > 0 ? Math.round(h.wait / h.served) : null))
        };
    });
    showMessage("Saving…");
    const { error } = await db.from("city_runs").insert(rows);
    showMessage(error ? "Could not save: " + dbErrorText(error) : "Saved " + rows.length + " city run(s). See Saved runs.");
});

function updateReplayLabel() {
    const index = Number(replaySlider.value);
    $("replayTime").textContent = formatClock(index * 300);
    const recorded = sim.recordings[replayModeSel.value].filter(Boolean).length;
    $("replayInfo").textContent = recorded > 0 ? recorded + " snapshots recorded" : "nothing recorded yet";
}

function startReplayAt(index) {
    const recs = sim.recordings[replayModeSel.value];
    if (recs.filter(Boolean).length === 0) {
        showMessage("Nothing recorded for this mode yet. Run the sim or use 'Simulate full day'.");
        return false;
    }
    stopLiveClock();
    setRunning(false);
    sim.replay = { mode: replayModeSel.value, index: index };
    replaySlider.value = index;
    updateReplayLabel();
    render();
    return true;
}

function stopReplay() {
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
    }
    $("replayPlayBtn").textContent = "▶ Play";
    sim.replay = null;
}

replaySlider.addEventListener("input", () => startReplayAt(Number(replaySlider.value)));
replayModeSel.addEventListener("change", () => {
    if (sim.replay) startReplayAt(Number(replaySlider.value));
    else updateReplayLabel();
});

$("replayPlayBtn").addEventListener("click", () => {
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        $("replayPlayBtn").textContent = "▶ Play";
        return;
    }
    if (!startReplayAt(Number(replaySlider.value))) return;
    $("replayPlayBtn").textContent = "⏸ Pause";
    replayTimer = setInterval(() => {
        const next = (Number(replaySlider.value) + 1) % 288;
        sim.replay.index = next;
        replaySlider.value = next;
        render();
    }, 120);
});

$("replayExitBtn").addEventListener("click", () => {
    stopReplay();
    setRunning(true);
});

function setTool(tool) {
    activeTool = tool;
    pickedPoint = null;
    showPickMarker(null);
    $("lightForm").classList.add("hidden");
    $("floodForm").classList.add("hidden");
    const banner = $("toolBanner");
    if (!tool) {
        banner.classList.add("hidden");
        if (mapReady) map.getCanvas().style.cursor = "";
        return;
    }
    banner.textContent = tool === "light" ? "Click on the map where the traffic light is." : "Click on the map at the center of the flood-prone area.";
    banner.classList.remove("hidden");
    if (mapReady) map.getCanvas().style.cursor = "crosshair";
}

function onMapToolClick(lngLat) {
    pickedPoint = { lat: lngLat.lat, lon: lngLat.lng };
    showPickMarker(lngLat);
    $("toolBanner").textContent = "Point picked. Fill in the form in the Tools tab.";
    if (activeTool === "light") {
        const guess = guessRoads(pickedPoint.lat, pickedPoint.lon);
        $("lightMain").value = guess.main;
        $("lightCross").value = guess.cross;
        $("lightName").value = guess.main && guess.cross ? guess.main + " x " + guess.cross : guess.main;
        $("lightRank").value = String(Math.max(2, Math.min(5, guess.rank)));
        $("lightForm").classList.remove("hidden");
        $("lightName").focus();
    } else {
        $("floodName").value = "";
        $("floodForm").classList.remove("hidden");
        $("floodName").focus();
    }
}

$("addLightBtn").addEventListener("click", () => setTool(activeTool === "light" ? null : "light"));
$("addFloodBtn").addEventListener("click", () => setTool(activeTool === "flood" ? null : "flood"));
document.querySelectorAll("[data-cancel-tool]").forEach(b => b.addEventListener("click", () => setTool(null)));

$("lightForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!pickedPoint) return;
    const row = {
        name: $("lightName").value.trim(),
        main_road: $("lightMain").value.trim(),
        cross_road: $("lightCross").value.trim(),
        lat: Number(pickedPoint.lat.toFixed(6)),
        lon: Number(pickedPoint.lon.toFixed(6)),
        rank: Number($("lightRank").value)
    };
    if (!row.name) return;
    let saved = row;
    if (hasDb) {
        const { data, error } = await db.from("custom_lights").insert(row).select().single();
        if (error) {
            showMessage("Could not save: " + dbErrorText(error));
            return;
        }
        saved = data;
    }
    const it = addIntersection(saved);
    refreshSignals();
    fillCalibrationList();
    $("signalCount").textContent = INTERSECTIONS.length;
    setTool(null);
    addAlert("➕ New traffic light added: " + it.name, it.id);
    showMessage("Traffic light added.");
});

$("floodForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!pickedPoint) return;
    const row = {
        name: $("floodName").value.trim(),
        lat: Number(pickedPoint.lat.toFixed(6)),
        lon: Number(pickedPoint.lon.toFixed(6)),
        radius_m: Number($("floodRadius").value)
    };
    if (!row.name) return;
    let saved = row;
    if (hasDb) {
        const { data, error } = await db.from("flood_zones").insert(row).select().single();
        if (error) {
            showMessage("Could not save: " + dbErrorText(error));
            return;
        }
        saved = data;
    }
    sim.floodZones.push(saved);
    updateFloodFlags();
    refreshFloods();
    renderFloodList();
    setTool(null);
    showMessage("Flood zone saved.");
});

function renderFloodList() {
    $("floodList").innerHTML = sim.floodZones.length === 0
        ? '<li class="empty">No flood zones yet.</li>'
        : sim.floodZones.map(z => "<li>" + escapeHtml(z.name) + " · " + z.radius_m + " m"
            + (z.id ? ' <button type="button" class="small danger" data-remove-flood="' + z.id + '">✕</button>' : "") + "</li>").join("");
}

$("floodList").addEventListener("click", async e => {
    const btn = e.target.closest("[data-remove-flood]");
    if (!btn || !hasDb) return;
    const id = Number(btn.dataset.removeFlood);
    const { error } = await db.from("flood_zones").delete().eq("id", id);
    if (error) {
        showMessage("Could not remove: " + dbErrorText(error));
        return;
    }
    sim.floodZones = sim.floodZones.filter(z => z.id !== id);
    updateFloodFlags();
    refreshFloods();
    renderFloodList();
});

document.addEventListener("pointerdown", async e => {
    const btn = e.target.closest("[data-remove-light]");
    if (!btn || !hasDb) return;
    const { error } = await db.from("custom_lights").delete().eq("id", Number(btn.dataset.removeLight));
    if (error) {
        showMessage("Could not remove: " + dbErrorText(error));
        return;
    }
    window.location.reload();
});

function fillCalibrationList() {
    const sel = $("calIntersection");
    const current = sel.value;
    sel.innerHTML = INTERSECTIONS.slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(it => '<option value="' + it.id + '">' + escapeHtml(it.name) + "</option>")
        .join("");
    if (current) sel.value = current;
}

$("calForm").addEventListener("submit", async e => {
    e.preventDefault();
    const it = INTERSECTIONS[Number($("calIntersection").value)];
    const minutes = Number($("calMinutes").value);
    const mainCount = Number($("calMain").value);
    const crossCount = Number($("calCross").value);
    const timeValue = $("calTime").value || "07:30";
    if (!it || minutes <= 0) return;

    const model = modelRates(it, timeValue);
    const clamp = v => Math.round(Math.min(10, Math.max(0.1, v)) * 100) / 100;
    const factors = [clamp((mainCount / (minutes * 60)) / model[0]), clamp((crossCount / (minutes * 60)) / model[1])];

    if (hasDb) {
        const { error } = await db.from("calibrations").insert({
            intersection_name: it.name,
            main_factor: factors[0],
            cross_factor: factors[1],
            minutes: minutes,
            main_count: mainCount,
            cross_count: crossCount,
            counted_at: timeValue
        });
        if (error) {
            showMessage("Could not save: " + dbErrorText(error));
            return;
        }
    }
    sim.calibrations[it.name] = factors;
    applyCalibrations();
    addAlert("📋 Calibrated " + it.name + " from a real count", it.id);
    showMessage(it.name + ": main road ×" + factors[0] + ", cross road ×" + factors[1] + " applied.");
});

function countTomTomCalls(n) {
    const key = "tomtom-calls-" + manilaNow().dateKey;
    let total = n;
    try {
        total = Number(localStorage.getItem(key) || 0) + n;
        localStorage.setItem(key, String(total));
    } catch (err) {
    }
    return total;
}

async function fetchFlow(it) {
    const url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/12/json?unit=KMPH&point="
        + it.lat + "," + it.lon + "&key=" + encodeURIComponent(TOMTOM_KEY);
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = (await res.json()).flowSegmentData;
    if (!data || !data.freeFlowSpeed) return false;
    it.real = {
        speed: data.currentSpeed,
        free: data.freeFlowSpeed,
        ratio: data.currentSpeed / data.freeFlowSpeed,
        closure: !!data.roadClosure,
        confidence: data.confidence,
        at: Date.now()
    };
    return true;
}

async function fetchRealSpeeds() {
    let ok = 0;
    let failed = 0;
    let lastError = "";
    const list = INTERSECTIONS.slice();
    for (let i = 0; i < list.length; i += 5) {
        const results = await Promise.allSettled(list.slice(i, i + 5).map(fetchFlow));
        results.forEach(r => {
            if (r.status === "fulfilled" && r.value) ok++;
            else {
                failed++;
                if (r.status === "rejected") lastError = r.reason.message;
            }
        });
        if (lastError === "HTTP 403" || lastError === "HTTP 401") break;
    }
    const calls = countTomTomCalls(ok + failed);
    if (settings.followReal) INTERSECTIONS.forEach(autoCalibrate);
    return { ok, failed, calls, lastError };
}

async function fetchRealIncidents() {
    const fields = "{incidents{type,geometry{type,coordinates},properties{iconCategory,events{description},from,to}}}";
    const url = "https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=" + CDO_BBOX
        + "&fields=" + encodeURIComponent(fields) + "&language=en-GB&timeValidityFilter=present&key=" + encodeURIComponent(TOMTOM_KEY);
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    countTomTomCalls(1);
    const before = new Set(sim.realIncidentList.map(x => x.text + x.lat.toFixed(4)));
    sim.realIncidentList = (data.incidents || []).map(inc => {
        const g = inc.geometry;
        const first = g.type === "Point" ? g.coordinates : g.coordinates[0];
        const p = inc.properties || {};
        const desc = p.events && p.events.length ? p.events.map(ev => ev.description).join(", ") : "Traffic incident";
        const where = [p.from, p.to].filter(Boolean).join(" → ");
        return { lon: first[0], lat: first[1], text: desc + (where ? " (" + where + ")" : "") };
    });
    sim.realIncidentList.forEach(x => {
        if (!before.has(x.text + x.lat.toFixed(4))) addAlert("⚠ Real incident: " + x.text, undefined);
    });
    applyRealIncidents();
    refreshRealIncidents();
    return sim.realIncidentList.length;
}

async function refreshTomTom() {
    if (!hasTomTom || tomtomBusy) return;
    const wantSpeeds = $("realSpeedToggle").checked || settings.followReal;
    if (!wantSpeeds && !settings.realIncidents) return;
    tomtomBusy = true;
    $("tomtomStatus").textContent = "Updating…";
    const parts = [];
    try {
        if (wantSpeeds) {
            const r = await fetchRealSpeeds();
            if (r.lastError === "HTTP 403" || r.lastError === "HTTP 401") throw new Error("TomTom key rejected (" + r.lastError + ")");
            parts.push(r.ok + "/" + INTERSECTIONS.length + " speeds");
            parts.push(r.calls + " calls today");
        }
        if (settings.realIncidents) parts.push((await fetchRealIncidents()) + " incidents");
        const t = manilaNow().time;
        $("tomtomStatus").textContent = "Live " + t + " · " + parts.join(" · ");
    } catch (err) {
        $("tomtomStatus").textContent = "Error: " + err.message;
    }
    tomtomBusy = false;
}

function scheduleTomTom() {
    const on = $("realSpeedToggle").checked || settings.followReal || settings.realIncidents;
    if (on && !tomtomTimer) {
        refreshTomTom();
        tomtomTimer = setInterval(refreshTomTom, TOMTOM_REFRESH_MS);
    } else if (!on && tomtomTimer) {
        clearInterval(tomtomTimer);
        tomtomTimer = null;
    }
}

const tomtomControls = ["liveToggle", "realSpeedToggle", "followRealToggle", "realIncidentToggle", "tomtomRefreshBtn"];
if (!hasTomTom) {
    tomtomControls.forEach(id => {
        $(id).disabled = true;
        const label = $(id).closest("label");
        if (label) {
            label.classList.add("disabled");
            label.title = "Needs a TomTom API key in config.js";
        }
    });
    $("liveNote").innerHTML = "To use <strong>real live traffic</strong>, get a free key at developer.tomtom.com and paste it into <code>config.js</code>.";
    $("tomtomStatus").textContent = "No key yet";
} else {
    $("liveNote").textContent = "Real traffic from TomTom. Turn off the simulated colors to compare.";
    $("tomtomStatus").textContent = "Ready";
}

$("liveToggle").addEventListener("change", e => setLiveTraffic(e.target.checked));
$("simRoadsToggle").addEventListener("change", e => setSimRoadsVisible(e.target.checked));
$("realSpeedToggle").addEventListener("change", e => {
    showRealColors = e.target.checked;
    scheduleTomTom();
});
$("followRealToggle").addEventListener("change", e => {
    settings.followReal = e.target.checked;
    if (settings.followReal) {
        INTERSECTIONS.forEach(autoCalibrate);
        addAlert("🔗 Simulation now follows real TomTom traffic", undefined);
    }
    scheduleTomTom();
});
$("realIncidentToggle").addEventListener("change", e => {
    settings.realIncidents = e.target.checked;
    applyRealIncidents();
    refreshRealIncidents();
    scheduleTomTom();
});
$("tomtomRefreshBtn").addEventListener("click", refreshTomTom);

$("panelToggle").addEventListener("click", () => $("panel").classList.toggle("hidden"));

async function loadSavedData() {
    if (!hasDb) {
        showMessage("Supabase not loaded. Tools will not be saved.");
        return;
    }
    const [lights, floods, cals] = await Promise.all([
        db.from("custom_lights").select("*").order("id"),
        db.from("flood_zones").select("*").order("id"),
        db.from("calibrations").select("*").order("created_at")
    ]);
    const firstError = [lights, floods, cals].map(r => r.error).find(Boolean);
    if (firstError) {
        showMessage(tableMissing(firstError) ? "Tip: run supabase-city.sql in Supabase to enable saving, custom lights, flood zones, and calibration." : "Supabase: " + firstError.message);
    }
    if (cals.data) {
        for (const c of cals.data) sim.calibrations[c.intersection_name] = [Number(c.main_factor), Number(c.cross_factor)];
        applyCalibrations();
    }
    if (floods.data) {
        sim.floodZones = floods.data;
        updateFloodFlags();
        refreshFloods();
    }
    if (lights.data && lights.data.length > 0) {
        lights.data.forEach(addIntersection);
        refreshSignals();
        $("signalCount").textContent = INTERSECTIONS.length;
    }
    renderFloodList();
    fillCalibrationList();
}

let lastTime = performance.now();
let lastRender = 0;

function loop(now) {
    const real = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (running && !sim.replay) {
        if (liveClock) {
            const target = manilaNow().seconds;
            let diff = target - sim.clock;
            if (diff < -43200) diff += 86400;
            if (diff > 0) {
                while (diff > 0) {
                    const d = Math.min(1, diff);
                    step(d);
                    diff -= d;
                }
            }
        } else {
            let simDt = real * Number(speedSel.value);
            while (simDt > 0) {
                const d = Math.min(1, simDt);
                step(d);
                simDt -= d;
            }
        }
    }
    if (now - lastRender > 300) {
        lastRender = now;
        render();
    }
    requestAnimationFrame(loop);
}

const start = manilaNow();
dateInput.value = start.dateKey;
refreshProfile();
sim.startTime = timeInput.value;
INTERSECTIONS.forEach(prepareIntersection);
ROADS.forEach(r => { r.flood = false; });
resetAll();
setupChart();
renderFloodList();
fillCalibrationList();
$("signalCount").textContent = INTERSECTIONS.length;
updateReplayLabel();
loadSavedData();
loadHolidays(selectedDate().getFullYear()).then(() => loadWeather(settings.dateKey));
requestAnimationFrame(loop);
