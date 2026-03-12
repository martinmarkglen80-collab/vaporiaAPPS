const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();

/* =========================
   Middleware
========================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));
app.use("/uploads", express.static("uploads")); // serve uploaded images

/* =========================
   MongoDB Connection
========================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error:", err));

/* =========================
   Multer Config for Images
========================= */
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = "./uploads";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});
const upload = multer({ storage });

/* =========================
   Schemas & Models
========================= */
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model("User", userSchema);

const itemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    stock: { type: Number, required: true },
    price: { type: Number, default: 0 },
    image: { type: String }
});
const Item = mongoose.model("Item", itemSchema);

/* =========================
   Routes
========================= */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

/* ===== REGISTER ===== */
app.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ message: "All fields required" });

        const existing = await User.findOne({ $or: [{ username }, { email }] });
        if (existing)
            return res.status(400).json({ message: "Username or Email exists" });

        const hashed = await bcrypt.hash(password, 10);
        await new User({ username, email, password: hashed }).save();
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

        if (!process.env.JWT_SECRET)
            return res.status(500).json({ message: "JWT secret not set" });

        const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });
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

/* ===== DASHBOARD ===== */
app.get("/api/dashboard", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        const totalItems = await Item.countDocuments();
        const availableItems = await Item.countDocuments({ stock: { $gt: 0 } });
        const outOfStock = await Item.countDocuments({ stock: { $lte: 0 } });
        const items = await Item.find();

        let totalStock = 0, totalRevenue = 0, totalSales = 0;
        items.forEach(item => {
            totalStock += item.stock;
            totalRevenue += (item.stock * item.price);
            // totalSales can be tracked if you add a sales model
        });

        res.json({
            totalItems,
            availableItems,
            outOfStock,
            totalStock,
            totalRevenue,
            totalSales
        });
    } catch (err) {
        console.error(err);
        res.status(401).json({ message: "Unauthorized" });
    }
});

/* ===== ITEMS API ===== */
// Get all items
app.get("/api/items", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        const items = await Item.find();
        res.json(items);
    } catch (err) {
        res.status(401).json({ message: "Unauthorized" });
    }
});

// Add new item
app.post("/api/items", upload.single("image"), async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        const { name, description, stock, price } = req.body;
        let imagePath = req.file ? "/uploads/" + req.file.filename : "";

        const newItem = new Item({ name, description, stock, price, image: imagePath });
        await newItem.save();
        res.json({ message: "Item added" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// Update item
app.put("/api/items/:id", upload.single("image"), async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ message: "Item not found" });

        const { name, description, stock, price } = req.body;
        if (name) item.name = name;
        if (description) item.description = description;
        if (stock) item.stock = stock;
        if (price) item.price = price;
        if (req.file) item.image = "/uploads/" + req.file.filename;

        await item.save();
        res.json({ message: "Item updated" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// Delete item
app.delete("/api/items/:id", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        await Item.findByIdAndDelete(req.params.id);
        res.json({ message: "Item deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));