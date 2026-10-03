const LOCATION_NAMES = {
    cogon: "Cogon Market",
    carmen: "Carmen Market",
    highway: "National Hwy (Bulua/Kauswagan)"
};
const MODE_NAMES = { fixed: "Fixed Timer", smart: "Smart" };

const locationFilter = document.getElementById("locationFilter");
const modeFilter = document.getElementById("modeFilter");
const summaryArea = document.getElementById("summary");
const tableArea = document.getElementById("tableArea");

function escapeHtml(text) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(text).replace(/[&<>"']/g, c => map[c]);
}

function formatTime(value) {
    const parts = value.split(":").map(Number);
    const suffix = parts[0] >= 12 ? "PM" : "AM";
    const h12 = parts[0] % 12 === 0 ? 12 : parts[0] % 12;
    return h12 + ":" + String(parts[1]).padStart(2, "0") + " " + suffix;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ":" + String(s).padStart(2, "0");
}

function renderSummary(rows) {
    const summary = {};
    for (const row of rows) {
        if (!summary[row.mode]) summary[row.mode] = { count: 0, wait: 0, passed: 0 };
        summary[row.mode].count++;
        summary[row.mode].wait += Number(row.avg_wait);
        summary[row.mode].passed += row.vehicles_passed;
    }

    summaryArea.innerHTML = Object.keys(summary).map(mode => {
        const s = summary[mode];
        return '<div class="box"><strong>' + escapeHtml(MODE_NAMES[mode] || mode) + "</strong><br>"
            + s.count + " run(s)<br>"
            + "Avg wait: " + (s.wait / s.count).toFixed(1) + " s<br>"
            + "Avg vehicles passed: " + Math.round(s.passed / s.count)
            + "</div>";
    }).join("");
}

function renderTable(rows) {
    if (rows.length === 0) {
        tableArea.innerHTML = "<p>No runs saved yet.</p>";
        return;
    }

    const body = rows.map(row => "<tr>"
        + "<td>" + escapeHtml(new Date(row.created_at).toLocaleString("en-PH")) + "</td>"
        + "<td>" + escapeHtml(LOCATION_NAMES[row.location] || row.location) + "</td>"
        + "<td>" + escapeHtml(formatTime(row.time_of_day)) + "</td>"
        + "<td>" + escapeHtml(MODE_NAMES[row.mode] || row.mode) + "</td>"
        + "<td>" + escapeHtml(row.weather === "rainy" ? "Rainy" : "Clear") + "</td>"
        + "<td>" + formatDuration(row.duration_sec) + "</td>"
        + "<td>" + escapeHtml(row.avg_wait) + " s</td>"
        + "<td>" + row.vehicles_passed + "</td>"
        + "<td>" + row.passengers + "</td>"
        + "<td>" + row.longest_queue + "</td>"
        + "</tr>").join("");

    tableArea.innerHTML = "<table><thead><tr>"
        + "<th>Saved</th><th>Location</th><th>Start time</th><th>Mode</th><th>Weather</th>"
        + "<th>Duration</th><th>Avg wait</th><th>Vehicles</th><th>Passengers</th><th>Longest queue</th>"
        + "</tr></thead><tbody>" + body + "</tbody></table>";
}

async function loadRuns() {
    tableArea.textContent = "Loading...";
    let query = db.from("runs").select("*").order("created_at", { ascending: false });
    if (locationFilter.value) query = query.eq("location", locationFilter.value);
    if (modeFilter.value) query = query.eq("mode", modeFilter.value);

    const { data, error } = await query;
    if (error) {
        summaryArea.innerHTML = "";
        tableArea.textContent = "Could not load runs: " + error.message;
        return;
    }
    renderSummary(data);
    renderTable(data);
}

const citySummaryArea = document.getElementById("citySummary");
const cityTableArea = document.getElementById("cityTableArea");

function yesNo(value) {
    return value ? "On" : "Off";
}

function renderCityRuns(rows) {
    const summary = {};
    for (const row of rows) {
        if (!summary[row.mode]) summary[row.mode] = { count: 0, wait: 0 };
        summary[row.mode].count++;
        summary[row.mode].wait += Number(row.avg_wait);
    }
    citySummaryArea.innerHTML = Object.keys(summary).map(mode => {
        const s = summary[mode];
        return '<div class="box"><strong>' + escapeHtml(MODE_NAMES[mode] || mode) + "</strong><br>"
            + s.count + " city run(s)<br>"
            + "Avg wait: " + (s.wait / s.count).toFixed(1) + " s</div>";
    }).join("");

    if (rows.length === 0) {
        cityTableArea.innerHTML = "<p>No city runs saved yet.</p>";
        return;
    }

    const body = rows.map(row => "<tr>"
        + "<td>" + escapeHtml(new Date(row.created_at).toLocaleString("en-PH")) + "</td>"
        + "<td>" + escapeHtml(row.sim_date) + "</td>"
        + "<td>" + escapeHtml(row.day_type) + "</td>"
        + "<td>" + escapeHtml(formatTime(row.start_time)) + "</td>"
        + "<td>" + escapeHtml(MODE_NAMES[row.mode] || row.mode) + "</td>"
        + "<td>" + escapeHtml(row.weather === "rainy" ? "Rainy" : "Clear") + "</td>"
        + "<td>" + yesNo(row.green_wave) + "</td>"
        + "<td>" + yesNo(row.ped_phase) + "</td>"
        + "<td>" + formatDuration(row.duration_sec) + "</td>"
        + "<td>" + escapeHtml(row.avg_wait) + " s</td>"
        + "<td>" + Number(row.vehicles_passed).toLocaleString() + "</td>"
        + "<td>" + escapeHtml(row.worst_intersection || "-") + " (" + row.worst_queue + ")</td>"
        + "</tr>").join("");

    cityTableArea.innerHTML = "<table><thead><tr>"
        + "<th>Saved</th><th>Sim date</th><th>Day type</th><th>Start</th><th>Mode</th><th>Weather</th>"
        + "<th>Green wave</th><th>Walk phase</th><th>Duration</th><th>Avg wait</th><th>Vehicles</th><th>Worst spot (queue)</th>"
        + "</tr></thead><tbody>" + body + "</tbody></table>";
}

async function loadCityRuns() {
    cityTableArea.textContent = "Loading...";
    let query = db.from("city_runs").select("*").order("created_at", { ascending: false });
    if (modeFilter.value) query = query.eq("mode", modeFilter.value);

    const { data, error } = await query;
    if (error) {
        citySummaryArea.innerHTML = "";
        cityTableArea.textContent = /does not exist|Could not find the table/i.test(error.message)
            ? "Run supabase-city.sql in the Supabase SQL Editor to enable city runs."
            : "Could not load city runs: " + error.message;
        return;
    }
    renderCityRuns(data);
}

locationFilter.addEventListener("change", loadRuns);
modeFilter.addEventListener("change", () => {
    loadRuns();
    loadCityRuns();
});

loadRuns();
loadCityRuns();
