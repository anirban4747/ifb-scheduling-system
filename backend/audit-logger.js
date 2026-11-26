const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "../database");
const sessionsPath = path.join(dataDir, "sessions.json");
const activityLogPath = path.join(dataDir, "activity-logs.jsonl");

const MAX_SESSIONS = 500;
const TOUCH_FLUSH_INTERVAL_MS = 60 * 1000; // Write lastActivityAt at most once per minute per session
const lastTouchFlush = new Map();

const ALLOWED_CLIENT_ACTIONS = new Set([
    "TAB_VIEW",
    "DASHBOARD_FILTER",
    "ANALYSIS_FILTER",
    "RECORDS_FILTER",
    "CSV_EXPORT",
    "DATA_QUALITY_CHECK"
]);

function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function parseUserAgent(uaRaw = "") {
    const ua = String(uaRaw || "");
    if (!ua) return "Unknown";
    let browser = "Browser";
    if (ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("Chrome/")) browser = "Chrome";
    else if (ua.includes("Firefox/")) browser = "Firefox";
    else if (ua.includes("Safari/")) browser = "Safari";

    let os = "Unknown OS";
    if (ua.includes("Windows")) os = "Windows";
    else if (ua.includes("Mac OS")) os = "macOS";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
    else if (ua.includes("Linux")) os = "Linux";

    return `${browser} / ${os}`;
}

function getClientMeta(req) {
    if (!req) return { ip: "server", device: "System" };
    const forwarded = req.headers?.["x-forwarded-for"];
    let ip = Array.isArray(forwarded)
        ? forwarded[0]
        : String(forwarded || req.ip || req.socket?.remoteAddress || "").split(",")[0].trim();
    ip = ip.replace(/^::ffff:/, "") || "unknown";
    const device = parseUserAgent(req.headers?.["user-agent"]);
    return { ip, device };
}

function loadSessions() {
    try {
        if (!fs.existsSync(sessionsPath)) return [];
        const parsed = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveSessions(sessions) {
    ensureDataDir();
    const trimmed = sessions.slice(-MAX_SESSIONS);
    const tmpPath = `${sessionsPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2), "utf8");
    fs.renameSync(tmpPath, sessionsPath);
}

function appendLogEntry(entry) {
    ensureDataDir();
    fs.appendFileSync(activityLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function sanitizeMeta(meta) {
    if (!meta || typeof meta !== "object") return {};
    const clean = {};
    for (const [k, v] of Object.entries(meta)) {
        if (/pass|token|secret/i.test(k)) continue;
        if (v === undefined || v === null || v === "") continue;
        clean[k] = typeof v === "string" ? v.slice(0, 180) : v;
    }
    return clean;
}

function logActivity({ req = null, user = null, sid = "", category = "dashboard", action = "EVENT", summary = "", meta = {} }) {
    const actor = user || req?.user || {};
    const sessionId = sid || actor.sid || "";
    const client = getClientMeta(req);
    const nowIso = new Date().toISOString();

    const entry = {
        id: `log-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        at: nowIso,
        sid: sessionId,
        userId: actor.id || "",
        username: actor.username || "anonymous",
        name: actor.name || actor.username || "Anonymous",
        role: actor.role || "",
        category,
        action,
        summary: String(summary || action).slice(0, 240),
        meta: sanitizeMeta(meta),
        ip: client.ip
    };

    try {
        appendLogEntry(entry);

        if (sessionId && action !== "AUTH_LOGIN" && action !== "AUTH_LOGOUT" && action !== "AUTH_IDLE_TIMEOUT") {
            const sessions = loadSessions();
            const target = sessions.find(s => s.sid === sessionId);
            if (target) {
                target.lastActivityAt = nowIso;
                target.actionCount = (target.actionCount || 0) + 1;
                saveSessions(sessions);
            }
        }
    } catch (err) {
        console.error("[audit-logger] Failed to write log entry:", err.message);
    }

    return entry;
}

function recordSessionStart({ sid, user, req }) {
    if (!sid || !user) return;
    const nowIso = new Date().toISOString();
    const client = getClientMeta(req);

    try {
        const sessions = loadSessions();
        sessions.push({
            sid,
            userId: user.id,
            username: user.username,
            name: user.name || user.username,
            role: user.role || "planner",
            ip: client.ip,
            device: client.device,
            loginAt: nowIso,
            lastActivityAt: nowIso,
            logoutAt: null,
            status: "active",
            endReason: null,
            actionCount: 0
        });
        saveSessions(sessions);
        lastTouchFlush.set(sid, Date.now());
    } catch (err) {
        console.error("[audit-logger] Failed to record session start:", err.message);
    }

    logActivity({
        req,
        user,
        sid,
        category: "session",
        action: "AUTH_LOGIN",
        summary: `Signed in (${client.device})`,
        meta: { device: client.device }
    });
}

function getSessionState(sid) {
    if (!sid) return null;
    const sessions = loadSessions();
    const target = sessions.find(s => s.sid === sid);
    if (!target) return null;
    return {
        status: target.status,
        lastActivityMs: Date.parse(target.lastActivityAt || target.loginAt || "") || null
    };
}

function recordSessionTouch(sid) {
    if (!sid) return;
    const now = Date.now();
    const last = lastTouchFlush.get(sid) || 0;
    if (now - last < TOUCH_FLUSH_INTERVAL_MS) return;

    lastTouchFlush.set(sid, now);
    try {
        const sessions = loadSessions();
        const target = sessions.find(s => s.sid === sid && s.status === "active");
        if (target) {
            target.lastActivityAt = new Date(now).toISOString();
            saveSessions(sessions);
        }
    } catch {
        // Non-blocking
    }
}

function recordSessionEnd(sid, reason = "logout", req = null) {
    if (!sid) return;
    const nowIso = new Date().toISOString();
    let endedSession = null;

    try {
        const sessions = loadSessions();
        const target = sessions.find(s => s.sid === sid);
        if (!target || target.status === "ended") return; // Already ended (prevents duplicate logs)
        target.status = "ended";
        target.logoutAt = nowIso;
        target.endReason = reason;
        saveSessions(sessions);
        lastTouchFlush.delete(sid);
        endedSession = target;
    } catch (err) {
        console.error("[audit-logger] Failed to record session end:", err.message);
    }

    if (endedSession) {
        const isIdle = reason === "idle_timeout" || reason === "idle";
        logActivity({
            req,
            user: {
                id: endedSession.userId,
                username: endedSession.username,
                name: endedSession.name,
                role: endedSession.role
            },
            sid,
            category: "session",
            action: isIdle ? "AUTH_IDLE_TIMEOUT" : "AUTH_LOGOUT",
            summary: isIdle ? "Session timed out after inactivity" : "Signed out",
            meta: { reason }
        });
    }
}

function recordFailedLogin(username, reason, req) {
    const cleanUser = String(username || "").trim() || "(blank)";
    logActivity({
        req,
        user: { username: cleanUser, name: cleanUser, role: "unknown" },
        sid: "",
        category: "session",
        action: "AUTH_LOGIN_FAILED",
        summary: `Failed sign-in attempt for "${cleanUser}" (${reason})`,
        meta: { reason }
    });
}

function getSessions({ limit = 100, username = "", status = "" } = {}) {
    const all = loadSessions();
    const activeCount = all.filter(s => s.status === "active").length;
    const uFilter = String(username || "").trim().toLowerCase();
    const sFilter = String(status || "").trim().toLowerCase();

    const filtered = all
        .filter(s => {
            if (uFilter && !String(s.username || "").toLowerCase().includes(uFilter) && !String(s.name || "").toLowerCase().includes(uFilter)) {
                return false;
            }
            if (sFilter && sFilter !== "all" && String(s.status || "").toLowerCase() !== sFilter) {
                return false;
            }
            return true;
        })
        .reverse()
        .slice(0, Math.min(500, Math.max(1, Number(limit) || 100)));

    return {
        sessions: filtered,
        activeCount,
        totalCount: all.length
    };
}

function getActivityLogs({ limit = 250, username = "", category = "", sid = "", search = "" } = {}) {
    if (!fs.existsSync(activityLogPath)) {
        return { logs: [], totalCount: 0 };
    }

    const rawLines = fs.readFileSync(activityLogPath, "utf8").split(/\r?\n/).filter(Boolean);
    const parsed = [];
    for (const line of rawLines) {
        try {
            parsed.push(JSON.parse(line));
        } catch {
            // Skip malformed lines
        }
    }

    const uFilter = String(username || "").trim().toLowerCase();
    const cFilter = String(category || "").trim().toLowerCase();
    const sidFilter = String(sid || "").trim();
    const qFilter = String(search || "").trim().toLowerCase();

    const filtered = parsed
        .filter(log => {
            if (sidFilter && log.sid !== sidFilter) return false;
            if (cFilter && cFilter !== "all" && String(log.category || "").toLowerCase() !== cFilter) return false;
            if (uFilter && !String(log.username || "").toLowerCase().includes(uFilter) && !String(log.name || "").toLowerCase().includes(uFilter)) {
                return false;
            }
            if (qFilter) {
                const haystack = `${log.username} ${log.name} ${log.action} ${log.summary} ${JSON.stringify(log.meta || {})}`.toLowerCase();
                if (!haystack.includes(qFilter)) return false;
            }
            return true;
        })
        .reverse();

    return {
        logs: filtered.slice(0, Math.min(1000, Math.max(1, Number(limit) || 250))),
        totalCount: parsed.length
    };
}

function csvSafeCell(val) {
    let s = String(val ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function formatLogsAsCsv(logs) {
    const header = ["Timestamp", "Username", "Name", "Role", "Category", "Action", "Summary", "Details", "IP", "Session ID"];
    const rows = logs.map(l => [
        l.at,
        l.username,
        l.name,
        l.role,
        l.category,
        l.action,
        l.summary,
        Object.keys(l.meta || {}).length ? JSON.stringify(l.meta) : "",
        l.ip,
        l.sid
    ]);
    return [header, ...rows].map(r => r.map(csvSafeCell).join(",")).join("\r\n");
}

function createAuditMiddleware() {
    return (req, res, next) => {
        res.on("finish", () => {
            if (res.statusCode >= 400 || !req.user) return;
            const method = req.method.toUpperCase();
            const reqPath = req.path || "";

            if (method === "POST" && reqPath === "/upload-excel") {
                const fileName = req.file?.originalname || "workbook.xlsx";
                const snapshotDate = req.body?.snapshotDate || "";
                logActivity({
                    req,
                    category: "change",
                    action: "SCHEDULE_UPLOAD",
                    summary: `Uploaded Excel schedule "${fileName}"`,
                    meta: { filename: fileName, snapshotDate }
                });
            } else if (method === "POST" && reqPath === "/api/load-sample-demo") {
                logActivity({
                    req,
                    category: "change",
                    action: "DEMO_DATA_LOAD",
                    summary: "Loaded sample demonstration schedule dataset"
                });
            } else if (method === "DELETE" && reqPath.startsWith("/api/schedule-row/")) {
                const rowIndex = reqPath.split("/").pop();
                logActivity({
                    req,
                    category: "change",
                    action: "RECORD_DELETE",
                    summary: `Deleted schedule record row #${rowIndex}`,
                    meta: { rowIndex }
                });
            } else if (method === "DELETE" && reqPath.startsWith("/api/imported-file/")) {
                const snapshotId = decodeURIComponent(reqPath.split("/").pop() || "");
                logActivity({
                    req,
                    category: "change",
                    action: "SNAPSHOT_DELETE",
                    summary: `Deleted imported workbook snapshot (${snapshotId})`,
                    meta: { snapshotId }
                });
            } else if (method === "GET" && reqPath.startsWith("/api/download-file/")) {
                const snapshotId = decodeURIComponent(reqPath.split("/").pop() || "");
                logActivity({
                    req,
                    category: "export",
                    action: "SNAPSHOT_DOWNLOAD",
                    summary: `Downloaded archived workbook (${snapshotId})`,
                    meta: { snapshotId }
                });
            } else if (method === "GET" && reqPath === "/api/sample-template") {
                logActivity({
                    req,
                    category: "export",
                    action: "TEMPLATE_DOWNLOAD",
                    summary: "Downloaded standard Excel schedule template"
                });
            } else if (method === "POST" && reqPath === "/api/users") {
                const createdUsername = String(req.body?.username || "").trim();
                const createdRole = String(req.body?.role || "planner").toLowerCase();
                logActivity({
                    req,
                    category: "admin",
                    action: "USER_CREATE",
                    summary: `Created ${createdRole} account "${createdUsername}"`,
                    meta: { targetUsername: createdUsername, role: createdRole }
                });
            } else if (method === "DELETE" && reqPath.startsWith("/api/users/")) {
                const targetId = decodeURIComponent(reqPath.split("/").pop() || "");
                logActivity({
                    req,
                    category: "admin",
                    action: "USER_DELETE",
                    summary: `Removed user account (${targetId})`,
                    meta: { targetUserId: targetId }
                });
            }
        });
        next();
    };
}

module.exports = {
    ALLOWED_CLIENT_ACTIONS,
    logActivity,
    recordSessionStart,
    getSessionState,
    recordSessionTouch,
    recordSessionEnd,
    recordFailedLogin,
    getSessions,
    getActivityLogs,
    formatLogsAsCsv,
    createAuditMiddleware
};