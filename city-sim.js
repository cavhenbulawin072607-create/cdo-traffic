const INTERSECTIONS = CDO_DATA.intersections;
const ROADS = CDO_DATA.roads;
const HOTSPOTS = CDO_DATA.hotspots;
const HOSPITALS = CDO_DATA.hospitals;

const FIXED_GREEN = 30;
const MIN_GREEN = 10;
const MAX_GREEN = 60;
const YELLOW = 3;
const ALL_RED = 2;
const WALK = 12;
const SAT_PER_LANE = 0.5;
const JAM_PER_LANE = 8;
const CAP_PER_LANE = 40;
const WAVE_CYCLE = 80;
const WAVE_SPEED = 11;
const THROUGH_SHARE = 0.6;
const AMBULANCE_SPEED = 14;
const LANE_DEMAND = { 5: 0.075, 4: 0.07, 3: 0.065, 2: 0.06, 1: 0.05 };
const DEFAULT_LANES = { 5: 4, 4: 4, 3: 2, 2: 2, 1: 2 };
const RAIN_CAPACITY = [1, 0.8, 0.6];
const FLOOD_CAPACITY = [1, 0.5, 0.3];
const RAIN_NAMES = ["Clear", "Light rain", "Heavy rain"];
const PEAKS = [
    [360, 420, 1.5],
    [420, 480, 2.2],
    [480, 540, 1.5],
    [690, 810, 1.3],
    [930, 990, 1.4],
    [990, 1140, 2],
    [1140, 1200, 1.4]
];
const LEVELS = [
    { max: 0.35, name: "Light", color: "#22c55e" },
    { max: 0.6, name: "Moderate", color: "#eab308" },
    { max: 0.85, name: "Heavy", color: "#f97316" },
    { max: Infinity, name: "Standstill", color: "#dc2626" }
];
const FALLBACK_HOLIDAYS = {
    "01-01": "New Year's Day",
    "04-09": "Araw ng Kagitingan",
    "05-01": "Labor Day",
    "06-12": "Independence Day",
    "08-21": "Ninoy Aquino Day",
    "11-01": "All Saints' Day",
    "11-02": "All Souls' Day",
    "11-30": "Bonifacio Day",
    "12-08": "Immaculate Conception",
    "12-24": "Christmas Eve",
    "12-25": "Christmas Day",
    "12-30": "Rizal Day",
    "12-31": "New Year's Eve"
};
const LOCAL_HOLIDAYS = {
    "06-15": "CDO Charter Day",
    "08-28": "Fiesta Señor San Agustin"
};
const FESTIVAL_START = 14 * 3600;
const FESTIVAL_END = 22 * 3600;

const settings = {
    mode: "fixed",
    weather: "auto",
    rainLevel: 0,
    wave: false,
    ped: false,
    priority: true,
    followReal: false,
    realIncidents: false,
    dateKey: "",
    profile: null
};

const sim = {
    clock: 0,
    elapsed: 0,
    startTime: "07:00",
    stats: {},
    recordings: { fixed: [], smart: [] },
    lastRecordIndex: -1,
    alerts: [],
    quiet: false,
    ambulance: null,
    ambulanceResults: {},
    floodZones: [],
    calibrations: {},
    replay: null,
    holidays: {},
    holidaySource: "built-in list",
    weather: null,
    realIncidentList: []
};

function distance(lat1, lon1, lat2, lon2) {
    const dx = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180);
    const dy = (lat2 - lat1) * 111320;
    return Math.hypot(dx, dy);
}

function escapeHtml(text) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(text).replace(/[&<>"']/g, c => map[c]);
}

function timeToSeconds(value) {
    const parts = (value || "07:00").split(":");
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
}

function formatClock(seconds) {
    const h = Math.floor(seconds / 3600) % 24;
    const m = Math.floor((seconds % 3600) / 60);
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + suffix;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? h + "h " + m + "m" : m + "m";
}

function formatWait(seconds) {
    if (seconds < 60) return Math.round(seconds) + "s";
    return Math.floor(seconds / 60) + "m " + Math.round(seconds % 60) + "s";
}

function peakFactor(seconds) {
    const m = seconds / 60;
    for (const p of PEAKS) {
        if (m >= p[0] && m < p[1]) return p[2];
    }
    if (m >= 1320 || m < 300) return 0.3;
    return 1;
}

function level(c) {
    return LEVELS.find(l => c < l.max);
}

function hotFactor(lat, lon) {
    let f = 0;
    for (const h of HOTSPOTS) {
        const w = h.type === "marketplace" ? 1 : h.type === "bus_station" ? 0.9 : 0.7;
        f += w * Math.exp(-distance(lat, lon, h.lat, h.lon) / 400);
    }
    return Math.round((1 + 0.6 * Math.min(2, f)) * 100) / 100;
}

function holidayName(date) {
    const y = date.getFullYear();
    const md = String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    if (LOCAL_HOLIDAYS[md]) return LOCAL_HOLIDAYS[md];
    if (sim.holidays[y]) return sim.holidays[y][y + "-" + md] || "";
    return FALLBACK_HOLIDAYS[md] || "";
}

function dayProfile(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const dow = date.getDay();
    const lastDay = new Date(y, m, 0).getDate();
    const holidayLabel = holidayName(date);
    const holiday = holidayLabel !== "";
    const weekend = dow === 0 || dow === 6;
    const school = !weekend && !holiday && m !== 4 && m !== 5;
    const payday = d === 15 || d === Math.min(30, lastDay);
    const festival = m === 8 && d >= 25 && d <= 28;
    const christmas = m === 12 && d >= 15 && d <= 23;

    const tags = [holiday ? "Holiday: " + holidayLabel : dow === 0 ? "Sunday" : dow === 6 ? "Saturday" : "Weekday"];
    if (holiday && weekend) tags.push(dow === 0 ? "Sunday" : "Saturday");
    if (school) tags.push("School day");
    if (payday) tags.push("Payday");
    if (festival) tags.push("Kagay-an Festival");
    if (christmas) tags.push("Christmas rush");

    return { dow, holiday, weekend, school, payday, festival, christmas, label: tags.join(" · ") };
}

function demandFactor(seconds) {
    const p = settings.profile;
    const m = seconds / 60;
    let f = peakFactor(seconds);
    if (p.weekend || p.holiday) f = Math.sqrt(f);
    if (p.holiday) f *= 0.6;
    else if (p.dow === 0) f *= 0.7;
    else if (p.dow === 6) f *= 0.85;
    if (p.school && m >= 390 && m < 480) f *= 1.15;
    if (p.school && m >= 960 && m < 1050) f *= 1.1;
    if (p.payday && m >= 960 && m < 1260) f *= 1.2;
    if (p.christmas && m >= 600 && m < 1320) f *= 1.25;
    if (p.festival) f *= 1.1;
    return f;
}

function rainLevelAt(seconds) {
    if (settings.weather === "clear") return 0;
    if (settings.weather === "rain") return 1;
    if (settings.weather === "heavy") return 2;
    const w = sim.weather;
    if (!w || w.date !== settings.dateKey) return 0;
    const mm = w.mm[Math.floor(seconds / 3600) % 24] || 0;
    if (mm >= 7.5) return 2;
    if (mm >= 0.5) return 1;
    return 0;
}

function festivalClosed(it) {
    return settings.profile.festival && it.festival && sim.clock >= FESTIVAL_START && sim.clock < FESTIVAL_END;
}

function nearestPreset(it) {
    const carmen = HOTSPOTS.find(h => h.name === "Carmen Public Market");
    if (carmen && distance(it.lat, it.lon, carmen.lat, carmen.lon) < 800) return "carmen";
    if (it.rank >= 5) return "highway";
    return "cogon";
}

function inFloodZone(lat, lon) {
    return sim.floodZones.some(z => distance(lat, lon, z.lat, z.lon) <= z.radius_m);
}

function prepareIntersection(it) {
    if (it.corridor === undefined) it.corridor = -1;
    if (!it.lanes) it.lanes = [DEFAULT_LANES[it.rank] || 2, 2];
    if (!it.crossRank) it.crossRank = Math.max(1, it.rank - 1);
    if (it.live === undefined) it.live = 1;
    it.cal = sim.calibrations[it.name] || [1, 1];
    it.hasPed = HOTSPOTS.some(h => h.type === "marketplace" && distance(it.lat, it.lon, h.lat, h.lon) < 400);
    it.festival = it.main === "Don Apolinar Velez St" || it.cross === "Don Apolinar Velez St";
    it.flood = inFloodZone(it.lat, it.lon);
    it.preset = nearestPreset(it);
}

function updateFloodFlags() {
    INTERSECTIONS.forEach(it => { it.flood = inFloodZone(it.lat, it.lon); });
    ROADS.forEach(r => { r.flood = inFloodZone(r.mid[1], r.mid[0]); });
}

function applyCalibrations() {
    INTERSECTIONS.forEach(it => { it.cal = sim.calibrations[it.name] || [1, 1]; });
}

function applyRealIncidents() {
    INTERSECTIONS.forEach(it => {
        const near = settings.realIncidents
            ? sim.realIncidentList.find(x => distance(it.lat, it.lon, x.lat, x.lon) < 300)
            : null;
        it.realIncident = near ? near.text : "";
    });
}

const CORRIDOR = INTERSECTIONS
    .filter(it => it.main === "C. M. Recto Ave" && it.lon > 124.635 && it.lon < 124.665)
    .sort((a, b) => b.lon - a.lon);

function setupCorridor() {
    let offset = 0;
    CORRIDOR.forEach((it, k) => {
        it.corridor = k;
        if (k > 0) {
            const up = CORRIDOR[k - 1];
            it.upstream = up.id;
            it.travel = distance(up.lat, up.lon, it.lat, it.lon) / WAVE_SPEED;
            offset += it.travel;
        }
        it.offset = offset % WAVE_CYCLE;
    });
}

function newStats() {
    return {
        duration: 0,
        served: 0,
        waitSum: 0,
        worst: 0,
        worstName: "",
        peds: 0,
        hours: Array.from({ length: 24 }, () => ({ wait: 0, served: 0 }))
    };
}

function resetIntersection(it) {
    const phase = Math.random() < 0.5 ? 0 : 1;
    it.s = {
        q: [Math.random() * 4, Math.random() * 3],
        lam: [0, 0],
        phase: phase,
        light: "green",
        timer: Math.random() * FIXED_GREEN,
        green: FIXED_GREEN,
        drift: 0.85 + Math.random() * 0.3,
        incident: 0,
        ped: 0,
        pedWait: 0,
        preempt: false,
        jammed: false,
        alertAfter: 0,
        smooth: 0,
        inflow: [],
        crossG: 26,
        lastT: 0
    };
}

function resetSim() {
    sim.clock = timeToSeconds(sim.startTime);
    sim.elapsed = 0;
    sim.lastRecordIndex = -1;
    sim.ambulance = null;
    settings.rainLevel = rainLevelAt(sim.clock);
    INTERSECTIONS.forEach(resetIntersection);
}

function resetMode(mode) {
    sim.stats[mode] = newStats();
    sim.recordings[mode] = [];
}

function resetAll() {
    resetMode("fixed");
    resetMode("smart");
    resetSim();
}

function addAlert(text, id) {
    if (sim.quiet) return;
    sim.alerts.unshift({ time: sim.clock, text: text, id: id });
    if (sim.alerts.length > 50) sim.alerts.pop();
}

function jamLimit(it, p) {
    return it.lanes[p] * JAM_PER_LANE;
}

function smartGreen(it, phase) {
    const perLane = it.s.q[phase] / it.lanes[phase];
    return Math.min(MAX_GREEN, Math.max(MIN_GREEN, MIN_GREEN + perLane * 5));
}

function nextPhase(it) {
    const s = it.s;
    if (s.preempt) return 0;
    if (s.phase === 0) return 1;
    if (s.phase === 1 && it.hasPed && settings.ped) {
        if (settings.mode === "fixed" || s.ped >= 5 || s.pedWait >= 60) return 2;
    }
    return 0;
}

function setPlan(s, phase, light, timer, green) {
    s.phase = phase;
    s.light = light;
    s.timer = timer;
    if (green !== undefined) s.green = green;
}

function coordinatedLight(it) {
    const s = it.s;
    const t = (((sim.clock - it.offset) % WAVE_CYCLE) + WAVE_CYCLE) % WAVE_CYCLE;
    if (t < s.lastT) {
        s.crossG = settings.mode === "smart" ? Math.min(35, Math.max(12, 10 + (s.q[1] / it.lanes[1]) * 5)) : 26;
    }
    s.lastT = t;
    const g1 = WAVE_CYCLE - 10 - s.crossG;
    if (t < g1) setPlan(s, 0, "green", t, g1);
    else if (t < g1 + 3) setPlan(s, 0, "yellow", t - g1);
    else if (t < g1 + 5) setPlan(s, 0, "allred", t - g1 - 3);
    else if (t < g1 + 5 + s.crossG) setPlan(s, 1, "green", t - g1 - 5, s.crossG);
    else if (t < g1 + 8 + s.crossG) setPlan(s, 1, "yellow", t - g1 - 5 - s.crossG);
    else setPlan(s, 1, "allred", t - g1 - 8 - s.crossG);
}

function updateLight(it, dt) {
    const s = it.s;
    if (settings.wave && it.corridor >= 0 && !s.preempt) {
        coordinatedLight(it);
        return;
    }
    s.timer += dt;
    if (s.light === "green") {
        let end = s.timer >= s.green;
        if (settings.mode === "smart" && s.timer >= MIN_GREEN && s.q[s.phase] < 1 && s.q[1 - s.phase] > 2) end = true;
        if (s.preempt) end = s.phase !== 0;
        if (end) setPlan(s, s.phase, "yellow", 0);
    } else if (s.light === "yellow") {
        if (s.timer >= YELLOW) setPlan(s, s.phase, "allred", 0);
    } else if (s.light === "walk") {
        if (s.timer >= (s.preempt ? WALK / 2 : WALK)) {
            sim.stats[settings.mode].peds += s.ped;
            s.ped = 0;
            s.pedWait = 0;
            setPlan(s, s.phase, "allred", 0);
        }
    } else if (s.timer >= ALL_RED) {
        const phase = nextPhase(it);
        if (phase === 2) {
            setPlan(s, 2, "walk", 0, WALK);
        } else {
            setPlan(s, phase, "green", 0, settings.mode === "smart" ? smartGreen(it, phase) : FIXED_GREEN);
        }
    }
}

function takeInflow(s) {
    let total = 0;
    while (s.inflow.length > 0 && s.inflow[0].t <= sim.elapsed) {
        total += s.inflow.shift().v;
    }
    return total;
}

function arrivalRates(it, demand, drift) {
    const live = settings.followReal ? it.live : 1;
    const common = it.h * demand * drift * live;
    return [
        it.lanes[0] * LANE_DEMAND[it.rank] * common * it.cal[0],
        it.lanes[1] * LANE_DEMAND[it.crossRank] * common * it.cal[1]
    ];
}

function stepIntersection(it, dt, demand, st, hour) {
    const s = it.s;
    s.lam = arrivalRates(it, demand, s.drift);

    let factor = 1 - 0.1 * (it.h - 1);
    factor *= it.flood ? FLOOD_CAPACITY[settings.rainLevel] : RAIN_CAPACITY[settings.rainLevel];
    if (s.incident > 0 || it.realIncident) factor *= 0.4;
    if (festivalClosed(it)) factor *= 0.35;

    updateLight(it, dt);

    const downstream = it.corridor >= 0 ? CORRIDOR[it.corridor + 1] : null;

    for (let p = 0; p < 2; p++) {
        let arrive = s.lam[p] * dt;
        if (p === 0 && it.upstream !== undefined) {
            arrive = arrive * (1 - THROUGH_SHARE) + takeInflow(s);
        }
        s.q[p] += arrive;

        const flowing = s.phase === p && (s.light === "green" || s.light === "yellow");
        if (flowing) {
            const capacity = SAT_PER_LANE * it.lanes[p] * factor;
            const out = Math.min(s.q[p], capacity * dt);
            s.q[p] -= out;
            st.served += out;
            hour.served += out;
            if (p === 0 && downstream && downstream.s) {
                const ratio = downstream.s.lam[0] / Math.max(0.01, s.lam[0]);
                downstream.s.inflow.push({ t: sim.elapsed + downstream.travel, v: out * THROUGH_SHARE * ratio });
            }
        }
        s.q[p] = Math.min(it.lanes[p] * CAP_PER_LANE, s.q[p]);
    }

    if (it.hasPed) {
        s.ped += 0.08 * demand * dt;
        if (s.ped >= 1) s.pedWait += dt;
    }

    const waiting = s.q[0] + s.q[1];
    st.waitSum += waiting * dt;
    hour.wait += waiting * dt;
    if (waiting > st.worst) {
        st.worst = waiting;
        st.worstName = it.name;
    }

    if (s.incident > 0) {
        s.incident -= dt;
        if (s.incident <= 0) addAlert("✅ Incident cleared at " + it.name, it.id);
    } else if (!settings.realIncidents && Math.random() < (0.02 / 3600) * dt) {
        s.incident = 600 + Math.random() * 900;
        addAlert("⚠ Simulated stalled vehicle at " + it.name, it.id);
    }

    s.smooth += (Math.max(s.q[0] / it.lanes[0], s.q[1] / it.lanes[1]) - s.smooth) * Math.min(1, dt / 180);
    const c = Math.min(1, s.smooth / JAM_PER_LANE);
    if (c >= 0.85 && !s.jammed && sim.elapsed >= s.alertAfter) {
        s.jammed = true;
        addAlert("🔴 " + it.name + " is at a standstill", it.id);
    } else if (c < 0.4 && s.jammed) {
        s.jammed = false;
        s.alertAfter = sim.elapsed + 1200;
        addAlert("🟢 " + it.name + " is moving again", it.id);
    }

    s.drift = Math.min(1.25, Math.max(0.8, s.drift + (Math.random() - 0.5) * 0.004 * dt));
}

function checkFestival(before) {
    if (!settings.profile.festival) return;
    const first = INTERSECTIONS.find(it => it.festival);
    const id = first ? first.id : undefined;
    if (before < FESTIVAL_START && sim.clock >= FESTIVAL_START) addAlert("🎉 Kagay-an Festival: road closures on Don Apolinar Velez St", id);
    if (before < FESTIVAL_END && sim.clock >= FESTIVAL_END) addAlert("🎉 Festival road closures lifted", id);
}

function checkWeather() {
    const levelNow = rainLevelAt(sim.clock);
    if (levelNow === settings.rainLevel) return;
    settings.rainLevel = levelNow;
    const flooded = INTERSECTIONS.filter(it => it.flood).length;
    let text = (levelNow === 0 ? "☀ " : "🌧 ") + RAIN_NAMES[levelNow] + (settings.weather === "auto" ? " (real forecast)" : "");
    if (levelNow > 0 && flooded > 0) text += ": " + flooded + " intersection(s) in flood zones slowed down";
    addAlert(text, undefined);
}

function record() {
    const index = Math.floor(sim.clock / 300);
    if (index === sim.lastRecordIndex) return;
    sim.lastRecordIndex = index;
    sim.recordings[settings.mode][index] = INTERSECTIONS.map(it => [Math.round(it.s.q[0]), Math.round(it.s.q[1])]);
}

function step(dt) {
    const st = sim.stats[settings.mode];
    st.duration += dt;
    sim.elapsed += dt;
    const before = sim.clock;
    sim.clock = (sim.clock + dt) % 86400;
    const hour = st.hours[Math.floor(sim.clock / 3600)];
    const demand = demandFactor(sim.clock);
    checkFestival(before);
    checkWeather();
    for (const it of INTERSECTIONS) stepIntersection(it, dt, demand, st, hour);
    stepAmbulance(dt);
    record();
}

function runFullDay() {
    const savedMode = settings.mode;
    const savedStart = sim.startTime;
    sim.quiet = true;
    for (const mode of ["fixed", "smart"]) {
        settings.mode = mode;
        resetMode(mode);
        sim.startTime = "00:00";
        resetSim();
        for (let t = 0; t < 86400; t += 2) step(2);
    }
    sim.quiet = false;
    settings.mode = savedMode;
    sim.startTime = savedStart;
    resetSim();
}

function startAmbulance(coords, hospitalName, routeSource) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
        cum.push(cum[i - 1] + distance(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
    }
    const stops = [];
    for (const it of INTERSECTIONS) {
        let best = Infinity;
        let at = 0;
        coords.forEach((c, i) => {
            const d = distance(it.lat, it.lon, c[1], c[0]);
            if (d < best) {
                best = d;
                at = cum[i];
            }
        });
        if (best < 35 && at > 5) stops.push({ it: it, at: at, passed: false });
    }
    stops.sort((a, b) => a.at - b.at);

    sim.ambulance = {
        coords: coords,
        cum: cum,
        total: cum[cum.length - 1],
        stops: stops,
        pos: 0,
        elapsed: 0,
        stopped: 0,
        priority: settings.priority,
        hospital: hospitalName
    };
    const first = stops[0];
    addAlert("🚑 Ambulance dispatched to " + hospitalName + " · " + (sim.ambulance.total / 1000).toFixed(1) + " km, "
        + stops.length + " traffic lights, " + routeSource + (settings.priority ? " · priority ON" : " · no priority"), first ? first.it.id : undefined);
}

function stepAmbulance(dt) {
    const a = sim.ambulance;
    if (!a) return;
    a.elapsed += dt;

    for (const stop of a.stops) stop.it.s.preempt = false;

    const next = a.stops.find(x => !x.passed);
    let limit = a.total;
    let speed = AMBULANCE_SPEED;

    if (next) {
        const s = next.it.s;
        const gap = next.at - a.pos;
        if (a.priority && gap < 300) s.preempt = true;
        const mainGreen = s.phase === 0 && (s.light === "green" || s.light === "yellow");
        if (gap < 150) speed = AMBULANCE_SPEED / (1 + (s.q[0] / next.it.lanes[0]) / (a.priority ? 30 : 8));
        if (!mainGreen) limit = Math.max(a.pos, next.at - 5);
    }

    const before = a.pos;
    a.pos = Math.min(a.pos + speed * dt, limit);
    if (a.pos - before < 0.5 * dt) a.stopped += dt;
    if (next && a.pos >= next.at) next.passed = true;

    if (a.pos >= a.total) {
        for (const stop of a.stops) stop.it.s.preempt = false;
        sim.ambulanceResults[a.priority ? "on" : "off"] = { time: a.elapsed, stopped: a.stopped, km: a.total / 1000 };
        addAlert("🏥 Ambulance arrived at " + a.hospital + " in " + formatWait(a.elapsed), undefined);
        sim.ambulance = null;
    }
}

function ambulancePosition() {
    const a = sim.ambulance;
    if (!a) return null;
    for (let i = 1; i < a.coords.length; i++) {
        if (a.pos <= a.cum[i]) {
            const f = (a.pos - a.cum[i - 1]) / Math.max(0.01, a.cum[i] - a.cum[i - 1]);
            return [
                a.coords[i - 1][0] + (a.coords[i][0] - a.coords[i - 1][0]) * f,
                a.coords[i - 1][1] + (a.coords[i][1] - a.coords[i - 1][1]) * f
            ];
        }
    }
    return a.coords[a.coords.length - 1];
}

function viewClock() {
    return sim.replay ? sim.replay.index * 300 : sim.clock;
}

function queueOf(it, p) {
    if (sim.replay) {
        const snap = sim.recordings[sim.replay.mode][sim.replay.index];
        return snap && snap[it.id] ? snap[it.id][p] : 0;
    }
    return it.s.q[p];
}

function totalQueue(it) {
    return queueOf(it, 0) + queueOf(it, 1);
}

function phaseCongestion(it, p) {
    return Math.min(1, queueOf(it, p) / jamLimit(it, p));
}

function congestion(it) {
    return Math.max(phaseCongestion(it, 0), phaseCongestion(it, 1));
}

function realCongestion(it) {
    if (!it.real) return null;
    if (it.real.closure) return 1;
    return Math.min(1, Math.max(0, (0.9 - it.real.ratio) / 0.7));
}

function autoCalibrate(it) {
    const realC = realCongestion(it);
    if (realC === null) return;
    const simC = Math.min(1, it.s.smooth / JAM_PER_LANE);
    it.live = Math.min(2.5, Math.max(0.4, it.live * Math.exp(0.8 * (realC - simC))));
}

function lightColor(it, p) {
    const s = it.s;
    if (sim.replay) return "#9ca3af";
    if (s.light === "walk") return "#ffffff";
    if (s.phase !== p || s.light === "allred") return "#dc2626";
    return s.light === "green" ? "#22c55e" : "#eab308";
}

function estimatedWait(it) {
    const lam = it.s.lam[0] + it.s.lam[1];
    return lam > 0 ? totalQueue(it) / lam : 0;
}

function roadCongestion(r) {
    const clock = viewClock();
    const rain = sim.replay ? 0 : settings.rainLevel;
    let background = 0.12 * demandFactor(clock) * r.h * (1 + rain * 0.2) * (r.k >= 4 ? 1.2 : 1);
    if (rain > 0 && r.flood) background += 0.2 + rain * 0.15;
    if (r.i < 0) return Math.min(1, background);
    const it = INTERSECTIONS[r.i];
    let c;
    if (r.n && r.n === it.main) c = phaseCongestion(it, 0);
    else if (r.n && r.n === it.cross) c = phaseCongestion(it, 1);
    else c = congestion(it) * 0.6;
    const fade = Math.max(0.3, 1 - r.d / 1000);
    return Math.min(1, Math.max(background, c * fade));
}

function nearestRoads(lat, lon) {
    return ROADS
        .map(r => {
            let best = Infinity;
            for (const c of r.c) best = Math.min(best, distance(lat, lon, c[1], c[0]));
            return { r, d: best };
        })
        .sort((a, b) => a.d - b.d);
}

function guessRoads(lat, lon) {
    const list = nearestRoads(lat, lon).filter(x => x.r.n);
    const main = list[0];
    const cross = list.find(x => x.r.n !== main.r.n && x.d < 80);
    return { main: main ? main.r.n : "", cross: cross ? cross.r.n : "", rank: main ? main.r.k : 3 };
}

function addIntersection(data) {
    const rank = data.rank || 4;
    const it = {
        id: INTERSECTIONS.length,
        dbId: data.id,
        name: data.name,
        main: data.main_road || "",
        cross: data.cross_road || "",
        lat: data.lat,
        lon: data.lon,
        rank: rank,
        crossRank: Math.max(1, rank - 1),
        lanes: [DEFAULT_LANES[rank] || 2, 2],
        h: hotFactor(data.lat, data.lon),
        custom: true,
        corridor: -1
    };
    INTERSECTIONS.push(it);
    prepareIntersection(it);
    resetIntersection(it);
    ROADS.forEach(r => {
        const d = distance(r.mid[1], r.mid[0], it.lat, it.lon);
        if (d < r.d) {
            r.i = it.id;
            r.d = Math.round(d);
        }
    });
    sim.recordings.fixed = [];
    sim.recordings.smart = [];
    return it;
}

function modelRates(it, timeValue) {
    const demand = demandFactor(timeToSeconds(timeValue));
    const savedCal = it.cal;
    const savedLive = it.live;
    it.cal = [1, 1];
    it.live = 1;
    const rates = arrivalRates(it, demand, 1);
    it.cal = savedCal;
    it.live = savedLive;
    return rates;
}

ROADS.forEach(r => { r.mid = r.c[Math.floor(r.c.length / 2)]; });
setupCorridor();
