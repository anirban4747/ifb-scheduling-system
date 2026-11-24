/**
 * IFB MANUFACTURING SCHEDULING PORTAL
 * Production Enterprise Frontend Application Script
 */

let allScheduleRows = [];
let activeCustomer = "ALL";

const API_BASE_URL = ["3000", "3001"].includes(window.location.port)
    ? ""
    : `${window.location.protocol}//${window.location.hostname}:3001`;

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

const DEFAULT_MASTER_DATA = {
    customers: [],
    catalog: {},
    varianceReasons: []
};

let activeMasterData = DEFAULT_MASTER_DATA;

// Number formatting utility (Indian numbering standard e.g. 14,000)
function formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return "0";
    return new Intl.NumberFormat("en-IN").format(Number(value));
}

function formatPercentValue(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
    return `${Number(value).toFixed(2)}%`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "error") icon = "❌";

    const iconEl = document.createElement("span");
    iconEl.textContent = icon;
    const msgEl = document.createElement("span");
    msgEl.textContent = message;
    toast.append(iconEl, msgEl);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ==========================================================================
// APP NAVIGATION & TAB SWITCHING
// ==========================================================================

function switchTab(tabId) {
    document.querySelector(".main-content")?.scrollTo(0, 0);
    document.querySelectorAll(".nav-tab").forEach(tab => {
        tab.classList.toggle("active", tab.getAttribute("data-tab") === tabId);
    });

    document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === `tab-${tabId}`);
    });

    if (tabId === "records") {
        renderMasterRecordsTable();
    }
    if (tabId === "analysis") {
        initAnalysisTab();
    }
    if (tabId === "upload") {
        loadImportedFilesList();
    }
}

// Live Clock
function startClock() {
    const clockEl = document.getElementById("liveClock");
    if (!clockEl) return;

    function update() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString("en-IN", { hour12: false });
    }
    update();
    setInterval(update, 1000);
}

function initializeSnapshotDate() {
    const input = document.getElementById("snapshotDate");
    if (!input || input.value) return;
    const now = new Date();
    input.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ==========================================================================
// MASTER DATA & ENTRY FORM
// ==========================================================================

async function loadMasterData() {
    try {
        const res = await fetch(apiUrl("/master-data"));
        if (res.ok) {
            activeMasterData = await res.json();
            const statusEl = document.getElementById("backendStatusText");
            if (statusEl) statusEl.textContent = "System Online | Connected";
        }
    } catch (err) {
        activeMasterData = DEFAULT_MASTER_DATA;
    }

    populateCustomerDropdowns();
}

function populateCustomerDropdowns() {
    const dashSelect = document.getElementById("customerSelect");
    const recordsFilter = document.getElementById("recordsCustomerFilter");

    const customers = activeMasterData.customers || [];

    if (dashSelect) {
        dashSelect.innerHTML = `<option value="ALL">All Customers (Consolidated)</option>` +
                               customers.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join("");
        dashSelect.value = customers.some(c => c.name === activeCustomer) ? activeCustomer : "ALL";
    }

    if (recordsFilter) {
        recordsFilter.innerHTML = `<option value="ALL">All Customers</option>` +
                                  customers.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join("");
    }

}

// DYNAMIC MONTH GENERATOR & FORM CALCULATIONS
// ==========================================================================

function formatMonthLabel(yearMonthStr) {
    if (!yearMonthStr) return "";
    const [year, month] = yearMonthStr.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const shortYear = String(year).slice(-2);
    return `${months[month - 1]}-${shortYear}`;
}

function displayDeliveryMonth(value) {
    return /^\d{4}-\d{2}$/.test(String(value || "")) ? formatMonthLabel(value) : value || "No month supplied";
}

function displayActualMonth(row) {
    const deliveryMonth = String(row.deliveryMonth || "").trim();
    if (/\d{4}/.test(deliveryMonth) && !/^[\d,.]+$/.test(deliveryMonth)) {
        const parsed = Date.parse(deliveryMonth);
        if (Number.isFinite(parsed)) {
            return new Intl.DateTimeFormat("en", {
                month: "short",
                year: "numeric",
                timeZone: "UTC"
            }).format(new Date(parsed));
        }
    }

    const referenceMonth = row.referenceMonth || (row.importedAt ? row.importedAt.slice(0, 7) : "");
    return referenceMonth ? displayDeliveryMonth(referenceMonth) : "No month supplied";
}

function displayScheduleReceived(row) {
    const value = row.scheduleReceivedDate || (row.importedAt ? row.importedAt.slice(0, 10) : "");
    const parsed = Date.parse(value);
    const date = !value
        ? "-"
        : Number.isFinite(parsed)
            ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(parsed))
            : String(value);
    const receivedQuantity = row.scheduleReceivedQty === null || row.scheduleReceivedQty === undefined || row.scheduleReceivedQty === ""
        ? row.currentMonth ?? row.customerSchedule
        : row.scheduleReceivedQty;
    const quantity = receivedQuantity === null || receivedQuantity === undefined || receivedQuantity === ""
        ? ""
        : ` (Qty: ${formatNumber(receivedQuantity)})`;
    return `${date}${quantity}`;
}

function formatLongMonthLabel(yearMonth) {
    if (!yearMonth) return "";
    const [year, month] = yearMonth.split("-").map(Number);
    return new Intl.DateTimeFormat("en", {
        month: "short",
        year: "numeric",
        timeZone: "UTC"
    }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftYearMonth(yearMonth, offset) {
    const [year, month] = yearMonth.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getActualMonthLabel() {
    const selectedMonth = getSelectedMonthKey();
    return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
        .format(new Date(`${selectedMonth}-01T00:00:00Z`));
}

function getSelectedMonthKey() {
    const monthInput = document.getElementById("dashboardMonth");
    return monthInput && /^\d{4}-\d{2}$/.test(monthInput.value)
        ? monthInput.value
        : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthLabel() {
    return formatLongMonthLabel(shiftYearMonth(getSelectedMonthKey(), -1));
}

function getMonthlyScheduleQuantity(row, monthKey = getSelectedMonthKey(), fallbackValue = 0) {
    if (row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, monthKey)) {
        return Number(row.monthlySchedules[monthKey]) || 0;
    }
    return Number(fallbackValue) || 0;
}


function displayScheduleMonth(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    if (/^\d{4}-\d{2}$/.test(text)) return displayDeliveryMonth(text);
    const monthMatch = text.match(/^([a-z]{3,9})[-\s]+(\d{2}|\d{4})$/i);
    if (monthMatch) {
        const monthIndex = [
            "jan", "feb", "mar", "apr", "may", "jun",
            "jul", "aug", "sep", "oct", "nov", "dec"
        ].findIndex(month => month === monthMatch[1].slice(0, 3).toLowerCase());
        if (monthIndex !== -1) {
            const year = monthMatch[2].length === 2 ? Number(`20${monthMatch[2]}`) : Number(monthMatch[2]);
            return formatMonthLabel(`${year}-${String(monthIndex + 1).padStart(2, "0")}`);
        }
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed)
        ? new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(parsed))
        : text;
}

function displayScheduleDate(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    const parsed = Date.parse(text);
    return Number.isFinite(parsed)
        ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(parsed))
        : text;
}

function displayMonthlySchedules(row) {
    const entries = Object.entries(row.monthlySchedules || {}).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) return "-";
    return entries
        .map(([month, quantity]) => `${displayDeliveryMonth(month)}: ${formatNumber(quantity)}`)
        .join(" | ");
}

function updateDashboardMonthLabels() {
    const monthInput = document.getElementById("dashboardMonth");
    if (!monthInput) return;

    if (!monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    const selectedMonth = monthInput.value;
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) return;

    const month1Key = selectedMonth;
    const month2Key = shiftYearMonth(selectedMonth, 1);
    const month3Key = shiftYearMonth(selectedMonth, 2);

    const month1Label = formatMonthLabel(month1Key);
    const month2Label = formatMonthLabel(month2Key);
    const month3Label = formatMonthLabel(month3Key);

    const planTitle = `Monthly Plan: ${month1Label} (FIRM) and (TENTATIVE 2 months)`;
    const recBanner = document.getElementById("recordsPlanBanner");
    if (recBanner) recBanner.textContent = planTitle;


    const recM1 = document.getElementById("recordsMonth1Label");
    const recM2 = document.getElementById("recordsMonth2Label");
    const recM3 = document.getElementById("recordsMonth3Label");
    if (recM1) recM1.textContent = month1Label;
    if (recM2) recM2.textContent = month2Label;
    if (recM3) recM3.textContent = month3Label;

    const labels = {
        previous: formatLongMonthLabel(shiftYearMonth(selectedMonth, -1)),
        current: formatLongMonthLabel(selectedMonth),
        coming: formatLongMonthLabel(shiftYearMonth(selectedMonth, 1))
    };

    [
        ["previousMonthLabel", labels.previous],
        ["currentMonthLabel", labels.current],
        ["comingMonthLabel", labels.coming],
        ["actualDispatchLabel", labels.previous],
        ["backlogLabel", `Backlog (${labels.previous})`]
    ].forEach(([id, label]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = label;
    });
    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
}


// ==========================================================================
// STREAMLINED SCHEDULE & PLAN ANALYSIS CENTER
// ==========================================================================

let currentComparisonRows = [];
let currentComparisonFilter = "all";

let analysisPairs = [];   // [{ customer, partNo, description }] for the selected sheet

function onScopeFilterChange() {
    refreshCascadingFilters();
    runStreamlinedAnalysis();
}

function refreshCascadingFilters() {
    const custSel = document.getElementById("sameCustomerSelect");
    const partSel = document.getElementById("samePartSelect");
    if (!custSel || !partSel) return;

    const selCust = custSel.value || "ALL";
    const selPart = partSel.value || "";

    // parts this customer orders
    const partMap = new Map();
    analysisPairs.forEach(p => {
        if ((selCust === "ALL" || p.customer === selCust) && !partMap.has(p.partNo)) {
            partMap.set(p.partNo, p.description);
        }
    });
    // customers who order this part
    const custSet = new Set();
    analysisPairs.forEach(p => {
        if (!selPart || p.partNo === selPart) custSet.add(p.customer);
    });

    const parts = [...partMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const customers = [...custSet].sort((a, b) => a.localeCompare(b));

    partSel.innerHTML = `<option value="">All parts (${parts.length})</option>` + parts.map(([no, desc]) => {
        const label = desc && desc !== "-" ? `${no} — ${desc.length > 32 ? desc.slice(0, 32) + "…" : desc}` : no;
        return `<option value="${escapeHTML(no)}">${escapeHTML(label)}</option>`;
    }).join("");
    partSel.value = partMap.has(selPart) ? selPart : "";

    custSel.innerHTML = `<option value="ALL">All customers (${customers.length})</option>` +
        customers.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    custSel.value = custSet.has(selCust) ? selCust : "ALL";
}


async function onSameSheetChange() {
    const sel = document.getElementById("sameSheetSelect");
    if (!sel || !sel.value) return;
    await loadComparisonMeta(sel.value);
    runStreamlinedAnalysis();
}



async function initAnalysisTab() {
    await loadComparisonMeta();
    runStreamlinedAnalysis();
}

function setOptionsKeep(select, html, fallbackValue) {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = html;
    if (previous && [...select.options].some(o => o.value === previous)) select.value = previous;
    else if (fallbackValue !== undefined) select.value = fallbackValue;
}

async function loadComparisonMeta(selectedSnapshotId) {
    try {
        const url = selectedSnapshotId
            ? `/analytics/comparison-meta?snapshotId=${encodeURIComponent(selectedSnapshotId)}`
            : "/analytics/comparison-meta";
        const res = await fetch(apiUrl(url));
        if (!res.ok) throw new Error("Failed to load comparison metadata.");
        const meta = await res.json();

        const sameSel = document.getElementById("sameSheetSelect");
        const sameCompareMonth = document.getElementById("sameCompareMonth");
        const sameMetricMonth = document.getElementById("sameMetricMonth");

        const snapshots = meta.snapshots || [];

        const formatSnapOption = s => {
    const name = String(s.source || "Sheet").replace(/^Copy of\s+/i, "").replace(/\.(xlsx|xls|csv)$/i, "");
    const label = `${s.date || ""} · ${name} (${s.rowCount || 0} rows)`;
    return `<option value="${escapeHTML(s.snapshotId)}" title="${escapeHTML(label)}">${escapeHTML(label)}</option>`;
};

        if (snapshots.length === 0) {
            const emptyOpt = `<option value="">No Excel sheets uploaded</option>`;
            if (sameSel) sameSel.innerHTML = emptyOpt;
            return meta;
        }

        const optionsHtml = snapshots.map(formatSnapOption).join("");
        const oldSame = sameSel?.value;

        if (sameSel) {
            sameSel.innerHTML = optionsHtml;
            if (selectedSnapshotId && snapshots.some(s => s.snapshotId === selectedSnapshotId)) {
                sameSel.value = selectedSnapshotId;
            } else if (oldSame && snapshots.some(s => s.snapshotId === oldSame)) {
                sameSel.value = oldSame;
            } else {
                sameSel.value = snapshots[snapshots.length - 1].snapshotId;
            }
        }


        const months = meta.availableMonths || [];
        const monthOpt = m => `<option value="${escapeHTML(m)}">${formatMonthLabel(m)} (${m})</option>`;
        setOptionsKeep(sameMetricMonth, months.map(monthOpt).join(""), months[months.length - 1]);
        setOptionsKeep(
            sameCompareMonth,
            `<option value="PREV">Previous month</option><option value="NONE">No comparison</option>` + months.map(monthOpt).join(""),
            "PREV"
        );

        analysisPairs = meta.availablePairs || [];
        refreshCascadingFilters();

        return meta;
    } catch (err) {
        console.error("loadComparisonMeta error:", err);
    }
}

async function runStreamlinedAnalysis() {
    await runSameSheetStreamlined();
}
let cmpData = null;
let cmpRange = 6;
function setCmpRange(n) {
    cmpRange = n === 12 ? 12 : 6;
    document.querySelectorAll("#cmpRangeToggle button").forEach(b =>
        b.classList.toggle("active", Number(b.dataset.range) === cmpRange));
    runStreamlinedAnalysis();
}
let cmpLineSort = { key: "grossShortfall", dir: "desc" };

function cmpTarget() {
    const v = Number(document.getElementById("cmpTargetInput")?.value);
    return Number.isFinite(v) && v >= 50 && v <= 100 ? v : 95;
}

function cmpStatus(rate, target) {
    if (rate == null) return { cls: "st-grey", label: "n/a" };
    if (rate >= target) return { cls: "st-green", label: "On target" };
    if (rate >= target - 10) return { cls: "st-amber", label: "Close" };
    return { cls: "st-red", label: "Below target" };
}

function rateCell(rate, st) {
    if (rate == null) return `<span class="muted">–</span>`;
    return `<div class="rate-cell"><span>${rate.toFixed(1)}%</span><span class="rate-bar"><i class="${st.cls}" style="width:${Math.min(rate, 100)}%"></i></span></div>`;
}

function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
    return Math.ceil(v / p) * p;
}

function hideCmpExtras() {
    cmpData = null;
    ["cmpTrendPanel", "cmpLinePanel"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
}

function selectTrendMonth(month) {
    const sel = document.getElementById("sameMetricMonth");
    if (sel && [...sel.options].some(o => o.value === month)) {
        sel.value = month;
        runStreamlinedAnalysis();
    }
}

function renderTrendChart() {
    const panel = document.getElementById("cmpTrendPanel");
    const box = document.getElementById("cmpTrendChart");
    if (!panel || !box) return;
    const trend = cmpData?.monthlyTrend || [];
    if (!trend.length) { panel.style.display = "none"; return; }
    panel.style.display = "block";
        const custSel = document.getElementById("sameCustomerSelect")?.value || "ALL";
    const partTxt = (document.getElementById("samePartSelect")?.value || "").trim();
    const scopeEl = document.getElementById("cmpTrendScope");
    if (scopeEl) {
        scopeEl.textContent = `${custSel === "ALL" ? "All customers" : custSel} · ${partTxt ? `Part: ${partTxt}` : "All parts"} · ${trend[0].label} to ${trend[trend.length - 1].label}. Click a month to select it; the chip is dispatched ÷ commitment.`;
    }

    const target = cmpTarget();
    const W = 760, H = 250, pl = 44, pr = 12, pt = 12, pb = 66;
    const pw = W - pl - pr, ph = H - pt - pb;
    const maxY = niceCeil(Math.max(1, ...trend.flatMap(m => [m.actualCustomerSchedule, m.commitment, m.dispatched])));
    const y = v => pt + ph - (v / maxY) * ph;
    const slot = pw / trend.length;
    const gw = Math.min(slot * 0.62, 110), bw = gw / 3;
    const chipW = Math.min(54, slot - 6);
    const axis = v => v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

    const grid = [0, 0.5, 1].map(f => {
        const v = maxY * f;
        return `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/>` +
               `<text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${axis(v)}</text>`;
    }).join("");

    const groups = trend.map((m, i) => {
        const cx = pl + slot * i + slot / 2, x0 = cx - gw / 2;
        const selected = m.month === cmpData.month;
        const st = cmpStatus(m.fillRateVsCommitment, target);
        const rateText = m.fillRateVsCommitment == null ? "–" : `${m.fillRateVsCommitment.toFixed(1)}%`;
        const bar = (v, cls, j) =>
            `<rect class="${cls}" x="${x0 + bw * j + 1}" y="${y(v)}" width="${bw - 2}" height="${Math.max(pt + ph - y(v), 0)}" rx="2"/>`;
        const tip = m.hasData
            ? `${m.label}\nCustomer demand: ${formatNumber(m.actualCustomerSchedule)}\nIFB commitment: ${formatNumber(m.commitment)}\nDispatched: ${formatNumber(m.dispatched)}\nFill rate: ${rateText}`
            : `${m.label}\nNo data for this selection`;
        return `<g class="cmp-month${selected ? " is-selected" : ""}${m.hasData ? "" : " is-empty"}" data-month="${escapeHTML(m.month)}">
            <title>${escapeHTML(tip)}</title>
            <rect class="slot-bg" x="${cx - slot / 2 + 2}" y="${pt}" width="${slot - 4}" height="${H - pt - 4}" rx="6"/>
            ${bar(m.actualCustomerSchedule, "bar-demand", 0)}${bar(m.commitment, "bar-commit", 1)}${bar(m.dispatched, "bar-disp", 2)}
            <text class="month-label" x="${cx}" y="${pt + ph + 18}" text-anchor="middle">${escapeHTML(m.label)}</text>
            <rect class="chip-bg ${st.cls}" x="${cx - chipW / 2}" y="${pt + ph + 28}" width="${chipW}" height="20" rx="10"/>
            <text class="chip-txt ${st.cls}" x="${cx}" y="${pt + ph + 42}" text-anchor="middle">${rateText}</text>
        </g>`;
    }).join("");

    const sel = trend.find(m => m.month === cmpData.month);
    const summary = sel ? `<div class="cmp-summary">
            <strong>${escapeHTML(sel.label)}</strong>
            <span>Customer demand <b>${formatNumber(sel.actualCustomerSchedule)}</b></span>
            <span>IFB commitment <b>${formatNumber(sel.commitment)}</b></span>
            <span>Dispatched <b>${formatNumber(sel.dispatched)}</b></span>
            <span>Fill rate <b>${sel.fillRateVsCommitment == null ? "–" : sel.fillRateVsCommitment.toFixed(1) + "%"}</b></span>
        </div>` : "";

    box.innerHTML = `
        <div class="cmp-legend">
            <span><i class="lg bar-demand"></i>Customer demand</span>
            <span><i class="lg bar-commit"></i>IFB commitment</span>
            <span><i class="lg bar-disp"></i>Dispatched</span>
        </div>
        <svg class="cmp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly customer demand, IFB commitment and dispatch">
            ${grid}${groups}
        </svg>
        ${summary}`;
    box.querySelectorAll(".cmp-month:not(.is-empty)").forEach(g =>
        g.addEventListener("click", () => selectTrendMonth(g.dataset.month)));
}

function sortCmpLines(key) {
    cmpLineSort = { key, dir: cmpLineSort.key === key && cmpLineSort.dir === "desc" ? "asc" : "desc" };
    renderLineTable();
}

function renderLineTable() {
    const panel = document.getElementById("cmpLinePanel");
    const body = document.getElementById("cmpLineBody");
    const foot = document.getElementById("cmpLineFoot");
    if (!panel || !body || !foot) return;
    const lines = (cmpData?.byLine || []).slice();
    if (!lines.length) { panel.style.display = "none"; return; }
    panel.style.display = "block";

    const target = cmpTarget();
    const { key, dir } = cmpLineSort;
    lines.sort((a, b) => {
        const av = a[key], bv = b[key];
        const cmp = typeof av === "string" ? av.localeCompare(bv) : (av ?? -Infinity) - (bv ?? -Infinity);
        return dir === "asc" ? cmp : -cmp;
    });

    body.innerHTML = lines.map(l => {
        const st = cmpStatus(l.fillRate, target);
        return `<tr>
            <td><strong>${escapeHTML(l.line)}</strong></td>
            <td class="num">${formatNumber(l.commitment)}</td>
            <td class="num">${formatNumber(l.dispatched)}</td>
            <td>${rateCell(l.fillRate, st)}</td>
            <td class="num neg">${l.grossShortfall ? "-" + formatNumber(l.grossShortfall) : "–"}</td>
            <td><span class="chip ${st.cls}">${st.label}</span></td>
        </tr>`;
    }).join("");

    const tc = lines.reduce((s, l) => s + l.commitment, 0);
    const td = lines.reduce((s, l) => s + l.dispatched, 0);
    const ts = lines.reduce((s, l) => s + l.grossShortfall, 0);
    const rate = tc > 0 ? (td / tc) * 100 : null;
    foot.innerHTML = `<tr class="total-row">
        <td>Total</td><td class="num">${formatNumber(tc)}</td><td class="num">${formatNumber(td)}</td>
        <td>${rateCell(rate, cmpStatus(rate, target))}</td>
        <td class="num">${ts ? "-" + formatNumber(ts) : "–"}</td><td></td></tr>`;
}

async function checkDataQuality(snapshotId, name) {
    const box = document.getElementById("dataQualityResult");
    if (!box) return;
    box.style.display = "block";
    box.textContent = `Checking ${name}...`;
    try {
        const q = new URLSearchParams({ snapshotId, mode: "metrics", month: "ALL", customer: "ALL" });
        const res = await fetch(apiUrl(`/analytics/compare-within-sheet?${q}`));
        if (!res.ok) throw new Error("Request failed.");
        const data = await res.json();
        const dq = data.dataQuality;
        if (!dq) throw new Error(data.message || "No data available for this file.");
        const parts = [];
        if (dq.blankLines) parts.push(`${dq.blankLines} parts have no Line`);
        if (dq.numericLines) parts.push(`${dq.numericLines} have a part number in the Line column`);
        if (dq.duplicateKeys) parts.push(`${dq.duplicateKeys} duplicate rows were merged`);
        if (dq.unscheduledDispatchParts) parts.push(`${dq.unscheduledDispatchParts} parts shipped with no schedule`);
        box.textContent = parts.length ? `⚠ ${name}: ${parts.join(" · ")}` : `✓ ${name}: no data issues found`;
    } catch (err) {
        box.textContent = `Could not check ${name}: ${err.message}`;
    }
}

let sameRunId = 0;
let comparisonSort = { key: "diff", dir: "asc" };

let compareTarget = "commitment";   // "commitment" | "dispatch"
let analysisRawRows = [];

function setCompareTarget(target) {
    compareTarget = target === "dispatch" ? "dispatch" : "commitment";
    document.querySelectorAll("#cmpTargetToggle button").forEach(b =>
        b.classList.toggle("active", b.dataset.target === compareTarget));
    applyCompareTarget();
}

function applyCompareTarget() {
    const isDispatch = compareTarget === "dispatch";
    currentComparisonRows = analysisRawRows.map(r => {
        const request = Number(r.qtySchedule) || 0;
        const target = Number(isDispatch ? r.qtyDispatch : r.qtyCommitment) || 0;
        const diff = target - request;
        let status = diff < 0 ? "shortfall" : diff > 0 ? "surplus" : "fulfilled";
        if (request <= 0 && target > 0) status = "unscheduled";
        return {
            ...r,
            qtyA: request,
            qtyB: target,
            diff,
            fulfillmentRate: request > 0 ? (target / request) * 100 : null,
            status
        };
    });
    updateCard("thColBase", "Customer Request");
    updateCard("thColCompare", isDispatch ? "IFB Dispatch" : "IFB Commitment");
    updateCard("thColDiff", "Difference");
    updateCard("thColPct", "Fill %");
    refreshStatusCounts();
    renderComparisonTable();
}

function sortComparison(key) {
    comparisonSort = {
        key,
        dir: comparisonSort.key === key && comparisonSort.dir === "desc" ? "asc" : "desc"
    };
    renderComparisonTable();
}

function rowKey(r) {
    return [r.customerCode || r.customer, r.partNo, r.customerPartNo, r.line]
        .map(v => String(v ?? "").trim().toLowerCase()).join("|");
}

function resolveCompareMonth(month) {
    const compareSel = document.getElementById("sameCompareMonth");
    const monthSel = document.getElementById("sameMetricMonth");
    let target = compareSel?.value || "PREV";
    if (target === "NONE") return "";
    if (target === "PREV") target = shiftYearMonth(month, -1);
    const exists = monthSel && [...monthSel.options].some(o => o.value === target);
    return exists && target !== month ? target : "";
}

async function runSameSheetStreamlined() {
    const runId = ++sameRunId;
    const snapshotId = document.getElementById("sameSheetSelect")?.value;
    const month = document.getElementById("sameMetricMonth")?.value || "ALL";
    const customer = document.getElementById("sameCustomerSelect")?.value || "ALL";
    const part = (document.getElementById("samePartSelect")?.value || "").trim();
    const compareMonth = month !== "ALL" ? resolveCompareMonth(month) : "";

    const tbody = document.getElementById("comparisonTableBody");

    if (!snapshotId) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">No Excel sheets uploaded yet.</td></tr>`;
        return;
    }

    try {
        const common = { snapshotId, customer, part };
        const metricsQuery = new URLSearchParams({ ...common, mode: "metrics", metricA: "commitment", metricB: "dispatch", month, range: String(cmpRange) });
        const requests = [fetch(apiUrl(`/analytics/compare-within-sheet?${metricsQuery}`))];
        if (compareMonth) {
            const changeQuery = new URLSearchParams({ ...common, mode: "months", monthA: compareMonth, monthB: month });
            requests.push(fetch(apiUrl(`/analytics/compare-within-sheet?${changeQuery}`)));
        }
        const responses = await Promise.all(requests);
        if (!responses[0].ok) throw new Error("Analysis request failed.");
        const data = await responses[0].json();
        const change = responses[1]?.ok ? await responses[1].json() : null;
        if (runId !== sameRunId) return;   // a newer request replaced this one

        if (data.status !== "available") {
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">${escapeHTML(data.message || "No data available for this selection.")}</td></tr>`;
            hideCmpExtras();
            analysisRawRows = [];
            currentComparisonRows = [];
            refreshStatusCounts();
            return;
        }

        const s = data.summary;
        updateCard("card1Title", "Planned / Committed");
        updateCard("card1Value", formatNumber(s.totalA));
        updateCard("card1Detail", `Committed Units (${data.monthLabel})`);

        updateCard("card2Title", "Actual Dispatched");
        updateCard("card2Value", formatNumber(s.totalB));
        updateCard("card2Detail", `Shipped Units (${data.monthLabel})`);

        updateCard("card3Title", "Shortfall vs Commitment");
        updateCard("card3Value", s.grossShortfallQty > 0 ? `-${formatNumber(s.grossShortfallQty)}` : "0");
        updateCard("card3Detail", `${s.partsShortfall} parts short · ${formatNumber(s.grossSurplusQty)} shipped above plan · net ${s.netDiff < 0 ? "-" : "+"}${formatNumber(Math.abs(s.netDiff))}`);

        updateCard("card4Title", "Fulfillment Rate");
        updateCard("card4Value", `${s.fulfillmentRate.toFixed(1)}%`);
        updateCard("card4Detail", `${s.partsOnTarget} of ${s.partsOnTarget + s.partsShortfall} scheduled parts on target`);

        // merge schedule change (month vs compare month) into the plan-vs-dispatch rows
        const hasChange = !!compareMonth && change?.status === "available";
        const changeByKey = new Map();
        if (hasChange) (change.rows || []).forEach(r => changeByKey.set(rowKey(r), r));
        analysisRawRows = (data.rows || []).map(r => {
            if (!hasChange) return { ...r, scheduleChange: null, schedulePrev: null };
            const c = changeByKey.get(rowKey(r));
            return { ...r, scheduleChange: c ? c.change : 0, schedulePrev: c ? c.qtyA : 0 };
        });

        const thChange = document.getElementById("thColChange");
        if (thChange) thChange.textContent = hasChange ? `Schedule Δ vs ${change.labelA}` : "Schedule Δ";

        const scope = customer === "ALL" ? "All Customers" : customer;
            let subText = `${scope}${part ? ` · part ${part}` : ""} · ${data.sheet.source}`;
        if (hasChange) {
            const cs = change.summary;
            const sign = cs.netChange >= 0 ? "+" : "";
            subText += ` · Customer schedule ${change.labelB} vs ${change.labelA}: ${sign}${formatNumber(cs.netChange)} units (${sign}${cs.percentChange.toFixed(1)}%), ${cs.partsIncreased} parts up, ${cs.partsDecreased} down`;
        }
        const titleEl = document.getElementById("comparisonTableTitle");
        const subEl = document.getElementById("comparisonTableSubtitle");
                if (titleEl) titleEl.textContent = `Part-wise Schedule Comparison · ${data.monthLabel}`;
        if (subEl) subEl.textContent = subText;

        cmpData = data;
        renderTrendChart();
        renderLineTable();
        applyCompareTarget();
    } catch (err) {
        console.error("runSameSheetStreamlined error:", err);
        showToast("Analysis failed: " + err.message, "error");
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #b91c1c; padding: 24px;">Could not load analysis. ${escapeHTML(err.message)}</td></tr>`;
    }
}


function updateCard(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function updateCountPill(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = formatNumber(count || 0);
}
const STATUS_GROUP = {
    increased: "increased", surplus: "increased", added: "increased", unscheduled: "increased",
    decreased: "decreased", shortfall: "decreased", removed: "decreased",
    unchanged: "unchanged", fulfilled: "unchanged"
};

function refreshStatusCounts() {
    const c = { increased: 0, decreased: 0, unchanged: 0 };
    currentComparisonRows.forEach(r => { const g = STATUS_GROUP[r.status]; if (g) c[g]++; });
    updateCountPill("countPillAll", currentComparisonRows.length);
    updateCountPill("countPillInc", c.increased);
    updateCountPill("countPillDec", c.decreased);
    updateCountPill("countPillUnchanged", c.unchanged);
}
function setComparisonStatusFilter(status) {
    currentComparisonFilter = status;
    document.querySelectorAll("#comparisonFilterPills .chip-filter").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-filter") === status);
    });
    renderComparisonTable();
}

function filterComparisonTable() {
    renderComparisonTable();
}

function renderComparisonTable() {
    const tbody = document.getElementById("comparisonTableBody");
    const searchInput = document.getElementById("comparisonSearchInput");
    if (!tbody) return;

    const query = (searchInput?.value || "").toLowerCase().trim();
    const filter = currentComparisonFilter;

    let filtered = currentComparisonRows;

    if (filter !== "all") filtered = filtered.filter(r => STATUS_GROUP[r.status] === filter);

    if (query) {
        filtered = filtered.filter(row =>
            (row.customer || "").toLowerCase().includes(query) ||
            (row.partNo || "").toLowerCase().includes(query) ||
            (row.customerPartNo || "").toLowerCase().includes(query) ||
            (row.line || "").toLowerCase().includes(query)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 24px;">No matching part records found.</td></tr>`;
        const f = document.getElementById("comparisonTableFoot"); if (f) f.innerHTML = "";
        return;
    }

        if (comparisonSort.key) {
        const { key, dir } = comparisonSort;
        const val = r => (r[key] === null || r[key] === undefined ? -Infinity : r[key]);
        filtered = [...filtered].sort((a, b) => {
            const av = val(a), bv = val(b);
            const cmp = av === bv ? 0
                : (typeof av === "string" && typeof bv === "string") ? av.localeCompare(bv)
                : av < bv ? -1 : 1;
            return dir === "asc" ? cmp : -cmp;
        });
    }

    tbody.innerHTML = filtered.map(row => {
        let statusBadge = "";
        let diffClass = "diff-neutral";
        const valA = row.baseQty ?? row.qtyA ?? 0;
        const valB = row.compareQty ?? row.qtyB ?? 0;
        const diff = row.change ?? row.diff ?? 0;

        if (row.status === "increased") {
            statusBadge = `<span class="badge-status-inc">Increased ↑</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "decreased") {
            statusBadge = `<span class="badge-status-dec">Decreased ↓</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "added") {
            statusBadge = `<span class="badge-status-new">New Part ★</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "removed") {
            statusBadge = `<span class="badge-status-rem">Removed ✕</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "shortfall") {
            statusBadge = `<span class="badge-status-shortfall">Shortfall ⚠️</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "surplus") {
            statusBadge = `<span class="badge-status-fulfilled">Surplus ✓</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "fulfilled") {
            statusBadge = `<span class="badge-status-fulfilled">Fulfilled ✓</span>`;
            diffClass = "diff-neutral";
        } else if (row.status === "unscheduled") {
            statusBadge = `<span class="badge-status-new">Shipped, no schedule</span>`;
            diffClass = "diff-positive";
        } else {
            statusBadge = `<span class="badge-status-same">Unchanged =</span>`;
            diffClass = "diff-neutral";
        }

        const diffDisplay = diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff);
        const pctRaw = row.percentChange ?? row.fulfillmentRate;
        const pctDisplay = pctRaw == null ? "-" : `${pctRaw.toFixed(1)}%`;
        const chg = row.scheduleChange;
        const chgClass = chg > 0 ? "diff-positive" : chg < 0 ? "diff-negative" : "diff-neutral";
        const chgDisplay = chg == null ? "–" : chg > 0 ? `+${formatNumber(chg)}` : formatNumber(chg);
        const chgTitle = row.schedulePrev == null ? ""
            : `title="Customer schedule: ${formatNumber(row.schedulePrev)} → ${formatNumber(row.schedulePrev + chg)}"`;

        return `<tr>
    <td class="cell-trunc" title="${escapeHTML(row.customer)}"><strong>${escapeHTML(row.customer)}</strong></td>
    <td><span class="part-chip">${escapeHTML(row.partNo)}</span></td>
    <td>${escapeHTML(row.line || "-")}</td>
    <td class="num">${formatNumber(valA)}</td>
    <td class="num">${formatNumber(valB)}</td>
    <td class="num ${diffClass}">${diffDisplay}</td>
    <td class="num ${diffClass}">${pctDisplay}</td>
    <td class="num ${chgClass}" ${chgTitle}>${chgDisplay}</td>
    <td>${statusBadge}</td>
</tr>`;
    }).join("");
const foot = document.getElementById("comparisonTableFoot");
if (foot) {
    const tA = filtered.reduce((s, r) => s + (r.baseQty ?? r.qtyA ?? 0), 0);
    const tB = filtered.reduce((s, r) => s + (r.compareQty ?? r.qtyB ?? 0), 0);
    const tD = tB - tA;
    const tC = filtered.reduce((s, r) => s + (r.scheduleChange ?? 0), 0);
    const anyChange = filtered.some(r => r.scheduleChange != null);
    foot.innerHTML = `<tr class="total-row"><td colspan="3">Total (${filtered.length} parts)</td>
        <td class="num">${formatNumber(tA)}</td><td class="num">${formatNumber(tB)}</td>
        <td class="num">${tD > 0 ? "+" : ""}${formatNumber(tD)}</td><td></td>
        <td class="num">${anyChange ? (tC > 0 ? "+" : "") + formatNumber(tC) : ""}</td><td></td></tr>`;
}
}

function exportComparisonToCSV() {
    if (!currentComparisonRows || currentComparisonRows.length === 0) {
        showToast("No comparison data available to export.", "error");
        return;
    }
    const headers = ["Customer", "Part No", "Line", "Customer Request",
        compareTarget === "dispatch" ? "IFB Dispatch" : "IFB Commitment",
        "Difference", "Fill %", "Schedule Change", "Status"];
    const rows = currentComparisonRows.map(r => [
        csvCell(r.customer), csvCell(r.partNo), csvCell(r.line),
        r.qtyA ?? 0, r.qtyB ?? 0, r.diff ?? 0,
        r.fulfillmentRate == null ? "" : r.fulfillmentRate.toFixed(2),
        r.scheduleChange ?? "", csvCell(r.status)
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `IFB_Analysis_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Comparison report exported successfully!", "success");
}


function onDashboardMonthChange() {
    updateDashboardMonthLabels();
}

function onCustomerSelectChange() {
    const select = document.getElementById("customerSelect");
    activeCustomer = select ? select.value : "ALL";
    renderDashboardForCustomer(activeCustomer);
}

function quickSelectCustomer(customer) {
    const select = document.getElementById("customerSelect");
    activeCustomer = customer || "ALL";
    if (select) select.value = activeCustomer;
    renderDashboardForCustomer(activeCustomer);
}


// ==========================================================================
// DASHBOARD (reads the latest uploaded sheet through the analytics API)
// ==========================================================================

const DASH_TARGET = 95;
const DASH_COLORS = { "st-green": "#22c55e", "st-amber": "#f59e0b", "st-red": "#ef4444", "st-grey": "#94a3b8" };
let dashSnapshotId = "";
let dashRunId = 0;

function renderDashboardForCustomer() {
    refreshDashboardInsights();
}

function selectDashMonth(month) {
    const input = document.getElementById("dashboardMonth");
    if (!input || input.value === month) return;
    input.value = month;
    onDashboardMonthChange();
}

function renderDashboardEmpty(message) {
    ["dashDispatched", "dashFulfillment", "dashShortfall"].forEach(id => updateCard(id, "–"));
    ["dashDispatchedSub", "dashFulfillmentSub", "dashShortfallSub", "dashTopShortSub"]
        .forEach(id => updateCard(id, ""));
    updateCard("dashHeading", "Overview");
    updateCard("dashSubheading", message);
    const bar = document.getElementById("dashFulfillmentBar");
    if (bar) bar.style.width = "0%";
    [["schedPrev", "Previous month"], ["schedSel", "Selected month"], ["schedNext", "Upcoming month"]]
        .forEach(([prefix, title]) => paintScheduleCard(prefix, title, null, null));
    const chart = document.getElementById("dashTrendChart");
    if (chart) chart.innerHTML = `<p class="muted" style="padding:16px 4px">${escapeHTML(message)}</p>`;
    ["dashShortfallBody", "dashCustomerBody"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
}

async function refreshDashboardInsights() {
    const runId = ++dashRunId;
    const customer = activeCustomer || "ALL";
    try {
        if (!dashSnapshotId) {
            const metaRes = await fetch(apiUrl("/analytics/comparison-meta"));
            if (!metaRes.ok) throw new Error("Could not load schedule sheets.");
            const meta = await metaRes.json();
            dashSnapshotId = meta.currentSnapshotId || "";
        }
        if (runId !== dashRunId) return;
        const month = getSelectedMonthKey();
        if (!dashSnapshotId) {
            renderDashboardEmpty("No schedule uploaded yet. Use the Upload tab to import an Excel file.");
            return;
        }

        const query = new URLSearchParams({
            snapshotId: dashSnapshotId, mode: "metrics",
            metricA: "commitment", metricB: "dispatch",
            month, customer, range: "6"
        });
        const res = await fetch(apiUrl(`/analytics/compare-within-sheet?${query}`));
        if (!res.ok) throw new Error("Dashboard request failed.");
        const data = await res.json();
        if (runId !== dashRunId) return;

        if (data.status !== "available") {
            renderDashboardEmpty(data.message || "No data available for this selection.");
            return;
        }
        paintDashboard(data, customer);
    } catch (err) {
        if (runId !== dashRunId) return;
        console.error("refreshDashboardInsights error:", err);
        renderDashboardEmpty("Could not load dashboard data. Check that the backend is running.");
    }
}

function paintScheduleCard(prefix, title, entry, base) {
    const labelEl = document.getElementById(`${prefix}Label`);
    const valueEl = document.getElementById(`${prefix}Value`);
    const deltaEl = document.getElementById(`${prefix}Delta`);
    if (!labelEl || !valueEl || !deltaEl) return;

    deltaEl.className = "sched-delta";
    if (!entry) {
        labelEl.textContent = title;
        valueEl.textContent = "–";
        deltaEl.textContent = "";
        return;
    }
    labelEl.textContent = `${title} · ${entry.label}`;
    if (!entry.hasData) {
        valueEl.textContent = "–";
        deltaEl.textContent = "Not in this sheet";
        return;
    }
    valueEl.textContent = formatNumber(entry.demand);
    if (!base || !base.hasData || base.demand <= 0) {
        deltaEl.textContent = "No earlier month to compare";
        return;
    }
    const diff = entry.demand - base.demand;
    const pct = (diff / base.demand) * 100;
    const sign = diff > 0 ? "+" : "";
    const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "●";
    deltaEl.classList.add(diff > 0 ? "up" : diff < 0 ? "down" : "flat");
    deltaEl.textContent = `${arrow} ${sign}${pct.toFixed(1)}% (${sign}${formatNumber(diff)}) vs ${base.label}`;
}

function paintDashboard(data, customer) {
    const s = data.summary;
    const trend = data.monthlyTrend || [];

    updateCard("dashHeading", `${customer === "ALL" ? "All customers" : customer} · ${data.monthLabel}`);
    updateCard("dashSubheading", `Source: ${data.sheet.source}${data.sheet.date ? ` (${data.sheet.date})` : ""}`);

    // schedule cards: previous / selected / upcoming, each vs the month before it
    const around = data.demandAround || {};
    const mPrev = shiftYearMonth(data.month, -1);
    const mNext = shiftYearMonth(data.month, 1);
    paintScheduleCard("schedPrev", "Previous", around[mPrev], around[shiftYearMonth(data.month, -2)]);
    paintScheduleCard("schedSel", "Selected", around[data.month], around[mPrev]);
    paintScheduleCard("schedNext", "Upcoming", around[mNext], around[data.month]);

    // card 2: dispatched
    updateCard("dashDispatched", formatNumber(s.totalB));
    updateCard("dashDispatchedSub", `of ${formatNumber(s.totalA)} committed`);

    // card 3: fulfillment + bar
    const hasPlan = s.totalA > 0;
    const rate = hasPlan ? s.fulfillmentRate : null;
    const st = cmpStatus(rate, DASH_TARGET);
    updateCard("dashFulfillment", hasPlan ? `${rate.toFixed(1)}%` : "–");
    updateCard("dashFulfillmentSub", hasPlan ? `Target ${DASH_TARGET}% · ${st.label}` : "No commitment this month");
    const bar = document.getElementById("dashFulfillmentBar");
    if (bar) {
        bar.style.width = `${hasPlan ? Math.min(rate, 100) : 0}%`;
        bar.style.background = DASH_COLORS[st.cls];
    }

    // card 4: shortfall
    updateCard("dashShortfall", s.grossShortfallQty > 0 ? `-${formatNumber(s.grossShortfallQty)}` : "0");
    updateCard("dashShortfallSub", `${s.partsShortfall} parts short · ${formatNumber(s.grossSurplusQty)} above plan`);

    renderDashTrend(trend, data.month);

    // top 5 shortfall parts
    const short = (data.rows || [])
        .filter(r => r.qtyA > 0 && r.diff < 0)
        .sort((a, b) => a.diff - b.diff);
    updateCard("dashTopShortSub", `Showing ${Math.min(5, short.length)} of ${short.length} short parts · ${data.monthLabel}`);
    const body = document.getElementById("dashShortfallBody");
    if (body) {
        body.innerHTML = short.length
            ? short.slice(0, 5).map(r => `<tr>
                <td><span class="part-chip">${escapeHTML(r.partNo)}</span></td>
                <td class="cell-trunc" title="${escapeHTML(r.customer)}">${escapeHTML(r.customer)}</td>
                <td class="num">${formatNumber(r.qtyA)}</td>
                <td class="num">${formatNumber(r.qtyB)}</td>
                <td class="num neg">${formatNumber(r.diff)}</td>
                <td>${rateCell(r.fulfillmentRate, cmpStatus(r.fulfillmentRate, DASH_TARGET))}</td>
            </tr>`).join("")
            : `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">No parts are short for this month.</td></tr>`;
    }

    // by customer (only when viewing all customers)
    const custPanel = document.getElementById("dashCustomerPanel");
    const twoCol = document.getElementById("dashTwoCol");
    const showCust = customer === "ALL";
    if (custPanel) custPanel.style.display = showCust ? "block" : "none";
    if (twoCol) twoCol.classList.toggle("single", !showCust);
    const custBody = document.getElementById("dashCustomerBody");
    if (custBody && showCust) {
        const list = (data.byCustomer || []).slice()
            .sort((a, b) => (a.fillRate ?? 1e9) - (b.fillRate ?? 1e9));
        custBody.innerHTML = list.length
            ? list.map(c => `<tr>
                <td class="cell-trunc" title="${escapeHTML(c.customer)}"><strong>${escapeHTML(c.customer)}</strong></td>
                <td class="num">${formatNumber(c.commitment)}</td>
                <td class="num">${formatNumber(c.dispatched)}</td>
                <td>${rateCell(c.fillRate, cmpStatus(c.fillRate, DASH_TARGET))}</td>
            </tr>`).join("")
            : `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px;">No customer data for this month.</td></tr>`;
    }
}

function renderDashTrend(trend, selectedMonth) {
    const box = document.getElementById("dashTrendChart");
    if (!box) return;
    if (!trend.length) {
        box.innerHTML = `<p class="muted" style="padding:16px 4px">No trend data for this selection.</p>`;
        return;
    }
    const W = 760, H = 250, pl = 44, pr = 12, pt = 12, pb = 66;
    const pw = W - pl - pr, ph = H - pt - pb;
    const maxY = niceCeil(Math.max(1, ...trend.flatMap(m => [m.actualCustomerSchedule, m.commitment, m.dispatched])));
    const y = v => pt + ph - (v / maxY) * ph;
    const slot = pw / trend.length;
    const gw = Math.min(slot * 0.62, 110), bw = gw / 3;
    const chipW = Math.min(54, slot - 6);
    const axis = v => v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

    const grid = [0, 0.5, 1].map(f => {
        const v = maxY * f;
        return `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/>` +
               `<text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${axis(v)}</text>`;
    }).join("");

    const groups = trend.map((m, i) => {
        const cx = pl + slot * i + slot / 2, x0 = cx - gw / 2;
        const st = cmpStatus(m.fillRateVsCommitment, DASH_TARGET);
        const rateText = m.fillRateVsCommitment == null ? "–" : `${m.fillRateVsCommitment.toFixed(1)}%`;
        const bar = (v, cls, j) =>
            `<rect class="${cls}" x="${x0 + bw * j + 1}" y="${y(v)}" width="${bw - 2}" height="${Math.max(pt + ph - y(v), 0)}" rx="2"/>`;
        const tip = m.hasData
            ? `${m.label}\nCustomer demand: ${formatNumber(m.actualCustomerSchedule)}\nIFB commitment: ${formatNumber(m.commitment)}\nDispatched: ${formatNumber(m.dispatched)}\nFill rate: ${rateText}`
            : `${m.label}\nNo data for this selection`;
        return `<g class="cmp-month${m.month === selectedMonth ? " is-selected" : ""}${m.hasData ? "" : " is-empty"}" data-month="${escapeHTML(m.month)}">
            <title>${escapeHTML(tip)}</title>
            <rect class="slot-bg" x="${cx - slot / 2 + 2}" y="${pt}" width="${slot - 4}" height="${H - pt - 4}" rx="6"/>
            ${bar(m.actualCustomerSchedule, "bar-demand", 0)}${bar(m.commitment, "bar-commit", 1)}${bar(m.dispatched, "bar-disp", 2)}
            <text class="month-label" x="${cx}" y="${pt + ph + 18}" text-anchor="middle">${escapeHTML(m.label)}</text>
            <rect class="chip-bg ${st.cls}" x="${cx - chipW / 2}" y="${pt + ph + 28}" width="${chipW}" height="20" rx="10"/>
            <text class="chip-txt ${st.cls}" x="${cx}" y="${pt + ph + 42}" text-anchor="middle">${rateText}</text>
        </g>`;
    }).join("");

    box.innerHTML = `
        <div class="cmp-legend">
            <span><i class="lg bar-demand"></i>Customer demand</span>
            <span><i class="lg bar-commit"></i>IFB commitment</span>
            <span><i class="lg bar-disp"></i>Dispatched</span>
        </div>
        <svg class="cmp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Six month demand, commitment and dispatch">
            ${grid}${groups}
        </svg>`;
    box.querySelectorAll(".cmp-month:not(.is-empty)").forEach(g =>
        g.addEventListener("click", () => selectDashMonth(g.dataset.month)));
}

// ==========================================================================
// MASTER RECORDS TABLE (FILTER, SEARCH, EXPORT, DELETE)
// ==========================================================================

function filterMasterTable() {
    renderMasterRecordsTable();
}
function toggleRecordColumns() {
    const on = !!document.getElementById("showAllColumns")?.checked;
    document.querySelector(".master-records-table")?.classList.toggle("show-details", on);
    const info = document.getElementById("recordsInfoGroup");
    const ops = document.getElementById("recordsOpsGroup");
    if (info) info.colSpan = on ? 8 : 4;   // the group headers must match the visible columns
    if (ops) ops.colSpan = on ? 5 : 3;
}

function renderMasterRecordsTable() {
    const tbody = document.getElementById("masterRecordsBody");
    const countEl = document.getElementById("recordCounterText");
    const searchInput = document.getElementById("tableSearchInput");
    const filterSelect = document.getElementById("recordsCustomerFilter");
    const versionSelect = document.getElementById("recordsVersionFilter");
    const monthSelect = document.getElementById("recordsMonthFilter");

    if (!tbody) return;

    const setFilterOptions = (select, label, values) => {
        if (!select) return "ALL";
        const selectedValue = select.value || "ALL";
        const options = [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
        select.innerHTML = `<option value="ALL">${label}</option>` +
            options.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(label === "All months" ? displayDeliveryMonth(value) : value)}</option>`).join("");
        select.value = options.includes(selectedValue) ? selectedValue : "ALL";
        return select.value;
    };

    let rows = [...allScheduleRows];
    const searchTerm = (searchInput?.value || "").toLowerCase().trim();
    const custFilter = filterSelect?.value || "ALL";
    const versionFilter = setFilterOptions(versionSelect, "All versions", rows.map(row => row.version));
    const monthFilter = setFilterOptions(monthSelect, "All months", rows.map(row => row.deliveryMonth || "No month supplied"));

    if (custFilter !== "ALL") {
        rows = rows.filter(r => r.customer === custFilter);
    }
    if (versionFilter !== "ALL") {
        rows = rows.filter(r => (r.version || "Current") === versionFilter);
    }
    if (monthFilter !== "ALL") {
        rows = rows.filter(r => (r.deliveryMonth || "No month supplied") === monthFilter);
    }

    if (searchTerm) {
        rows = rows.filter(r => [
            r.serialNo, r.customer, r.customerGroup, r.customerCode,
            r.partNo, r.helper, r.customerPartNo, r.line,
            r.productDescription, r.application, r.version, r.deliveryMonth, r.source, r.importedAt
        ].some(value => String(value || "").toLowerCase().includes(searchTerm)));
    }

    if (countEl) countEl.textContent = `Showing ${rows.length} of ${allScheduleRows.length} records`;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; padding: 24px; color: #94a3b8;">No schedule records match the current criteria.</td></tr>`;
        return;
    }

    const month1Key = getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

        tbody.innerHTML = rows.map((r, displayIndex) => {
        const originalIndex = allScheduleRows.indexOf(r);

        return `
            <tr>
                <td class="col-detail">${escapeHTML(r.serialNo || displayIndex + 1)}</td>
                <td class="cell-trunc" title="${escapeHTML(r.customerGroup || r.customer || "")}"><strong>${escapeHTML(r.customerGroup || r.customer || "-")}</strong></td>
                <td class="col-detail">${escapeHTML(r.customerCode || "-")}</td>
                <td><span class="part-chip">${escapeHTML(r.partNo || "-")}</span></td>
                <td class="col-detail">${escapeHTML(r.helper || "-")}</td>
                <td class="col-detail">${escapeHTML(r.customerPartNo || "-")}</td>
                <td>${escapeHTML(r.line || "-")}</td>
                <td class="cell-trunc" title="${escapeHTML(r.productDescription || "")}">${escapeHTML(r.productDescription || "–")}</td>
                <td class="num">${formatNumber(getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0))}</td>
                <td class="num tentative">${formatNumber(getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0))}</td>
                <td class="num tentative">${formatNumber(getMonthlyScheduleQuantity(r, month3Key, 0))}</td>
                <td class="col-detail">${escapeHTML(r.version || "Current")}</td>
                <td class="col-detail">${escapeHTML(displayScheduleReceived(r))}</td>
                <td class="num">${formatNumber(r.actualDispatch || 0)}</td>
                <td class="num"><strong>${r.balance === null || r.balance === undefined ? "-" : formatNumber(r.balance)}</strong></td>
                <td>
                    <button class="btn-action-icon btn-delete-row" onclick="deleteScheduleRow(${originalIndex})" title="Delete entry">🗑️</button>
                </td>
            </tr>
        `;
    }).join("");
}

async function deleteScheduleRow(index) {
    if (!confirm("Are you sure you want to remove this schedule entry?")) return;

    try {
        const response = await fetch(apiUrl(`/api/schedule-row/${index}`), { method: "DELETE" });
        if (!response.ok) throw new Error("Delete request failed.");
        allScheduleRows.splice(index, 1);
    } catch (error) {
        showToast("Unable to delete the schedule row from the backend.", "error");
        return;
    }

    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
    showToast("Schedule row deleted", "info");
}
function csvCell(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function exportRecordsToCSV() {
    if (!allScheduleRows.length) {
        showToast("No records available to export", "error");
        return;
    }

    const month1Key = getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    const headers = [
        "Sl No", "Customer", "Customer code", "PART No.", "Helper",
        "Customer Part No", "Line", "Description",
        formatMonthLabel(month1Key), formatMonthLabel(month2Key), formatMonthLabel(month3Key),
        "Version", "Schedule Received Date", "Actual Dispatch Qty", "Backlog", "Saved At", "Source"
    ];
    const csvRows = [headers.join(",")];

        allScheduleRows.forEach((r, idx) => {
        csvRows.push([
    r.serialNo || idx + 1, r.customerGroup || r.customer, r.customerCode,
    r.partNo, r.helper, r.customerPartNo, r.line, r.productDescription,
    getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0),
    getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0),
    getMonthlyScheduleQuantity(r, month3Key, 0),
    r.version || "Current", r.scheduleReceivedDate, r.actualDispatch || 0,
    r.balance, r.importedAt, r.source
].map(csvCell).join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `IFB_Schedule_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    showToast("Master schedule exported to CSV", "success");
}

async function loadImportedFilesList() {
    const tbody = document.getElementById("importedFilesTableBody");
    if (!tbody) return;

    try {
        const res = await fetch(apiUrl("/api/imported-files"));
        if (!res.ok) throw new Error("Failed to fetch imported files list.");
        const files = await res.json();

        if (!files.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No Excel schedule files have been imported yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = files.map((file, idx) => {
            const dateStr = file.capturedAt && file.capturedAt !== "-"
                ? new Date(file.capturedAt).toLocaleString("en-IN")
                : file.snapshotDate;

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>📄 ${escapeHTML(file.source || file.filename)}</strong></td>
                    <td><span class="tag">${escapeHTML(file.snapshotDate || "-")}</span></td>
                    <td>${escapeHTML(dateStr)}</td>
                    <td><span class="badge-accent">${formatNumber(file.rowCount)} rows</span></td>
                    <td style="text-align: center; white-space: nowrap;">
                        <button type="button" class="btn-action-icon" data-id="${escapeHTML(file.snapshotId)}" data-name="${escapeHTML(file.source || file.filename)}" onclick="checkDataQuality(this.dataset.id, this.dataset.name)" title="Check data quality">🩺</button>
                        <button type="button" class="btn-action-icon" data-id="${escapeHTML(file.snapshotId)}" onclick="downloadImportedFile(this.dataset.id)" title="Download Excel File">📥</button>
                        <button type="button" class="btn-action-icon btn-delete-row" data-id="${escapeHTML(file.snapshotId)}" data-name="${escapeHTML(file.source || file.filename)}" onclick="deleteImportedFile(this.dataset.id, this.dataset.name)" title="Delete File & Snapshot">🗑️</button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error loading files: ${escapeHTML(err.message)}</td></tr>`;
    }
}

function downloadImportedFile(snapshotId) {
    window.location.href = apiUrl(`/api/download-file/${encodeURIComponent(snapshotId)}`);
}

async function deleteImportedFile(snapshotId, filename) {
    if (!confirm(`Are you sure you want to delete the imported schedule workbook "${filename}"?\nThis will remove its records from the portal.`)) {
        return;
    }

    try {
        const res = await fetch(apiUrl(`/api/imported-file/${encodeURIComponent(snapshotId)}`), {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("Failed to delete snapshot.");
        const result = await res.json();
        showToast("Workbook & snapshot deleted successfully", "success");
        dashSnapshotId = "";

        if (Array.isArray(result.rows)) {
            allScheduleRows = result.rows;
        } else {
            await loadDashboardData();
        }
        renderDashboardForCustomer(activeCustomer);
        renderMasterRecordsTable();
        await loadMasterData();
        loadImportedFilesList();
        await loadComparisonMeta();
        runStreamlinedAnalysis();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// EXCEL BULK UPLOAD WITH DRAG AND DROP
// ==========================================================================

function triggerFileInput() {
    const fileInput = document.getElementById("excelFile");
    if (fileInput) fileInput.click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    const badge = document.getElementById("selectedFileName");
    if (file && badge) {
        badge.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        badge.style.display = "inline-block";
    }
    const status = document.getElementById("uploadStatus");
    if (status) status.textContent = "";
}

function initDragAndDrop() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("excelFile");
    if (!dropZone || !fileInput) return;

    ["dragenter", "dragover"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add("dragover");
        }, false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove("dragover");
        }, false);
    });

    dropZone.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files.length) {
            fileInput.files = files;
            handleFileSelect({ target: fileInput });
        }
    }, false);
}

async function uploadExcel() {
    const fileInput = document.getElementById("excelFile");
    const status = document.getElementById("uploadStatus");
    const uploadButton = document.getElementById("uploadButton");

    if (!fileInput || !fileInput.files.length) {
        showToast("Please choose or drop an Excel file first", "error");
        return;
    }

    const file = fileInput.files[0];
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        const message = "Unsupported file type. Choose an .xlsx, .xls, or .csv spreadsheet.";
        if (status) {
            status.style.color = "#dc2626";
            status.textContent = message;
        }
        showToast(message, "error");
        return;
    }

    const formData = new FormData();
    formData.append("excelFile", file);
    const snapshotDate = document.getElementById("snapshotDate")?.value;
    if (snapshotDate) formData.append("snapshotDate", snapshotDate);

    if (status) {
        status.style.color = "#2563eb";
        status.textContent = "Processing and parsing spreadsheet...";
    }
    if (uploadButton) {
        uploadButton.disabled = true;
        uploadButton.textContent = "Uploading spreadsheet...";
    }

    try {
        const response = await fetch(apiUrl("/upload-excel"), { method: "POST", body: formData });
        const responseText = await response.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            if (response.status === 405) {
                throw new Error("This server does not accept spreadsheet uploads. Start the app backend and open the app through http://localhost:3001 or Live Server.");
            }
            throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Please check the spreadsheet and try again.`);
        }

        if (response.ok) {
            const importedRows = Array.isArray(result.rows) ? result.rows : [];
            if (!importedRows.length) {
                if (status) {
                    status.style.color = "#d97706";
                    status.textContent = "No schedule rows were found. Fill in the template or check that the first sheet has schedule data, then try again.";
                }
                showToast("No schedule rows were found. Check the first worksheet and try again.", "error");
                return;
            }

            allScheduleRows = importedRows;
            dashSnapshotId = "";
            await loadMasterData();
            activeCustomer = "ALL";
            renderDashboardForCustomer(activeCustomer);
            renderMasterRecordsTable();
            loadImportedFilesList();
            loadComparisonMeta();

            if (status) {
                status.style.color = "#059669";
                status.textContent = `${result.message} ${allScheduleRows.length} rows loaded from "${result.filename}" as snapshot dated ${result.snapshotDate || "today"}.`;
            }

            showToast("Spreadsheet uploaded and its rows are now available in the portal.", "success");
            switchTab("dashboard");
        } else {
            const message = result.message || result.error || `Upload failed (HTTP ${response.status}).`;
            if (status) {
                status.style.color = "#dc2626";
                status.textContent = message;
            }
            showToast(message, "error");
        }
    } catch (error) {
        const message = error instanceof TypeError
            ? "Could not reach the server. Check that the backend is running and try again."
            : error.message || "The spreadsheet upload failed.";
        if (status) {
            status.style.color = "#dc2626";
            status.textContent = message;
        }
        showToast(message, "error");
    } finally {
        if (uploadButton) {
            uploadButton.disabled = false;
            uploadButton.textContent = "🚀 Upload & Process Spreadsheet";
        }
    }
}

// ==========================================================================
// INITIAL DATA LOADER
// ==========================================================================

function pickDefaultMonth(rows) {
    const input = document.getElementById("dashboardMonth");
    const months = new Set();
    rows.forEach(r => Object.keys(r.monthlySchedules || {}).forEach(m => months.add(m)));
    if (!input || !months.size || months.has(input.value)) return;
    input.value = [...months].sort().pop();
}

async function loadDashboardData() {
    try {
        const response = await fetch(apiUrl("/dashboard"));
        if (!response.ok) {
            throw new Error("Dashboard request failed.");
        }
        const data = await response.json();
        allScheduleRows = Array.isArray(data.rows) ? data.rows : [];
        return allScheduleRows;
    } catch (error) {
        allScheduleRows = [];
        console.error("loadDashboardData error:", error);
        showToast("Unable to fetch schedule data. Start the backend and try again.", "error");
        return [];
    }
}

async function initApplication() {
    try { localStorage.removeItem("company-analysis-filter-state"); } catch (e) {}
    document.querySelectorAll('a[href="/api/sample-template"]').forEach(a => { a.href = apiUrl("/api/sample-template"); });
    startClock();
    initializeSnapshotDate();
    initDragAndDrop();
    updateDashboardMonthLabels();
    await loadDashboardData();

    await loadMasterData();
    pickDefaultMonth(allScheduleRows); updateDashboardMonthLabels();
    activeCustomer = "ALL";
    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
    toggleRecordColumns();
    loadImportedFilesList();
    loadComparisonMeta();
    switchTab("dashboard");
}

document.addEventListener("DOMContentLoaded", initApplication);

