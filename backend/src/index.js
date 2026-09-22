require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const quizRoutes = require("./routes/quiz");
const roomRoutes = require("./routes/room");
const socketAuth = require("./middleware/socketAuth");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const registerQuizSocket = require("./sockets/quizSocket");

const app = express();

// Frontend origin - kept in one env var so it's easy to change for production
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/* ================= MIDDLEWARE ================= */
// credentials: true is required so the browser will send/receive the
// HttpOnly accessToken cookie on cross-origin requests from Next.js.
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

/* ================= ROUTES ================= */
app.use("/api/auth", authRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/rooms", roomRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use(notFoundHandler);
app.use(errorHandler);

/* ================= SERVER + SOCKET.IO ================= */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true, // needed so the browser attaches the accessToken cookie
  },
});

io.use(socketAuth);
registerQuizSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("Server running on port", PORT));
