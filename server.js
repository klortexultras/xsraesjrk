const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.get("/", (req, res) => {
    res.json({
        status: "online",
        server: "KChat Server"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "healthy"
    });
});

io.on("connection", (socket) => {

    console.log("Client connected:", socket.id);

    socket.on("sendMessage", (data) => {

        if (!data || !data.username || !data.message)
            return;

        io.emit("receiveMessage", {
            username: data.username,
            message: data.message,
            time: Date.now()
        });
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`KChat Server running on port ${PORT}`);
});