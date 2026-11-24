/**
 * IFB MANUFACTURING SCHEDULING PORTAL
 * Production Enterprise Frontend Application Script
 */

let allScheduleRows = [];
let activeCustomer = "ALL";

const API_BASE_URL = ["3000", "3001"].includes(window.location.port)
    ? ""
    : `${window.location.protocol}//${window.location.hostname}:3001`;

const AUTH_TOKEN_KEY = "ifb_auth_token";
const AUTH_USER_KEY = "ifb_auth_user";
const NATIVE_FETCH = window.fetch.bind(window);

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || "null");
    } catch {
        return null;
    }
}

function getLoginPageUrl() {
    return ["3000", "3001"].includes(window.location.port)
        ? "/login"
        : "login.html";
}

function redirectToLogin() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    if (!window.location.pathname.endsWith("/login") && !window.location.pathname.endsWith("login.html")) {
        window.location.replace(getLoginPageUrl());
    }
}

function withTokenQuery(urlStr) {
    const token = getAuthToken();
    if (!token) return urlStr;
    const sep = urlStr.includes("?") ? "&" : "?";
    return `${urlStr}${sep}token=${encodeURIComponent(token)}`;
}

async function logoutPortal() {
    const token = getAuthToken();
    try {
        if (token) {
            await NATIVE_FETCH(apiUrl("/api/auth/logout"), {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
        }
    } catch {
        // Ignore network errors on logout
    }
    redirectToLogin();
}

function renderAuthUserChip(user) {
    const chip = document.getElementById("authUserChip");
    const nameEl = document.getElementById("authUserName");
    const usersTab = document.getElementById("navTabUsers");
    if (!user) return;
    if (chip && nameEl) {
        const roleLabel = user.role ? ` (${user.role})` : "";
        nameEl.textContent = `${user.name || user.username}${roleLabel}`;
        chip.style.display = "inline-flex";
    }
    if (usersTab) {
        const isAdmin = String(user.role || "").toLowerCase() === "admin";
        usersTab.style.display = isAdmin ? "" : "none";
        if (!isAdmin && document.getElementById("tab-users")?.classList.contains("active")) {
            switchTab("dashboard");
        }
    }
}

async function loadAdminUsers() {
    const tbody = document.getElementById("adminUsersTableBody");
    if (!tbody) return;

    const currentUser = getStoredUser();
    if (String(currentUser?.role || "").toLowerCase() !== "admin") {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #b91c1c; padding: 20px;">Admin privileges required.</td></tr>`;
        return;
    }

    try {
        const res = await fetch(apiUrl("/api/users"));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Failed to load users.");

        const users = Array.isArray(data.users) ? data.users : [];
        if (!users.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 20px;">No users found.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map((u, idx) => {
            const isSelf = u.id === currentUser.id;
            const roleBadgeCls = u.role === "admin" ? "badge-accent" : "tag";
            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHTML(u.name || u.username)}</strong></td>
                    <td><code>${escapeHTML(u.username)}</code></td>
                    <td><span class="${roleBadgeCls}">${escapeHTML(u.role)}</span></td>
                    <td style="text-align: right;">
                        ${isSelf
                            ? `<span class="muted">Current session</span>`
                            : `<button type="button" class="btn-action-icon btn-delete-row" data-id="${escapeHTML(u.id)}" data-username="${escapeHTML(u.username)}" onclick="deleteAdminUser(this.dataset.id, this.dataset.username)" title="Remove user">🗑️</button>`
                        }
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #dc2626; padding: 20px;">${escapeHTML(err.message)}</td></tr>`;
    }
}

async function handleCreateUserSubmit(event) {
    event.preventDefault();
    const nameInput = document.getElementById("newUserFullName");
    const userInput = document.getElementById("newUserUsername");
    const passInput = document.getElementById("newUserPassword");
    const roleSelect = document.getElementById("newUserRole");
    const submitBtn = document.getElementById("createUserBtn");

    const payload = {
        name: (nameInput?.value || "").trim(),
        username: (userInput?.value || "").trim(),
        password: passInput?.value || "",
        role: roleSelect?.value || "planner"
    };

    if (!payload.username || !payload.password) {
        showToast("Username and password are required.", "error");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Adding...";
    }

    try {
        const res = await fetch(apiUrl("/api/users"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Could not create user.");

        if (nameInput) nameInput.value = "";
        if (userInput) userInput.value = "";
        if (passInput) passInput.value = "";
        if (roleSelect) roleSelect.value = "planner";

        showToast(`User "${data.user?.username || payload.username}" added.`, "success");
        await loadAdminUsers();
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "+ Add User";
        }
    }
}

async function deleteAdminUser(userId, username) {
    if (!confirm(`Remove user "${username}"? They will no longer be able to sign in.`)) return;

    try {
        const res = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}`), {
            method: "DELETE"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Could not remove user.");

        showToast(`User "${username}" removed.`, "info");
        await loadAdminUsers();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// Automatically attach Bearer token to requests hitting the API base URL
window.fetch = async (input, init = {}) => {
    const urlStr = typeof input === "string" ? input : (input && input.url) || "";
    const isApiRequest = urlStr.startsWith("/") || (API_BASE_URL && urlStr.startsWith(API_BASE_URL));
    const token = getAuthToken();

    const headers = new Headers(init.headers || (typeof input !== "string" && input?.headers) || {});
    if (isApiRequest && token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await NATIVE_FETCH(input, { ...init, headers });
    if (isApiRequest && response.status === 401 && !urlStr.includes("/api/auth/")) {
        redirectToLogin();
    }
    return response;
};

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
    if (tabId === "users") {
        loadAdminUsers();
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
    const schedules = row.monthlySchedules;
    if (schedules && Object.keys(schedules).length > 0) {
        return Object.prototype.hasOwnProperty.call(schedules, monthKey)
            ? Number(schedules[monthKey]) || 0
            : 0;
    }
    return Number(fallbackValue) || 0;
}

function getMonthlyDispatchQuantity(row, monthKey) {
    const dispatches = row.monthlyDispatches;
    if (dispatches && Object.keys(dispatches).length > 0) {
        return Object.prototype.hasOwnProperty.call(dispatches, monthKey)
            ? Number(dispatches[monthKey]) || 0
            : 0;
    }
    return Number(row.actualDispatch) || 0;
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

let analysisPairs = [];   // [{ customer, partNo, customerPartNo, line, description }]
let analysisScope = { customer: "ALL", part: "", partQuery: "", label: "" };
let scopeDropdownItems = [];

function getAnalysisScopeLabel() {
    if (analysisScope.label) return analysisScope.label;
    if (analysisScope.customer === "ALL" && !analysisScope.part && !analysisScope.partQuery) {
        return "All customers · All parts";
    }
    const custPart = analysisScope.customer === "ALL" ? "All companies" : analysisScope.customer;
    const itemPart = analysisScope.part
        ? `Part ${analysisScope.part}`
        : analysisScope.partQuery
            ? `"${analysisScope.partQuery}"`
            : "All parts";
    return `${custPart} · ${itemPart}`;
}

function updateScopeInputDisplay() {
    const input = document.getElementById("analysisScopeInput");
    const clearBtn = document.getElementById("analysisScopeClear");
    const isFiltered = analysisScope.customer !== "ALL" || !!analysisScope.part || !!analysisScope.partQuery;
    if (input) input.value = isFiltered ? analysisScope.label : "";
    if (clearBtn) clearBtn.style.display = isFiltered ? "inline-flex" : "none";
}

function syncAnalysisScopeWithPairs() {
    const custSet = new Set(analysisPairs.map(p => p.customer));
    const partSet = new Set(analysisPairs.map(p => p.partNo));
    if (analysisScope.customer !== "ALL" && !custSet.has(analysisScope.customer)) {
        analysisScope = { customer: "ALL", part: "", partQuery: "", label: "" };
    } else if (analysisScope.part && !partSet.has(analysisScope.part)) {
        analysisScope.part = "";
        analysisScope.label = analysisScope.customer === "ALL" ? "" : `${analysisScope.customer} — All parts`;
    }
    updateScopeInputDisplay();
}

function applyAnalysisScope(nextScope) {
    analysisScope = {
        customer: nextScope.customer || "ALL",
        part: nextScope.part || "",
        partQuery: nextScope.partQuery || "",
        label: nextScope.label || ""
    };
    updateScopeInputDisplay();
    closeScopeDropdown();
    runStreamlinedAnalysis();
}

function clearAnalysisScope() {
    applyAnalysisScope({ customer: "ALL", part: "", partQuery: "", label: "" });
}

function closeScopeDropdown() {
    const dd = document.getElementById("analysisScopeDropdown");
    if (dd) dd.style.display = "none";
    updateScopeInputDisplay();
}

function buildScopeOptions(rawQuery) {
    const q = (rawQuery || "").trim();
    const qLower = q.toLowerCase();
    const tokens = qLower.split(/\s+/).filter(Boolean);
    const groups = [];

    const addGroup = (heading, items) => {
        if (items.length) groups.push({ heading, items });
    };

    const isSameScope = item =>
        item.customer === analysisScope.customer &&
        item.part === analysisScope.part &&
        item.partQuery.toLowerCase() === analysisScope.partQuery.toLowerCase();

    const pairMatchesTokens = p => {
        const hay = `${p.partNo} ${p.customerPartNo || ""} ${p.line || ""} ${p.description || ""}`.toLowerCase();
        return tokens.every(t => hay.includes(t));
    };

    // Case 1: Empty input or reopened on an existing selection -> show context-aware drilldown
    if (!q) {
        const quick = [{
            customer: "ALL", part: "", partQuery: "", label: "",
            title: "All Customers & All Parts",
            meta: `${analysisPairs.length} parts`
        }];

        if (analysisScope.partQuery) {
            const pq = analysisScope.partQuery;
            const pqTokens = pq.toLowerCase().split(/\s+/).filter(Boolean);
            const matched = analysisPairs.filter(p => {
                const hay = `${p.partNo} ${p.customerPartNo || ""} ${p.line || ""} ${p.description || ""}`.toLowerCase();
                return pqTokens.every(t => hay.includes(t));
            });
            const byCust = new Map();
            matched.forEach(p => byCust.set(p.customer, (byCust.get(p.customer) || 0) + 1));

            quick.push({
                customer: "ALL", part: "", partQuery: pq, label: `All companies · ${pq}`,
                title: `All companies · ${pq}`,
                meta: `${byCust.size} companies · ${matched.length} parts`
            });
            addGroup("Quick Scope", quick);
            addGroup(`Companies with "${pq}"`, [...byCust.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([c, n]) => ({
                    customer: c, part: "", partQuery: pq, label: `${c} · ${pq}`,
                    title: `${c} · ${pq}`, meta: `${n} parts`
                })));
            addGroup(`Parts matching "${pq}"`, matched.slice(0, 35).map(p => ({
                customer: p.customer, part: p.partNo, partQuery: "",
                label: `${p.partNo} (${p.customer})`,
                title: `${p.partNo}${p.line ? ` · ${p.line}` : ""}`,
                meta: p.customer
            })));
            return groups;
        }

        if (analysisScope.customer !== "ALL") {
            const c = analysisScope.customer;
            const cPairs = analysisPairs.filter(p => p.customer === c);
            const byLine = new Map();
            cPairs.forEach(p => {
                if (p.line) byLine.set(p.line, (byLine.get(p.line) || 0) + 1);
            });
            quick.push({
                customer: c, part: "", partQuery: "", label: `${c} — All parts`,
                title: `${c} — All parts`, meta: `${cPairs.length} parts`
            });
            addGroup("Current Customer", quick);
            addGroup(`Lines for ${c}`, [...byLine.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([line, n]) => ({
                    customer: c, part: "", partQuery: line, label: `${c} · ${line}`,
                    title: `${c} · ${line}`, meta: `${n} parts`
                })));
            addGroup(`Parts ordered by ${c}`, cPairs
                .sort((a, b) => a.partNo.localeCompare(b.partNo))
                .map(p => ({
                    customer: c, part: p.partNo, partQuery: "",
                    label: `${p.partNo} (${c})`,
                    title: `${p.partNo}${p.line ? ` · ${p.line}` : ""}${p.description && p.description !== "-" ? ` — ${p.description.slice(0, 32)}` : ""}`,
                    meta: "Part"
                })));
            return groups;
        }

        // Default browse (nothing filtered yet)
        addGroup("Reset / All", quick);
        const byLine = new Map();
        const byCust = new Map();
        analysisPairs.forEach(p => {
            byCust.set(p.customer, (byCust.get(p.customer) || 0) + 1);
            if (p.line && !/^\d+$/.test(p.line)) {
                if (!byLine.has(p.line)) byLine.set(p.line, { parts: 0, custs: new Set() });
                const entry = byLine.get(p.line);
                entry.parts += 1;
                entry.custs.add(p.customer);
            }
        });
        addGroup("Product Lines (All Companies)", [...byLine.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([line, info]) => ({
                customer: "ALL", part: "", partQuery: line, label: `All companies · ${line}`,
                title: `All companies · ${line}`,
                meta: `${info.custs.size} companies · ${info.parts} parts`
            })));
        addGroup("Customers (All Parts)", [...byCust.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([c, n]) => ({
                customer: c, part: "", partQuery: "", label: `${c} — All parts`,
                title: `${c} — All parts`, meta: `${n} parts`
            })));
        return groups;
    }

    // Case 2: Live search based on typed text
    const custCounts = new Map();
    analysisPairs.forEach(p => custCounts.set(p.customer, (custCounts.get(p.customer) || 0) + 1));

    // 1. Customers matching typed text
    const matchedCustomers = [...custCounts.keys()]
        .filter(c => tokens.every(t => c.toLowerCase().includes(t)))
        .sort((a, b) => a.localeCompare(b));

    addGroup("Customers (All Parts)", matchedCustomers.map(c => ({
        customer: c, part: "", partQuery: "", label: `${c} — All parts`,
        title: `${c} — All parts`, meta: `${custCounts.get(c)} parts`
    })));

    // 2. Parts / Lines / Descriptions matching typed text (with All Companies + per-company options)
    const matchedParts = analysisPairs.filter(pairMatchesTokens);
    if (matchedParts.length) {
        const distinctLines = [...new Set(matchedParts.map(p => p.line).filter(Boolean))];
        const termDisplay = distinctLines.length === 1 ? distinctLines[0] : q;
        const termQuery = distinctLines.length === 1 ? distinctLines[0] : q;

        const custMap = new Map();
        matchedParts.forEach(p => custMap.set(p.customer, (custMap.get(p.customer) || 0) + 1));

        const termItems = [{
            customer: "ALL", part: "", partQuery: termQuery,
            label: `All companies · ${termDisplay}`,
            title: `All companies · ${termDisplay}`,
            meta: `${custMap.size} companies · ${matchedParts.length} parts`
        }];
        [...custMap.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([c, n]) => {
                termItems.push({
                    customer: c, part: "", partQuery: termQuery,
                    label: `${c} · ${termDisplay}`,
                    title: `${c} · ${termDisplay}`,
                    meta: `${n} parts`
                });
            });
        addGroup(`Matching "${termDisplay}" by Company`, termItems);
    }

    // 3. Specific Parts (either matching the term OR ordered by matching customers)
    const partItemsMap = new Map();
    const pushPair = p => {
        const key = `${p.customer}||${p.partNo}`;
        if (!partItemsMap.has(key)) {
            partItemsMap.set(key, {
                customer: p.customer, part: p.partNo, partQuery: "",
                label: `${p.partNo} (${p.customer})`,
                title: `${p.partNo}${p.line ? ` · ${p.line}` : ""}${p.description && p.description !== "-" ? ` — ${p.description.slice(0, 30)}` : ""}`,
                meta: p.customer
            });
        }
    };
    matchedParts.forEach(pushPair);
    if (matchedCustomers.length) {
        const custSet = new Set(matchedCustomers);
        analysisPairs.filter(p => custSet.has(p.customer)).forEach(pushPair);
    }
    addGroup("Specific Parts", [...partItemsMap.values()].slice(0, 40));

    groups.forEach(g => g.items.forEach(item => { item.active = isSameScope(item); }));
    return groups;
}

function renderScopeDropdown(query) {
    const dd = document.getElementById("analysisScopeDropdown");
    if (!dd) return;
    const groups = buildScopeOptions(query);
    scopeDropdownItems = [];

    if (!groups.length) {
        dd.innerHTML = `<div class="scope-empty">No matching customers, lines, or parts.</div>`;
        dd.style.display = "block";
        return;
    }

    let html = "";
    groups.forEach(g => {
        html += `<div class="scope-group-label">${escapeHTML(g.heading)}</div>`;
        g.items.forEach(item => {
            const idx = scopeDropdownItems.length;
            scopeDropdownItems.push(item);
            html += `<button type="button" class="scope-option${item.active ? " is-active" : ""}" onmousedown="event.preventDefault(); selectScopeOption(${idx})">
                <span class="scope-opt-title">${escapeHTML(item.title)}</span>
                <span class="scope-opt-meta">${escapeHTML(item.meta)}</span>
            </button>`;
        });
    });

    dd.innerHTML = html;
    dd.style.display = "block";
}

function selectScopeOption(idx) {
    const item = scopeDropdownItems[idx];
    if (item) applyAnalysisScope(item);
}

function openScopeDropdown() {
    const input = document.getElementById("analysisScopeInput");
    if (input && analysisScope.label && input.value === analysisScope.label) {
        input.select();
        renderScopeDropdown("");
    } else {
        renderScopeDropdown(input?.value || "");
    }
}

function onScopeInput() {
    const input = document.getElementById("analysisScopeInput");
    const clearBtn = document.getElementById("analysisScopeClear");
    const val = input?.value || "";
    if (clearBtn) clearBtn.style.display = val || analysisScope.label ? "inline-flex" : "none";
    renderScopeDropdown(val);
}

function onScopeKeydown(event) {
    if (event.key === "Escape") {
        closeScopeDropdown();
        document.getElementById("analysisScopeInput")?.blur();
    } else if (event.key === "Enter") {
        event.preventDefault();
        const val = (document.getElementById("analysisScopeInput")?.value || "").trim();
        if (!val) {
            clearAnalysisScope();
        } else if (scopeDropdownItems.length) {
            selectScopeOption(0);
        }
    }
}

document.addEventListener("click", event => {
    const combo = document.getElementById("analysisScopeCombo");
    if (combo && !combo.contains(event.target)) {
        const dd = document.getElementById("analysisScopeDropdown");
        if (dd && dd.style.display !== "none") closeScopeDropdown();
    }
});


async function onSameSheetChange() {
    const sel = document.getElementById("sameSheetSelect");
    if (!sel || !sel.value) return;
    cmpTrendYear = "";
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
        syncAnalysisScopeWithPairs();

        return meta;
    } catch (err) {
        console.error("loadComparisonMeta error:", err);
    }
}

async function runStreamlinedAnalysis() {
    await runSameSheetStreamlined();
}
let cmpData = null;
let cmpRange = "6";
let cmpTrendYear = "";
let lastAnalysisMonth = "";

function setCmpRange(rangeValue) {
    cmpRange = String(rangeValue || "6");
    if (cmpRange !== "12") cmpTrendYear = "";
    document.querySelectorAll("#cmpRangeToggle button").forEach(b =>
        b.classList.toggle("active", b.dataset.range === cmpRange));
    runStreamlinedAnalysis();
}

function onCmpYearChange() {
    const sel = document.getElementById("cmpYearSelect");
    cmpTrendYear = sel ? sel.value : "";
    runStreamlinedAnalysis();
}

function syncCmpYearDropdown(data) {
    const sel = document.getElementById("cmpYearSelect");
    if (!sel) return;
    const years = data?.availableYears || [];
    if (cmpRange !== "12" || !years.length) {
        sel.style.display = "none";
        return;
    }
    sel.innerHTML = years.map(y => `<option value="${escapeHTML(y)}">${escapeHTML(y)}</option>`).join("");
    const active = data?.trendYear || years[years.length - 1];
    sel.value = years.includes(active) ? active : years[years.length - 1];
    sel.style.display = "inline-block";
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
    const scopeEl = document.getElementById("cmpTrendScope");
    if (scopeEl) {
        scopeEl.textContent = `${getAnalysisScopeLabel()} · ${trend[0].label} to ${trend[trend.length - 1].label}. Click a month to select it; the chip is dispatched ÷ commitment.`;
    }

    const target = cmpTarget();
    const H = 250, pl = 44, pr = 12, pt = 12, pb = 66;
    const isWide = trend.length > 12;
    const W = isWide ? pl + pr + trend.length * 64 : 760;
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
        <div class="cmp-chart-scroll">
            <svg class="cmp-chart" viewBox="0 0 ${W} ${H}" style="${isWide ? `width:${W}px;max-width:none;` : ""}" role="img" aria-label="Monthly customer demand, IFB commitment and dispatch">
                ${grid}${groups}
            </svg>
        </div>
        ${summary}`;
    box.querySelectorAll(".cmp-month:not(.is-empty)").forEach(g =>
        g.addEventListener("click", () => selectTrendMonth(g.dataset.month)));

    if (isWide) {
        const scrollWrap = box.querySelector(".cmp-chart-scroll");
        const selIdx = trend.findIndex(m => m.month === cmpData.month);
        if (scrollWrap && selIdx >= 0) {
            scrollWrap.scrollLeft = Math.max(0, pl + slot * selIdx - scrollWrap.clientWidth / 2 + slot / 2);
        }
    }
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

let analysisRawRows = [];

function applyCompareTarget() {
    currentComparisonRows = analysisRawRows.map(r => {
        const schedule = Number(r.qtySchedule) || 0;
        const commitment = Number(r.qtyCommitment) || 0;
        const dispatch = Number(r.qtyDispatch) || 0;
        const diff = dispatch - commitment;
        let status = diff < 0 ? "shortfall" : diff > 0 ? "surplus" : "fulfilled";
        if (commitment <= 0 && dispatch > 0) status = "unscheduled";
        else if (commitment <= 0 && dispatch <= 0) status = "no_commitment";
        return {
            ...r,
            qtySchedule: schedule,
            qtyCommitment: commitment,
            qtyDispatch: dispatch,
            diff,
            achievementRate: commitment > 0 ? (dispatch / commitment) * 100 : null,
            status
        };
    });
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
    const customer = analysisScope.customer || "ALL";
    const part = analysisScope.part || "";
    const partQuery = analysisScope.partQuery || "";
    const compareMonth = month !== "ALL" ? resolveCompareMonth(month) : "";

    const tbody = document.getElementById("comparisonTableBody");

    if (!snapshotId) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">No Excel sheets uploaded yet.</td></tr>`;
        return;
    }

    try {
        const common = { snapshotId, customer, part, partQuery };
        if (month !== lastAnalysisMonth) {
            cmpTrendYear = "";
            lastAnalysisMonth = month;
        }
        const metricsQuery = new URLSearchParams({
            ...common,
            mode: "metrics",
            metricA: "commitment",
            metricB: "dispatch",
            month,
            range: String(cmpRange),
            ...(cmpRange === "12" && cmpTrendYear ? { trendYear: cmpTrendYear } : {})
        });
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

        let subText = `${getAnalysisScopeLabel()} · ${data.sheet.source}`;
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
        syncCmpYearDropdown(data);
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
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #94a3b8; padding: 24px;">No matching part records found.</td></tr>`;
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
        const diff = row.diff ?? 0;

        if (row.status === "shortfall") {
            statusBadge = `<span class="badge-status-shortfall">Shortfall ⚠️</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "surplus") {
            statusBadge = `<span class="badge-status-fulfilled">Surplus ✓</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "fulfilled") {
            statusBadge = `<span class="badge-status-fulfilled">Met ✓</span>`;
            diffClass = "diff-neutral";
        } else if (row.status === "unscheduled") {
            statusBadge = `<span class="badge-status-new">Shipped, no commitment</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "no_commitment") {
            statusBadge = `<span class="badge-status-same">No commitment</span>`;
            diffClass = "diff-neutral";
        } else {
            statusBadge = `<span class="badge-status-same">Unchanged =</span>`;
            diffClass = "diff-neutral";
        }

        const diffDisplay = diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff);
        const pctDisplay = row.achievementRate == null ? "–" : `${row.achievementRate.toFixed(1)}%`;
        const chg = row.scheduleChange;
        const chgClass = chg > 0 ? "diff-positive" : chg < 0 ? "diff-negative" : "diff-neutral";
        const chgDisplay = chg == null ? "–" : chg > 0 ? `+${formatNumber(chg)}` : formatNumber(chg);
        const chgTitle = row.schedulePrev == null ? ""
            : `title="Customer schedule: ${formatNumber(row.schedulePrev)} → ${formatNumber(row.schedulePrev + chg)}"`;

        return `<tr>
    <td class="cell-trunc" title="${escapeHTML(row.customer)}"><strong>${escapeHTML(row.customer)}</strong></td>
    <td><span class="part-chip">${escapeHTML(row.partNo)}</span></td>
    <td>${escapeHTML(row.line || "-")}</td>
    <td class="num">${formatNumber(row.qtySchedule)}</td>
    <td class="num">${formatNumber(row.qtyCommitment)}</td>
    <td class="num">${formatNumber(row.qtyDispatch)}</td>
    <td class="num ${diffClass}">${diffDisplay}</td>
    <td class="num ${diffClass}">${pctDisplay}</td>
    <td class="num ${chgClass}" ${chgTitle}>${chgDisplay}</td>
    <td>${statusBadge}</td>
</tr>`;
    }).join("");

    const foot = document.getElementById("comparisonTableFoot");
    if (foot) {
        const tSched = filtered.reduce((s, r) => s + (r.qtySchedule ?? 0), 0);
        const tCommit = filtered.reduce((s, r) => s + (r.qtyCommitment ?? 0), 0);
        const tDisp = filtered.reduce((s, r) => s + (r.qtyDispatch ?? 0), 0);
        const tDiff = tDisp - tCommit;
        const tAch = tCommit > 0 ? `${((tDisp / tCommit) * 100).toFixed(1)}%` : "–";
        const tC = filtered.reduce((s, r) => s + (r.scheduleChange ?? 0), 0);
        const anyChange = filtered.some(r => r.scheduleChange != null);
        foot.innerHTML = `<tr class="total-row"><td colspan="3">Total (${filtered.length} parts)</td>
            <td class="num">${formatNumber(tSched)}</td>
            <td class="num">${formatNumber(tCommit)}</td>
            <td class="num">${formatNumber(tDisp)}</td>
            <td class="num">${tDiff > 0 ? "+" : ""}${formatNumber(tDiff)}</td>
            <td class="num">${tAch}</td>
            <td class="num">${anyChange ? (tC > 0 ? "+" : "") + formatNumber(tC) : ""}</td>
            <td></td></tr>`;
    }
}

function exportComparisonToCSV() {
    if (!currentComparisonRows || currentComparisonRows.length === 0) {
        showToast("No comparison data available to export.", "error");
        return;
    }
    const headers = [
        "Customer", "Part No", "Line", "Customer Schedule",
        "IFB Commitment", "IFB Dispatch", "Difference",
        "Achievement %", "Schedule Change", "Status"
    ];
    const rows = currentComparisonRows.map(r => [
        csvCell(r.customer), csvCell(r.partNo), csvCell(r.line),
        r.qtySchedule ?? 0, r.qtyCommitment ?? 0, r.qtyDispatch ?? 0,
        r.diff ?? 0,
        r.achievementRate == null ? "" : r.achievementRate.toFixed(2),
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
let dashAvailableMonths = [];
let dashRunId = 0;

function getDashboardMonthList() {
    if (dashAvailableMonths.length) return [...dashAvailableMonths].sort();
    return getAvailableRecordMonths(allScheduleRows);
}

function populateDashboardMonthOptions(year, preferredMonthKey) {
    const monthSelect = document.getElementById("dashboardMonth");
    if (!monthSelect) return;

    const monthsForYear = getDashboardMonthList().filter(m => m.startsWith(`${year}-`));
    if (!monthsForYear.length) {
        const now = new Date();
        const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const label = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(`${fallback}-01T00:00:00Z`));
        monthSelect.innerHTML = `<option value="${fallback}">${label}</option>`;
        monthSelect.value = fallback;
        return;
    }

    monthSelect.innerHTML = monthsForYear.map(m => {
        const label = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
            .format(new Date(`${m}-01T00:00:00Z`));
        return `<option value="${escapeHTML(m)}">${escapeHTML(label)}</option>`;
    }).join("");

    monthSelect.value = preferredMonthKey && monthsForYear.includes(preferredMonthKey)
        ? preferredMonthKey
        : monthsForYear[monthsForYear.length - 1];
}

function syncDashboardMonthControls(forceLatest = false) {
    const yearSelect = document.getElementById("dashboardYear");
    const monthSelect = document.getElementById("dashboardMonth");
    if (!yearSelect || !monthSelect) return;

    const months = getDashboardMonthList();
    if (!months.length) {
        const now = new Date();
        const y = String(now.getFullYear());
        yearSelect.innerHTML = `<option value="${y}">${y}</option>`;
        yearSelect.value = y;
        populateDashboardMonthOptions(y, "");
        return;
    }

    const years = [...new Set(months.map(m => m.slice(0, 4)))].sort();
    const prevMonth = forceLatest ? "" : monthSelect.value;
    const targetMonth = prevMonth && months.includes(prevMonth) ? prevMonth : months[months.length - 1];
    const targetYear = targetMonth.slice(0, 4);

    yearSelect.innerHTML = years.map(y => `<option value="${escapeHTML(y)}">${escapeHTML(y)}</option>`).join("");
    yearSelect.value = targetYear;
    populateDashboardMonthOptions(targetYear, targetMonth);
}

function onDashboardYearChange() {
    const yearSelect = document.getElementById("dashboardYear");
    const monthSelect = document.getElementById("dashboardMonth");
    if (!yearSelect) return;
    const prevMonthNum = monthSelect?.value ? monthSelect.value.slice(5, 7) : "";
    const candidate = prevMonthNum ? `${yearSelect.value}-${prevMonthNum}` : "";
    populateDashboardMonthOptions(yearSelect.value, candidate);
    onDashboardMonthChange();
}

function renderDashboardForCustomer() {
    refreshDashboardInsights();
}

function selectDashMonth(month) {
    const yearSelect = document.getElementById("dashboardYear");
    const monthSelect = document.getElementById("dashboardMonth");
    if (!monthSelect || !/^\d{4}-\d{2}$/.test(month) || monthSelect.value === month) return;

    const targetYear = month.slice(0, 4);
    if (yearSelect && [...yearSelect.options].some(o => o.value === targetYear)) {
        yearSelect.value = targetYear;
        populateDashboardMonthOptions(targetYear, month);
    }
    if ([...monthSelect.options].some(o => o.value === month)) {
        monthSelect.value = month;
    }
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
            dashAvailableMonths = (meta.availableMonths || []).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
            syncDashboardMonthControls(false);
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
    if (info) info.colSpan = on ? 8 : 4;   // match visible columns in each header group
    if (ops) ops.colSpan = on ? 4 : 3;
}

function getAvailableRecordMonths(rows = allScheduleRows) {
    const months = new Set();
    const parseKey = val => {
        const text = String(val || "").trim();
        if (/^\d{4}-\d{2}$/.test(text)) return text;
        const m = text.match(/^([a-z]{3,9})[\s'/-]+(\d{2}|\d{4})$/i);
        if (!m) return "";
        const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            .indexOf(m[1].slice(0, 3).toLowerCase());
        if (idx === -1) return "";
        const yr = m[2].length === 2 ? Number(`20${m[2]}`) : Number(m[2]);
        return `${yr}-${String(idx + 1).padStart(2, "0")}`;
    };

    rows.forEach(r => {
        Object.keys(r.monthlySchedules || {}).forEach(m => { if (/^\d{4}-\d{2}$/.test(m)) months.add(m); });
        Object.keys(r.monthlyCommitments || {}).forEach(m => { if (/^\d{4}-\d{2}$/.test(m)) months.add(m); });
        Object.keys(r.monthlyDispatches || {}).forEach(m => { if (/^\d{4}-\d{2}$/.test(m)) months.add(m); });
        const dm = parseKey(r.deliveryMonth);
        if (dm) months.add(dm);
    });
    return [...months].sort();
}

function syncRecordsMonthFilter(forceLatest = false) {
    const monthSelect = document.getElementById("recordsMonthFilter");
    const months = getAvailableRecordMonths(allScheduleRows);
    const latest = months.length ? months[months.length - 1] : getSelectedMonthKey();

    if (!monthSelect) return latest;

    const prev = forceLatest ? "" : monthSelect.value;
    if (!months.length) {
        monthSelect.innerHTML = `<option value="${escapeHTML(latest)}">${escapeHTML(formatMonthLabel(latest))}</option>`;
        monthSelect.value = latest;
        return latest;
    }

    monthSelect.innerHTML = months
        .map(m => `<option value="${escapeHTML(m)}">${escapeHTML(formatMonthLabel(m))} (${escapeHTML(m)})</option>`)
        .join("");
    monthSelect.value = prev && months.includes(prev) ? prev : latest;
    return monthSelect.value;
}

function updateRecordsMonthHeaders(month1Key) {
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    const month1Label = formatMonthLabel(month1Key);
    const month2Label = formatMonthLabel(month2Key);
    const month3Label = formatMonthLabel(month3Key);

    const recBanner = document.getElementById("recordsPlanBanner");
    if (recBanner) recBanner.textContent = `Monthly Plan: ${month1Label} (FIRM) and (TENTATIVE 2 months)`;

    const recM1 = document.getElementById("recordsMonth1Label");
    const recM2 = document.getElementById("recordsMonth2Label");
    const recM3 = document.getElementById("recordsMonth3Label");
    if (recM1) recM1.textContent = month1Label;
    if (recM2) recM2.textContent = month2Label;
    if (recM3) recM3.textContent = month3Label;
}

function onRecordsMonthChange() {
    renderMasterRecordsTable();
}

function renderMasterRecordsTable() {
    const tbody = document.getElementById("masterRecordsBody");
    const countEl = document.getElementById("recordCounterText");
    const searchInput = document.getElementById("tableSearchInput");
    const filterSelect = document.getElementById("recordsCustomerFilter");

    if (!tbody) return;

    const month1Key = syncRecordsMonthFilter();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);
    updateRecordsMonthHeaders(month1Key);

    let rows = allScheduleRows.filter(r => {
        const hasMaps = (r.monthlySchedules && Object.keys(r.monthlySchedules).length > 0)
            || (r.monthlyCommitments && Object.keys(r.monthlyCommitments).length > 0)
            || (r.monthlyDispatches && Object.keys(r.monthlyDispatches).length > 0);
        if (!hasMaps) return true;
        return Object.prototype.hasOwnProperty.call(r.monthlySchedules || {}, month1Key)
            || Object.prototype.hasOwnProperty.call(r.monthlyCommitments || {}, month1Key)
            || Object.prototype.hasOwnProperty.call(r.monthlyDispatches || {}, month1Key);
    });

    const totalForMonth = rows.length;
    const searchTerm = (searchInput?.value || "").toLowerCase().trim();
    const custFilter = filterSelect?.value || "ALL";

    if (custFilter !== "ALL") {
        rows = rows.filter(r => r.customer === custFilter || r.customerGroup === custFilter);
    }

    if (searchTerm) {
        rows = rows.filter(r => [
            r.serialNo, r.customer, r.customerGroup, r.customerCode,
            r.partNo, r.helper, r.customerPartNo, r.line,
            r.productDescription, r.application, r.source, r.importedAt
        ].some(value => String(value || "").toLowerCase().includes(searchTerm)));
    }

    if (countEl) countEl.textContent = `Showing ${rows.length} of ${totalForMonth} records`;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 24px; color: #94a3b8;">No schedule records match the current criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map((r, displayIndex) => {
        const originalIndex = allScheduleRows.indexOf(r);
        const firmQty = getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0);
        const tent1Qty = getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0);
        const tent2Qty = getMonthlyScheduleQuantity(r, month3Key, 0);
        const actualDispatch = getMonthlyDispatchQuantity(r, month1Key);
        const hasMonthlyData = (r.monthlySchedules && Object.keys(r.monthlySchedules).length > 0)
            || (r.monthlyDispatches && Object.keys(r.monthlyDispatches).length > 0);
        const backlog = hasMonthlyData ? firmQty - actualDispatch : r.balance;

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
                <td class="num">${formatNumber(firmQty)}</td>
                <td class="num tentative">${formatNumber(tent1Qty)}</td>
                <td class="num tentative">${formatNumber(tent2Qty)}</td>
                <td class="col-detail">${escapeHTML(displayScheduleReceived(r))}</td>
                <td class="num">${formatNumber(actualDispatch)}</td>
                <td class="num"><strong>${backlog === null || backlog === undefined ? "-" : formatNumber(backlog)}</strong></td>
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

    const month1Key = syncRecordsMonthFilter();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    const headers = [
        "Sl No", "Customer", "Customer code", "PART No.", "Helper",
        "Customer Part No", "Line", "Description",
        formatMonthLabel(month1Key), formatMonthLabel(month2Key), formatMonthLabel(month3Key),
        "Schedule Received Date", "Actual Dispatch Qty", "Backlog", "Saved At", "Source"
    ];
    const csvRows = [headers.join(",")];

    allScheduleRows.forEach((r, idx) => {
        const firmQty = getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0);
        const tent1Qty = getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0);
        const tent2Qty = getMonthlyScheduleQuantity(r, month3Key, 0);
        const actualDispatch = getMonthlyDispatchQuantity(r, month1Key);
        const hasMonthlyData = (r.monthlySchedules && Object.keys(r.monthlySchedules).length > 0)
            || (r.monthlyDispatches && Object.keys(r.monthlyDispatches).length > 0);
        const backlog = hasMonthlyData ? firmQty - actualDispatch : r.balance;

        csvRows.push([
            r.serialNo || idx + 1, r.customerGroup || r.customer, r.customerCode,
            r.partNo, r.helper, r.customerPartNo, r.line, r.productDescription,
            firmQty, tent1Qty, tent2Qty,
            r.scheduleReceivedDate, actualDispatch,
            backlog, r.importedAt, r.source
        ].map(csvCell).join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `IFB_Schedule_Export_${month1Key}.csv`;
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
    window.location.href = withTokenQuery(apiUrl(`/api/download-file/${encodeURIComponent(snapshotId)}`));
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
        dashAvailableMonths = [];

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
            dashAvailableMonths = [];
            await loadMasterData();
            activeCustomer = "ALL";
            pickDefaultMonth(allScheduleRows);
            syncRecordsMonthFilter(true);
            renderDashboardForCustomer(activeCustomer);
            renderMasterRecordsTable();

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

function pickDefaultMonth() {
    syncDashboardMonthControls(true);
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
    const token = getAuthToken();
    if (!token) {
        redirectToLogin();
        return;
    }

    let currentUser = getStoredUser();
    try {
        const authRes = await fetch(apiUrl("/api/auth/me"));
        if (!authRes.ok) {
            redirectToLogin();
            return;
        }
        const authData = await authRes.json();
        if (authData.user) {
            currentUser = authData.user;
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(currentUser));
        }
    } catch {
        // Keep cached user if offline, otherwise loadDashboardData will report server error
    }
    renderAuthUserChip(currentUser);

    try { localStorage.removeItem("company-analysis-filter-state"); } catch (e) {}
    document.querySelectorAll('a[href="/api/sample-template"]').forEach(a => { a.href = withTokenQuery(apiUrl("/api/sample-template")); });
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

