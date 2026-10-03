const canvas = document.getElementById("road");
const ctx = canvas.getContext("2d");

const SIZE = 600;
const STOP = 245;
const GAP = 8;
const FIXED_GREEN = 20;
const MIN_GREEN = 8;
const MAX_GREEN = 40;
const YELLOW = 3;
const ALL_RED = 2;
const CLOCK_SPEED = 10;
const DIRS = ["N", "S", "E", "W"];
const PHASES = [["N", "S"], ["E", "W"]];

const TYPES = {
    jeepney: { name: "Jeepney", len: 34, wid: 14, color: "#f5c518", speed: 60, pax: 16, weight: 3, loads: true },
    multicab: { name: "Multicab", len: 22, wid: 12, color: "#4caf50", speed: 65, pax: 8, weight: 2, loads: false },
    motorela: { name: "Motorela", len: 18, wid: 12, color: "#ff7043", speed: 45, pax: 6, weight: 1.5, loads: true },
    car: { name: "Private car", len: 22, wid: 13, color: "#42a5f5", speed: 80, pax: 2, weight: 1, loads: false },
    motorcycle: { name: "Motorcycle", len: 10, wid: 6, color: "#ab47bc", speed: 85, pax: 1.5, weight: 0.5, loads: false },
    truck: { name: "Truck/Bus", len: 40, wid: 15, color: "#8d6e63", speed: 50, pax: 20, weight: 3, loads: false }
};

const LOCATIONS = {
    cogon: {
        note: "Heavy pedestrians and sidewalk vendors slow everyone down. Jeepneys and motorelas often stop to load.",
        roads: ["Yacapin St", "Capt. Vicente Roa St"],
        lanes: { N: "Yacapin St from north", S: "Yacapin St from south", E: "Capt. V. Roa St from east", W: "Capt. V. Roa St from west" },
        rates: { N: 10, S: 10, E: 8, W: 8 },
        mix: { jeepney: 30, multicab: 15, motorela: 20, car: 15, motorcycle: 18, truck: 2 },
        loadChance: 0.45,
        speedFactor: 0.8,
        peakSlow: 0.9
    },
    carmen: {
        note: "Jeepney terminal traffic. Lots of PUJs heading to outer barangays and Bukidnon.",
        roads: ["Max Suniel St", "Kauswagan Rd"],
        lanes: { N: "Max Suniel St from north", S: "Max Suniel St from south", E: "Kauswagan Rd from east", W: "Kauswagan Rd from west" },
        rates: { N: 12, S: 12, E: 9, W: 9 },
        mix: { jeepney: 40, multicab: 20, motorela: 10, car: 12, motorcycle: 15, truck: 3 },
        loadChance: 0.6,
        speedFactor: 0.9,
        peakSlow: 0.85
    },
    highway: {
        note: "Heavy through-traffic with trucks and buses. Very slow at peak hours.",
        roads: ["Bulua side road", "National Highway"],
        lanes: { N: "Side road from north", S: "Side road from south", E: "Natl Hwy from Kauswagan", W: "Natl Hwy from Iligan side" },
        rates: { N: 4, S: 5, E: 15, W: 15 },
        mix: { jeepney: 20, multicab: 10, motorela: 5, car: 25, motorcycle: 25, truck: 15 },
        loadChance: 0.2,
        speedFactor: 1,
        peakSlow: 0.65
    }
};

const LIGHT_POS = { N: [232, 232], S: [368, 368], W: [232, 368], E: [368, 232] };
const LABEL_POS = { N: [242, 20, "right"], S: [358, 572, "left"], W: [6, 388, "left"], E: [594, 214, "right"] };

const locationSel = document.getElementById("location");
const timeInput = document.getElementById("startTime");
const modeSel = document.getElementById("mode");
const rainBox = document.getElementById("rain");
const speedSel = document.getElementById("speed");
const playBtn = document.getElementById("playBtn");
const message = document.getElementById("message");

const startLocation = new URLSearchParams(window.location.search).get("loc");
if (LOCATIONS[startLocation]) locationSel.value = startLocation;

let running = true;
let sim = {};
let stats = {};
let lastTime = performance.now();

function startValue() {
    return timeInput.value || "07:00";
}

function newStats() {
    return { startTime: startValue(), duration: 0, passed: 0, totalWait: 0, passengers: 0, longestQueue: 0 };
}

function currentLocation() {
    return LOCATIONS[locationSel.value];
}

function timeToSeconds(value) {
    const parts = value.split(":");
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
}

function formatClock(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + suffix;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ":" + String(s).padStart(2, "0");
}

function peakFactor(seconds) {
    const m = seconds / 60;
    if (m >= 420 && m < 480) return 2.2;
    if (m >= 990 && m < 1140) return 2;
    if (m >= 1320 || m < 300) return 0.3;
    return 1;
}

function avgWait(s) {
    return s.passed > 0 ? s.totalWait / s.passed : 0;
}

function resetSim() {
    sim = {
        vehicles: { N: [], S: [], E: [], W: [] },
        clock: timeToSeconds(startValue()),
        mode: modeSel.value,
        phase: 0,
        light: "green",
        timer: 0,
        greenTime: modeSel.value === "smart" ? MIN_GREEN : FIXED_GREEN
    };
}

function resetAll() {
    stats = { fixed: newStats(), smart: newStats() };
    resetSim();
}

function pickType(mix) {
    let total = 0;
    for (const key in mix) total += mix[key];
    let r = Math.random() * total;
    for (const key in mix) {
        r -= mix[key];
        if (r <= 0) return key;
    }
    return "car";
}

function spawn(dir) {
    const lane = sim.vehicles[dir];
    const last = lane[lane.length - 1];
    if (last && last.d - last.len < GAP) return;
    const loc = currentLocation();
    const type = pickType(loc.mix);
    const t = TYPES[type];
    const willLoad = t.loads && Math.random() < loc.loadChance;
    lane.push({
        type: type,
        len: t.len,
        d: 0,
        speed: t.speed / 2,
        wait: 0,
        crossed: false,
        loadAt: willLoad ? 40 + Math.random() * 170 : -1,
        loadTimer: 0
    });
}

function isGreen(dir) {
    return sim.light === "green" && PHASES[sim.phase].includes(dir);
}

function lightColor(dir) {
    if (!PHASES[sim.phase].includes(dir)) return "#e74c3c";
    if (sim.light === "green") return "#2ecc71";
    if (sim.light === "yellow") return "#f1c40f";
    return "#e74c3c";
}

function laneDemand(dir) {
    let total = 0;
    for (const v of sim.vehicles[dir]) {
        if (!v.crossed) total += TYPES[v.type].weight;
    }
    return total;
}

function phaseDemand(phase) {
    return PHASES[phase].reduce((sum, dir) => sum + laneDemand(dir), 0);
}

function smartGreen(phase) {
    const time = MIN_GREEN + phaseDemand(phase) * 1.2;
    return Math.min(MAX_GREEN, Math.max(MIN_GREEN, time));
}

function queueLength(dir) {
    return sim.vehicles[dir].filter(v => !v.crossed && v.speed < 5).length;
}

function updateLights(dt) {
    sim.timer += dt;
    if (sim.light === "green") {
        const laneEmpty = sim.mode === "smart"
            && sim.timer >= MIN_GREEN
            && phaseDemand(sim.phase) === 0
            && phaseDemand(1 - sim.phase) > 0;
        if (sim.timer >= sim.greenTime || laneEmpty) {
            sim.light = "yellow";
            sim.timer = 0;
        }
    } else if (sim.light === "yellow") {
        if (sim.timer >= YELLOW) {
            sim.light = "allred";
            sim.timer = 0;
        }
    } else if (sim.timer >= ALL_RED) {
        sim.phase = 1 - sim.phase;
        sim.light = "green";
        sim.timer = 0;
        sim.greenTime = sim.mode === "smart" ? smartGreen(sim.phase) : FIXED_GREEN;
    }
}

function moveLane(dir, dt, s) {
    const lane = sim.vehicles[dir];
    const loc = currentLocation();
    let slow = loc.speedFactor * (rainBox.checked ? 0.6 : 1);
    if (peakFactor(sim.clock) > 1) slow *= loc.peakSlow;

    for (let i = 0; i < lane.length; i++) {
        const v = lane[i];
        let limit = Infinity;
        if (i > 0) limit = lane[i - 1].d - lane[i - 1].len - GAP;
        if (!v.crossed && !isGreen(dir)) limit = Math.min(limit, STOP);

        if (v.loadTimer > 0) {
            v.loadTimer -= dt;
            limit = Math.min(limit, v.d);
        } else if (v.loadAt > 0 && v.d >= v.loadAt && !v.crossed) {
            v.loadTimer = 2 + Math.random() * 4;
            v.loadAt = -1;
        }

        const maxSpeed = TYPES[v.type].speed * slow;
        const wanted = Math.min(maxSpeed, v.speed + 60 * dt);
        const next = Math.max(v.d, Math.min(v.d + wanted * dt, limit));
        v.speed = (next - v.d) / dt;
        v.d = next;

        if (!v.crossed && v.speed < 5) v.wait += dt;

        if (!v.crossed && v.d > STOP) {
            v.crossed = true;
            s.passed++;
            s.totalWait += v.wait;
            s.passengers += TYPES[v.type].pax;
        }
    }

    sim.vehicles[dir] = lane.filter(v => v.d - v.len < SIZE);
}

function step(dt) {
    const s = stats[sim.mode];
    const loc = currentLocation();
    s.duration += dt;
    sim.clock = (sim.clock + dt * CLOCK_SPEED) % 86400;
    updateLights(dt);
    const peak = peakFactor(sim.clock);

    for (const dir of DIRS) {
        const slider = Number(document.getElementById("rate" + dir).value) / 100;
        const perMinute = loc.rates[dir] * peak * slider;
        if (Math.random() < (perMinute / 60) * dt) spawn(dir);
        moveLane(dir, dt, s);
        s.longestQueue = Math.max(s.longestQueue, queueLength(dir));
    }
}

function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function drawRoads() {
    ctx.fillStyle = "#4a7c3f";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#4b4f54";
    ctx.fillRect(250, 0, 100, SIZE);
    ctx.fillRect(0, 250, SIZE, 100);

    ctx.strokeStyle = "#f2c94c";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    line(300, 0, 300, 250);
    line(300, 350, 300, SIZE);
    line(0, 300, 250, 300);
    line(350, 300, SIZE, 300);
    ctx.setLineDash([]);

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    line(250, 247, 300, 247);
    line(300, 353, 350, 353);
    line(247, 300, 247, 350);
    line(353, 250, 353, 300);
}

function vehicleRect(dir, v) {
    const w = TYPES[v.type].wid;
    if (dir === "N") return { x: 275 - w / 2, y: v.d - v.len, w: w, h: v.len };
    if (dir === "S") return { x: 325 - w / 2, y: SIZE - v.d, w: w, h: v.len };
    if (dir === "W") return { x: v.d - v.len, y: 325 - w / 2, w: v.len, h: w };
    return { x: SIZE - v.d, y: 275 - w / 2, w: v.len, h: w };
}

function drawVehicles() {
    for (const dir of DIRS) {
        for (const v of sim.vehicles[dir]) {
            const r = vehicleRect(dir, v);
            ctx.fillStyle = TYPES[v.type].color;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            if (v.loadTimer > 0) {
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
            }
        }
    }
}

function drawLights() {
    for (const dir of DIRS) {
        const [x, y] = LIGHT_POS[dir];
        ctx.fillStyle = "#111";
        ctx.fillRect(x - 12, y - 12, 24, 24);
        ctx.fillStyle = lightColor(dir);
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawLabels() {
    const loc = currentLocation();
    ctx.font = "12px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 3;
    for (const dir of DIRS) {
        const [x, y, align] = LABEL_POS[dir];
        ctx.textAlign = align;
        ctx.fillText(loc.lanes[dir], x, y);
        ctx.fillText("Queue: " + queueLength(dir), x, y + 15);
    }
    ctx.shadowBlur = 0;
}

function draw() {
    drawRoads();
    drawVehicles();
    drawLights();
    drawLabels();
    if (rainBox.checked) {
        ctx.fillStyle = "rgba(90, 120, 170, 0.2)";
        ctx.fillRect(0, 0, SIZE, SIZE);
    }
}

function updatePanel() {
    const loc = currentLocation();
    const peak = peakFactor(sim.clock);
    document.getElementById("clock").textContent = formatClock(sim.clock);
    document.getElementById("peak").textContent = peak > 1 ? "Peak hour" : peak < 1 ? "Late night" : "Normal traffic";

    let info = "All red (clearing intersection)";
    if (sim.light === "green") {
        const left = Math.max(0, sim.greenTime - sim.timer);
        info = "Green: " + loc.roads[sim.phase] + " (" + left.toFixed(0) + "s left of " + sim.greenTime.toFixed(0) + "s)";
    } else if (sim.light === "yellow") {
        info = "Yellow: " + loc.roads[sim.phase];
    }
    document.getElementById("lightInfo").textContent = info;

    for (const dir of DIRS) {
        document.getElementById("val" + dir).textContent = document.getElementById("rate" + dir).value + "%";
    }

    document.getElementById("colFixed").className = sim.mode === "fixed" ? "active" : "";
    document.getElementById("colSmart").className = sim.mode === "smart" ? "active" : "";

    const rows = [
        ["Sim time", s => formatDuration(s.duration)],
        ["Avg wait", s => avgWait(s).toFixed(1) + " s"],
        ["Vehicles passed", s => s.passed],
        ["Passengers moved (est.)", s => Math.round(s.passengers)],
        ["Longest queue", s => s.longestQueue]
    ];
    document.getElementById("statsBody").innerHTML = rows
        .map(r => "<tr><td>" + r[0] + "</td><td>" + r[1](stats.fixed) + "</td><td>" + r[1](stats.smart) + "</td></tr>")
        .join("");
}

function updateLabels() {
    const loc = currentLocation();
    document.getElementById("locationNote").textContent = loc.note;
    for (const dir of DIRS) {
        document.getElementById("name" + dir).textContent = loc.lanes[dir];
    }
}

function buildLegend() {
    document.getElementById("legend").innerHTML = Object.values(TYPES)
        .map(t => '<span><i style="background:' + t.color + '"></i>' + t.name + "</span>")
        .join("");
}

async function saveRuns() {
    const modes = Object.keys(stats).filter(m => stats[m].duration >= 10);
    if (modes.length === 0) {
        message.textContent = "Run the simulation for at least 10 seconds first.";
        return;
    }

    const rows = modes.map(m => {
        const s = stats[m];
        return {
            location: locationSel.value,
            time_of_day: s.startTime,
            mode: m,
            weather: rainBox.checked ? "rainy" : "clear",
            duration_sec: Math.round(s.duration),
            avg_wait: Number(avgWait(s).toFixed(2)),
            vehicles_passed: s.passed,
            passengers: Math.round(s.passengers),
            longest_queue: s.longestQueue
        };
    });

    message.textContent = "Saving...";
    const { error } = await db.from("runs").insert(rows);
    message.textContent = error ? "Could not save: " + error.message : "Saved " + rows.length + " run(s).";
}

function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (running && dt > 0) {
        const steps = Number(speedSel.value);
        for (let i = 0; i < steps; i++) step(dt);
    }
    draw();
    updatePanel();
    requestAnimationFrame(loop);
}

locationSel.addEventListener("change", () => {
    resetAll();
    updateLabels();
});

modeSel.addEventListener("change", () => {
    stats[modeSel.value] = newStats();
    resetSim();
});

timeInput.addEventListener("change", () => {
    stats[modeSel.value] = newStats();
    resetSim();
});

playBtn.addEventListener("click", () => {
    running = !running;
    playBtn.textContent = running ? "Pause" : "Resume";
});

document.getElementById("resetBtn").addEventListener("click", resetAll);
document.getElementById("saveBtn").addEventListener("click", saveRuns);

buildLegend();
updateLabels();
resetAll();
requestAnimationFrame(loop);
