const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

const app = express();

/* ===============================
   Middleware
================================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

/* ===============================
   MongoDB Connection
================================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error:", err));

/* ===============================
   User Schema
================================= */
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

/* ===============================
   Routes
================================= */

// Serve login.html
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

/* ===== REGISTER ===== */
app.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ message: "All fields required" });

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser)
            return res.status(400).json({ message: "Username or Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });
        await newUser.save();

        res.json({ message: "Account created successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

/* ===== LOGIN ===== */
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: "Username and password required" });

        const user = await User.findOne({ username });
        if (!user) return res.status(401).json({ message: "Invalid credentials" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "Strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ message: "Login successful!", user: { username: user.username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

/* ===== LOGOUT ===== */
app.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out" });
});

/* ===============================
   Start Server
================================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));