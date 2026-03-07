const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

app.use(cors({
    origin: "http://localhost:3000",
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.log("❌ MongoDB Error:", err));

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

const JWT_SECRET = process.env.JWT_SECRET || "secret123";

function authMiddleware(req, res, next) {

    const token =
        req.cookies.token ||
        req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }

}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/register", async (req, res) => {

    try {

        const { username, email, password } = req.body;

        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            return res
            .status(400)
            .json({ message: "Username or Email already exists" });
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

app.post("/login", async (req, res) => {

    try {

        const { username, password } = req.body;

        const user = await User.findOne({
            username,
            password
        });

        if (!user) {
            return res
            .status(401)
            .json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "Strict",
            path: "/"
        });

        res.json({
            message: "Login successful!",
            user: { username: user.username },
            token
        });

    } catch (error) {

        res.status(500).json({ message: "Server error" });

    }

});

app.get("/api/dashboard", authMiddleware, (req, res) => {

    res.json({
        totalItems: 120,
        availableItems: 95,
        outOfStock: 25,
        totalSales: 78,
        totalRevenue: 12500
    });

});

app.post("/api/logout", (req, res) => {

    try {

        res.clearCookie("token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "Strict",
            path: "/"
        });

        res.json({ message: "Logged out successfully" });

    } catch (err) {

        console.error(err);
        res.status(500).json({ message: "Logout failed" });

    }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
    console.log(`🔥 Server running on port ${PORT}`)
);