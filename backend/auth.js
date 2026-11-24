const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const authDataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "../database");
const usersPath = path.join(authDataDir, "users.json");
const TOKEN_SECRET = process.env.AUTH_SECRET || "ifb-scheduling-portal-dev-secret-change-me";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(":")) return false;
    const [salt, expectedHex] = storedHash.split(":");
    const actualHex = crypto.scryptSync(String(password), salt, 64).toString("hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const actualBuf = Buffer.from(actualHex, "hex");
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function saveUsers(users) {
    const dir = path.dirname(usersPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${usersPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), "utf8");
    fs.renameSync(tempPath, usersPath);
}

function loadUsers() {
    if (!fs.existsSync(usersPath)) {
        const defaultUsers = [
            {
                id: "usr-admin",
                username: "admin",
                name: "IFB Admin",
                role: "admin",
                passwordHash: hashPassword("admin123")
            },
            {
                id: "usr-planner",
                username: "planner",
                name: "Schedule Planner",
                role: "planner",
                passwordHash: hashPassword("ifb123")
            }
        ];
        saveUsers(defaultUsers);
        return defaultUsers;
    }

    const parsed = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
}

function authenticateUser(username, password) {
    const cleanUser = String(username || "").trim().toLowerCase();
    if (!cleanUser || !password) return null;

    const users = loadUsers();
    const user = users.find(u => String(u.username || "").toLowerCase() === cleanUser);
    if (!user || !verifyPassword(password, user.passwordHash)) return null;

    return {
        id: user.id,
        username: user.username,
        name: user.name || user.username,
        role: user.role || "planner"
    };
}

function createToken(user) {
    const payload = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        exp: Date.now() + TOKEN_TTL_MS
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
}

function verifyToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig) return null;

    const expectedSig = crypto.createHmac("sha256", TOKEN_SECRET).update(encoded).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

function extractToken(req) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7).trim();
    }
    if (req.query && req.query.token) {
        return String(req.query.token).trim();
    }
    return "";
}

function requireAuth(req, res, next) {
    const token = extractToken(req);
    const sessionUser = verifyToken(token);
    if (!sessionUser) {
        return res.status(401).json({ error: "Unauthorized", message: "Please sign in to continue." });
    }
    req.user = sessionUser;
    return next();
}

function requireAdmin(req, res, next) {
    if (!req.user || String(req.user.role || "").toLowerCase() !== "admin") {
        return res.status(403).json({ error: "Forbidden", message: "Admin access is required to manage users." });
    }
    return next();
}

function listUsersSafe() {
    return loadUsers().map(u => ({
        id: u.id,
        username: u.username,
        name: u.name || u.username,
        role: u.role || "planner"
    }));
}

function createPortalUser({ username, password, name, role = "planner" }) {
    const cleanUsername = String(username || "").trim();
    const cleanPassword = String(password || "");
    const cleanName = String(name || cleanUsername).trim();
    const cleanRole = ["admin", "planner"].includes(String(role || "").toLowerCase())
        ? String(role).toLowerCase()
        : "planner";

    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(cleanUsername)) {
        return { error: "Username must be 3–32 letters, numbers, dots, underscores, or hyphens." };
    }
    if (cleanPassword.length < 6) {
        return { error: "Password must be at least 6 characters." };
    }

    const users = loadUsers();
    if (users.some(u => String(u.username || "").toLowerCase() === cleanUsername.toLowerCase())) {
        return { error: `Username "${cleanUsername}" already exists.` };
    }

    const newUser = {
        id: `usr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        username: cleanUsername,
        name: cleanName || cleanUsername,
        role: cleanRole,
        passwordHash: hashPassword(cleanPassword)
    };

    users.push(newUser);
    saveUsers(users);

    return {
        user: {
            id: newUser.id,
            username: newUser.username,
            name: newUser.name,
            role: newUser.role
        }
    };
}

function deletePortalUser(userId, actingUserId) {
    if (!userId) return { error: "User ID is required." };
    if (userId === actingUserId) {
        return { error: "You cannot delete the account you are currently signed in with." };
    }

    const users = loadUsers();
    const target = users.find(u => u.id === userId || u.username === userId);
    if (!target) return { error: "User not found." };

    const remaining = users.filter(u => u.id !== target.id);
    const adminCount = remaining.filter(u => String(u.role || "").toLowerCase() === "admin").length;
    if (String(target.role || "").toLowerCase() === "admin" && adminCount === 0) {
        return { error: "At least one admin account must remain." };
    }

    saveUsers(remaining);
    return { deletedUserId: target.id };
}

module.exports = {
    loadUsers,
    authenticateUser,
    createToken,
    verifyToken,
    requireAuth,
    requireAdmin,
    listUsersSafe,
    createPortalUser,
    deletePortalUser
};