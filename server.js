const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

/* ===============================
   Middleware
================================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from root folder
app.use(express.static(__dirname));

/* ===============================
   MongoDB Connection
================================= */
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.log("❌ MongoDB Error:", err));

/* ===============================
   User Schema
================================= */
const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    }
});

const User = mongoose.model("User", userSchema);

/* ===============================
   Routes
================================= */

// Load index.html
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

/* ===== REGISTER ===== */
app.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Check if username or email already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            return res.status(400).json({
                message: "Username or Email already exists"
            });
        }

        const newUser = new User({
            username,
            email,
            password
        });

        await newUser.save();

        res.json({ message: "Account created successfully!" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

/* ===== LOGIN ===== */
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username, password });

        if (!user) {
            return res.status(401).json({
                message: "Invalid credentials"
            });
        }

        res.json({ message: "Login successful!" });

    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});

/* ===============================
   Start Server
================================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});
