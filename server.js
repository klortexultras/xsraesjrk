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
    console.error(
        "FATAL: DATABASE_URL environment variable is missing."
    );
    process.exit(1);
}

if (!JWT_SECRET) {
    console.error(
        "FATAL: JWT_SECRET environment variable is missing."
    );
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

        console.log(
            "PostgreSQL connected:",
            result.rows[0].now
        );

    } catch (error) {

        console.error(
            "PostgreSQL connection error:",
            error.message
        );

        process.exit(1);
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

        if (
            cleanUsername.length < 3 ||
            cleanUsername.length > 32
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Kullanıcı adı 3-32 karakter arasında olmalı."
            });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {

            return res.status(400).json({
                success: false,
                message:
                    "Kullanıcı adı sadece harf, rakam ve _ içerebilir."
            });
        }

        if (password.length < 6) {

            return res.status(400).json({
                success: false,
                message:
                    "Şifre en az 6 karakter olmalı."
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
                message:
                    "Bu kullanıcı adı zaten kullanılıyor."
            });
        }

        const passwordHash =
            await bcrypt.hash(password, 12);

        const result = await pool.query(
            `
            INSERT INTO users
            (
                username,
                password_hash,
                role
            )
            VALUES
            (
                $1,
                $2,
                'user'
            )
            RETURNING
                id,
                username,
                role,
                is_banned,
                is_muted
            `,
            [
                cleanUsername,
                passwordHash
            ]
        );

        const user = result.rows[0];

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role
            },
            JWT_SECRET,
            {
                expiresIn: "7d"
            }
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

        console.error(
            "REGISTER ERROR:",
            error
        );

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
                message:
                    "Kullanıcı adı ve şifre gerekli."
            });
        }

        const result = await pool.query(
            `
            SELECT
                id,
                username,
                password_hash,
                role,
                is_banned,
                is_muted
            FROM users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username.trim()]
        );

        if (result.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message:
                    "Kullanıcı adı veya şifre yanlış."
            });
        }

        const user = result.rows[0];

        if (user.is_banned) {

            return res.status(403).json({
                success: false,
                message:
                    "Bu hesap yasaklanmış."
            });
        }

        const passwordCorrect =
            await bcrypt.compare(
                password,
                user.password_hash
            );

        if (!passwordCorrect) {

            return res.status(401).json({
                success: false,
                message:
                    "Kullanıcı adı veya şifre yanlış."
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role
            },
            JWT_SECRET,
            {
                expiresIn: "7d"
            }
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

        console.error(
            "LOGIN ERROR:",
            error
        );

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

    const authHeader =
        req.headers.authorization;

    if (
        !authHeader ||
        !authHeader.startsWith("Bearer ")
    ) {

        return res.status(401).json({
            success: false,
            message:
                "Yetkilendirme gerekli."
        });
    }

    const token =
        authHeader.substring(7);

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message:
                "Geçersiz veya süresi dolmuş oturum."
        });
    }
}


// ======================================================
// CURRENT USER
// ======================================================

app.get(
    "/api/me",
    authenticate,
    async (req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT
                    id,
                    username,
                    role,
                    is_banned,
                    is_muted
                FROM users
                WHERE id = $1
                `,
                [req.user.id]
            );

            if (result.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Kullanıcı bulunamadı."
                });
            }

            const user =
                result.rows[0];

            if (user.is_banned) {

                return res.status(403).json({
                    success: false,
                    message:
                        "Bu hesap yasaklanmış."
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

            console.error(
                "ME ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Sunucu hatası."
            });
        }
    }
);


// ======================================================
// ADMIN MIDDLEWARE
// ======================================================

function requireAdmin(req, res, next) {

    if (
        !req.user ||
        req.user.role !== "admin"
    ) {

        return res.status(403).json({
            success: false,
            message:
                "Admin yetkisi gerekli."
        });
    }

    next();
}


// ======================================================
// ADMIN - BAN
// ======================================================

app.post(
    "/api/admin/ban",
    authenticate,
    requireAdmin,
    async (req, res) => {

        try {

            const { username } =
                req.body;

            if (!username) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Kullanıcı adı gerekli."
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
                    message:
                        "Kullanıcı bulunamadı veya admin hesabı."
                });
            }

            res.json({
                success: true,
                message:
                    "Kullanıcı banlandı.",
                user:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "BAN ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Sunucu hatası."
            });
        }
    }
);


// ======================================================
// ADMIN - UNBAN
// ======================================================

app.post(
    "/api/admin/unban",
    authenticate,
    requireAdmin,
    async (req, res) => {

        try {

            const { username } =
                req.body;

            if (!username) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Kullanıcı adı gerekli."
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
                    message:
                        "Kullanıcı bulunamadı."
                });
            }

            res.json({
                success: true,
                message:
                    "Ban kaldırıldı."
            });

        } catch (error) {

            console.error(
                "UNBAN ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Sunucu hatası."
            });
        }
    }
);


// ======================================================
// ADMIN - MUTE
// ======================================================

app.post(
    "/api/admin/mute",
    authenticate,
    requireAdmin,
    async (req, res) => {

        try {

            const { username } =
                req.body;

            if (!username) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Kullanıcı adı gerekli."
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
                    message:
                        "Kullanıcı bulunamadı veya admin hesabı."
                });
            }

            res.json({
                success: true,
                message:
                    "Kullanıcı susturuldu."
            });

        } catch (error) {

            console.error(
                "MUTE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Sunucu hatası."
            });
        }
    }
);


// ======================================================
// ADMIN - UNMUTE
// ======================================================

app.post(
    "/api/admin/unmute",
    authenticate,
    requireAdmin,
    async (req, res) => {

        try {

            const { username } =
                req.body;

            if (!username) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Kullanıcı adı gerekli."
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
                    message:
                        "Kullanıcı bulunamadı."
                });
            }

            res.json({
                success: true,
                message:
                    "Mute kaldırıldı."
            });

        } catch (error) {

            console.error(
                "UNMUTE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Sunucu hatası."
            });
        }
    }
);


// ======================================================
// SOCKET.IO AUTH
// ======================================================

io.use(async (socket, next) => {

    try {

        const token =
            socket.handshake.auth?.token;

        if (!token) {

            return next(
                new Error("AUTH_REQUIRED")
            );
        }

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        const result = await pool.query(
            `
            SELECT
                id,
                username,
                role,
                is_banned,
                is_muted
            FROM users
            WHERE id = $1
            `,
            [decoded.id]
        );

        if (result.rows.length === 0) {

            return next(
                new Error("USER_NOT_FOUND")
            );
        }

        const user =
            result.rows[0];

        if (user.is_banned) {

            return next(
                new Error("BANNED")
            );
        }

        socket.user = user;

        next();

    } catch (error) {

        console.error(
            "Socket authentication error:",
            error.message
        );

        next(
            new Error("INVALID_AUTH")
        );
    }
});


// ======================================================
// SOCKET.IO CHAT
// ======================================================

io.on(
    "connection",
    (socket) => {

        console.log(
            "Client connected:",
            socket.user.username,
            socket.id
        );

        socket.emit(
            "loginSuccess",
            {
                id: socket.user.id,
                username:
                    socket.user.username,
                role:
                    socket.user.role,
                isMuted:
                    socket.user.is_muted
            }
        );


        socket.on(
            "sendMessage",
            async (data) => {

                try {

                    if (
                        !data ||
                        typeof data.message !==
                        "string"
                    ) {
                        return;
                    }

                    const message =
                        data.message.trim();

                    if (!message) {
                        return;
                    }

                    // Mesaj boyutu sınırı
                    if (message.length > 2000) {

                        socket.emit(
                            "messageError",
                            {
                                message:
                                    "Mesaj çok uzun."
                            }
                        );

                        return;
                    }

                    const result =
                        await pool.query(
                            `
                            SELECT
                                username,
                                role,
                                is_banned,
                                is_muted
                            FROM users
                            WHERE id = $1
                            `,
                            [socket.user.id]
                        );

                    if (
                        result.rows.length === 0
                    ) {
                        return;
                    }

                    const user =
                        result.rows[0];

                    if (user.is_banned) {

                        socket.emit(
                            "accountBanned"
                        );

                        socket.disconnect(
                            true
                        );

                        return;
                    }

                    if (user.is_muted) {

                        socket.emit(
                            "accountMuted"
                        );

                        return;
                    }

                    io.emit(
                        "receiveMessage",
                        {
                            username:
                                user.username,
                            message,
                            time:
                                Date.now()
                        }
                    );

                } catch (error) {

                    console.error(
                        "SEND MESSAGE ERROR:",
                        error
                    );
                }
            }
        );


        socket.on(
            "disconnect",
            () => {

                console.log(
                    "Client disconnected:",
                    socket.user?.username,
                    socket.id
                );
            }
        );
    }
);


// ======================================================
// START SERVER
// ======================================================

async function startServer() {

    await testDatabase();

    server.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                `KChat Server running on port ${PORT}`
            );

        }
    );
}

startServer().catch(
    (error) => {

        console.error(
            "SERVER START ERROR:",
            error
        );

        process.exit(1);
    }
);
