const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);

app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

console.log("========================================");
console.log("KChat Server starting...");
console.log("PORT:", PORT);
console.log("DATABASE_URL:", DATABASE_URL ? "FOUND" : "MISSING");
console.log("JWT_SECRET:", JWT_SECRET ? "FOUND" : "MISSING");
console.log("========================================");

if (!DATABASE_URL) {
    console.error("FATAL: DATABASE_URL environment variable is missing.");
    process.exit(1);
}

if (!JWT_SECRET) {
    console.error("FATAL: JWT_SECRET environment variable is missing.");
    process.exit(1);
}

// ======================================================
// DATABASE
// ======================================================

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// ======================================================
// DATABASE TEST
// ======================================================

async function testDatabase() {
    try {
        const result = await pool.query("SELECT NOW()");
        console.log("PostgreSQL connected:", result.rows[0].now);
    } catch (error) {
        console.error("PostgreSQL connection error:", error.message);
        process.exit(1);
    }
}

// ======================================================
// CREATE TABLES
// ======================================================

async function createTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(32) NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role VARCHAR(16) NOT NULL DEFAULT 'user',
                is_banned BOOLEAN NOT NULL DEFAULT FALSE,
                is_muted BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);
        console.log("✅ Tables created successfully");
    } catch (error) {
        console.error("❌ Table creation error:", error.message);
    }
}

// ======================================================
// CREATE ADMIN USER
// ======================================================

async function createAdminUser() {
    try {
        const adminUsername = "admin";
        const adminPassword = "admin123";
        
        const result = await pool.query(
            `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
            [adminUsername]
        );
        
        if (result.rows.length === 0) {
            const passwordHash = await bcrypt.hash(adminPassword, 12);
            await pool.query(
                `
                INSERT INTO users (username, password_hash, role)
                VALUES ($1, $2, 'admin')
                `,
                [adminUsername, passwordHash]
            );
            console.log("✅ Admin user created: admin / admin123");
        } else {
            console.log("ℹ️ Admin user already exists");
        }
    } catch (error) {
        console.error("❌ Admin creation error:", error.message);
    }
}

// ======================================================
// BASIC ROUTES
// ======================================================

app.get("/", (req, res) => {
    res.json({
        status: "online",
        server: "KChat Server"
    });
});

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({
            status: "healthy",
            database: "connected"
        });
    } catch (error) {
        res.status(503).json({
            status: "unhealthy",
            database: "disconnected"
        });
    }
});

// ======================================================
// REGISTER
// ======================================================

app.post("/api/register", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı ve şifre gerekli."
            });
        }

        const cleanUsername = username.trim();

        if (cleanUsername.length < 3 || cleanUsername.length > 32) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı 3-32 karakter arasında olmalı."
            });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı sadece harf, rakam ve _ içerebilir."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Şifre en az 6 karakter olmalı."
            });
        }

        const existingUser = await pool.query(
            `
            SELECT id
            FROM users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [cleanUsername]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Bu kullanıcı adı zaten kullanılıyor."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `
            INSERT INTO users
            (username, password_hash, role)
            VALUES ($1, $2, 'user')
            RETURNING id, username, role, is_banned, is_muted
            `,
            [cleanUsername, passwordHash]
        );

        const user = result.rows[0];

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role
            },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.status(201).json({
            success: true,
            message: "Kayıt başarılı.",
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isBanned: user.is_banned,
                isMuted: user.is_muted
            }
        });

    } catch (error) {
        console.error("REGISTER ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// LOGIN
// ======================================================

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı ve şifre gerekli."
            });
        }

        const result = await pool.query(
            `
            SELECT id, username, password_hash, role, is_banned, is_muted
            FROM users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Kullanıcı adı veya şifre yanlış."
            });
        }

        const user = result.rows[0];

        if (user.is_banned) {
            return res.status(403).json({
                success: false,
                message: "Bu hesap yasaklanmış."
            });
        }

        const passwordCorrect = await bcrypt.compare(password, user.password_hash);

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "Kullanıcı adı veya şifre yanlış."
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role
            },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.json({
            success: true,
            message: "Giriş başarılı.",
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isBanned: user.is_banned,
                isMuted: user.is_muted
            }
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// AUTH MIDDLEWARE
// ======================================================

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Yetkilendirme gerekli."
        });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Geçersiz veya süresi dolmuş oturum."
        });
    }
}

// ======================================================
// CURRENT USER
// ======================================================

app.get("/api/me", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT id, username, role, is_banned, is_muted
            FROM users
            WHERE id = $1
            `,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Kullanıcı bulunamadı."
            });
        }

        const user = result.rows[0];

        if (user.is_banned) {
            return res.status(403).json({
                success: false,
                message: "Bu hesap yasaklanmış."
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isBanned: user.is_banned,
                isMuted: user.is_muted
            }
        });

    } catch (error) {
        console.error("ME ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// ADMIN MIDDLEWARE
// ======================================================

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Admin yetkisi gerekli."
        });
    }
    next();
}

// ======================================================
// ADMIN - GET USERS
// ======================================================

app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT id, username, role, is_banned, is_muted, created_at
            FROM users
            ORDER BY id
            `
        );
        
        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        console.error("GET USERS ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// ADMIN - BAN (with reason)
// ======================================================

app.post("/api/admin/ban", authenticate, requireAdmin, async (req, res) => {
    try {
        const { username, reason } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı gerekli."
            });
        }

        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Ban sebebi gerekli."
            });
        }

        const result = await pool.query(
            `
            UPDATE users
            SET is_banned = TRUE
            WHERE LOWER(username) = LOWER($1)
            AND role != 'admin'
            RETURNING id, username
            `,
            [username.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Kullanıcı bulunamadı veya admin hesabı."
            });
        }

        const bannedUser = result.rows[0];

        // Socket'ini bul ve event gönder
        const targetSocket = getUserSocket(bannedUser.id);
        if (targetSocket) {
            targetSocket.emit("accountBanned", { reason: reason.trim() });
            targetSocket.disconnect(true);
        }

        res.json({
            success: true,
            message: "Kullanıcı banlandı.",
            user: bannedUser
        });

    } catch (error) {
        console.error("BAN ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// ADMIN - UNBAN
// ======================================================

app.post("/api/admin/unban", authenticate, requireAdmin, async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı gerekli."
            });
        }

        const result = await pool.query(
            `
            UPDATE users
            SET is_banned = FALSE
            WHERE LOWER(username) = LOWER($1)
            RETURNING id, username
            `,
            [username.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Kullanıcı bulunamadı."
            });
        }

        res.json({
            success: true,
            message: "Ban kaldırıldı."
        });

    } catch (error) {
        console.error("UNBAN ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// ADMIN - MUTE (with reason)
// ======================================================

app.post("/api/admin/mute", authenticate, requireAdmin, async (req, res) => {
    try {
        const { username, reason } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı gerekli."
            });
        }

        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Mute sebebi gerekli."
            });
        }

        const result = await pool.query(
            `
            UPDATE users
            SET is_muted = TRUE
            WHERE LOWER(username) = LOWER($1)
            AND role != 'admin'
            RETURNING id, username
            `,
            [username.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Kullanıcı bulunamadı veya admin hesabı."
            });
        }

        const mutedUser = result.rows[0];

        // Socket'ini bul ve event gönder
        const targetSocket = getUserSocket(mutedUser.id);
        if (targetSocket) {
            targetSocket.emit("accountMuted", { reason: reason.trim() });
        }

        res.json({
            success: true,
            message: "Kullanıcı susturuldu."
        });

    } catch (error) {
        console.error("MUTE ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// ADMIN - UNMUTE
// ======================================================

app.post("/api/admin/unmute", authenticate, requireAdmin, async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Kullanıcı adı gerekli."
            });
        }

        const result = await pool.query(
            `
            UPDATE users
            SET is_muted = FALSE
            WHERE LOWER(username) = LOWER($1)
            RETURNING id, username
            `,
            [username.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Kullanıcı bulunamadı."
            });
        }

        res.json({
            success: true,
            message: "Mute kaldırıldı."
        });

    } catch (error) {
        console.error("UNMUTE ERROR:", error);
        res.status(500).json({
            success: false,
            message: "Sunucu hatası."
        });
    }
});

// ======================================================
// SOCKET.IO AUTH & ONLINE USERS
// ======================================================

const onlineUsers = new Map(); // userId -> socket

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("AUTH_REQUIRED"));
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        const result = await pool.query(
            `
            SELECT id, username, role, is_banned, is_muted
            FROM users
            WHERE id = $1
            `,
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return next(new Error("USER_NOT_FOUND"));
        }

        const user = result.rows[0];

        if (user.is_banned) {
            return next(new Error("BANNED"));
        }

        socket.user = user;
        next();

    } catch (error) {
        console.error("Socket authentication error:", error.message);
        next(new Error("INVALID_AUTH"));
    }
});

// Helper to get socket by userId
function getUserSocket(userId) {
    return onlineUsers.get(userId) || null;
}

// ======================================================
// SOCKET.IO CHAT
// ======================================================

io.on("connection", (socket) => {
    console.log("Client connected:", socket.user.username, socket.id);

    // Store socket
    onlineUsers.set(socket.user.id, socket);

    socket.emit("loginSuccess", {
        id: socket.user.id,
        username: socket.user.username,
        role: socket.user.role,
        isMuted: socket.user.is_muted
    });

    socket.on("sendMessage", async (data) => {
        try {
            if (!data || typeof data.message !== "string") {
                return;
            }

            const message = data.message.trim();

            if (!message) {
                return;
            }

            if (message.length > 2000) {
                socket.emit("messageError", {
                    message: "Mesaj çok uzun."
                });
                return;
            }

            const result = await pool.query(
                `
                SELECT username, role, is_banned, is_muted
                FROM users
                WHERE id = $1
                `,
                [socket.user.id]
            );

            if (result.rows.length === 0) {
                return;
            }

            const user = result.rows[0];

            if (user.is_banned) {
                socket.emit("accountBanned", { reason: "Hesabınız yasaklanmış." });
                socket.disconnect(true);
                return;
            }

            if (user.is_muted) {
                socket.emit("accountMuted", { reason: "Susturuldunuz." });
                return;
            }

            io.emit("receiveMessage", {
                username: user.username,
                role: user.role,
                message: message,
                time: Date.now()
            });

        } catch (error) {
            console.error("SEND MESSAGE ERROR:", error);
        }
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.user?.username, socket.id);
        onlineUsers.delete(socket.user.id);
    });
});

// ======================================================
// START SERVER
// ======================================================

async function startServer() {
    await testDatabase();
    await createTables();
    await createAdminUser();
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`KChat Server running on port ${PORT}`);
    });
}

startServer().catch((error) => {
    console.error("SERVER START ERROR:", error);
    process.exit(1);
});
