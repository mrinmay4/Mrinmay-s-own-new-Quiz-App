const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const signupSchema = z.object({
  email: z.string().trim().email(),
  username: z.string().trim().min(3),
  password: z.string().min(6),
});

const signinSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const JWT_EXPIRY = "15m";
const COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 minutes - matches JWT expiry

// Shared cookie options so login/signup/logout all stay in sync
function getCookieOptions() {
  return {
    httpOnly: true, // not readable by frontend JS - mitigates XSS token theft
    secure: process.env.NODE_ENV === "production", // HTTPS only in prod
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
  };
}

function issueAuthCookie(res, userId) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
  res.cookie("accessToken", token, getCookieOptions());
}

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, username: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Fetch current user error:", err.message);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const data = signupSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        password: hashedPassword,
      },
    });

    issueAuthCookie(res, user.id);

    res.json({
      message: "Account created successfully",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Invalid input", details: err.issues });
    }
    console.error("Signup error:", err.message);
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.post("/signin", async (req, res) => {
  try {
    const { email, password } = signinSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    issueAuthCookie(res, user.id);

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Invalid input", details: err.issues });
    }
    console.error("Signin error:", err.message);
    res.status(500).json({ error: "Failed to sign in" });
  }
});

router.post("/logout", (req, res) => {
  // Must pass the same attributes used when setting the cookie, or some
  // browsers won't clear it.
  res.clearCookie("accessToken", getCookieOptions());
  res.json({ message: "Logged out successfully" });
});

module.exports = router;
