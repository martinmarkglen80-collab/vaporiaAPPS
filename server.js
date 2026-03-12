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
   MIDDLEWARE
========================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));
app.use("/uploads", express.static("uploads")); // Serve uploaded images

/* =========================
   MONGODB CONNECTION
========================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Error:", err));

/* =========================
   MULTER CONFIG FOR IMAGE UPLOADS
========================= */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = "./uploads";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

/* =========================
   SCHEMAS & MODELS
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

const saleSchema = new mongoose.Schema({
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    quantity: { type: Number, required: true },
    total: { type: Number, required: true },
    date: { type: Date, default: Date.now }
});
const Sale = mongoose.model("Sale", saleSchema);

const supplierSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contact: { type: String }
});
const Supplier = mongoose.model("Supplier", supplierSchema);

const reportSchema = new mongoose.Schema({ name: { type: String, required: true } }, { timestamps: true });
const Report = mongoose.model("Report", reportSchema);

/* =========================
   AUTH ROUTES
========================= */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

app.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ message: "All fields required" });

        const existing = await User.findOne({ $or: [{ username }, { email }] });
        if (existing) return res.status(400).json({ message: "Username or Email exists" });

        const hashed = await bcrypt.hash(password, 10);
        await new User({ username, email, password: hashed }).save();

        res.json({ message: "Account created successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: "Username and password required" });

        const user = await User.findOne({ username });
        if (!user) return res.status(401).json({ message: "Invalid credentials" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        if (!process.env.JWT_SECRET) return res.status(500).json({ message: "JWT secret not set" });

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

app.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out" });
});

/* =========================
   DASHBOARD ROUTE
========================= */
app.get("/api/dashboard", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        const totalItems = await Item.countDocuments();
        const availableItems = await Item.countDocuments({ stock: { $gt: 0 } });
        const outOfStock = await Item.countDocuments({ stock: { $lte: 0 } });
        const totalSales = await Sale.countDocuments();
        const salesData = await Sale.find();
        let totalRevenue = 0;
        salesData.forEach(s => totalRevenue += s.total);

        res.json({ totalItems, availableItems, outOfStock, totalSales, totalRevenue });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

/* =========================
   ITEMS ROUTES
========================= */
app.get("/api/items", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        const items = await Item.find();
        res.json(items);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/api/items", upload.single("image"), async (req, res) => {
    try {
        const { name, description, stock, price } = req.body;
        const image = req.file ? `/uploads/${req.file.filename}` : "";
        const item = new Item({ name, description, stock, price, image });
        await item.save();
        res.json({ message: "Item added" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

app.put("/api/items/:id", upload.single("image"), async (req, res) => {
    try {
        const { name, description, stock, price } = req.body;
        const updateData = { name, description, stock, price };
        if (req.file) updateData.image = `/uploads/${req.file.filename}`;
        await Item.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ message: "Item updated" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

app.delete("/api/items/:id", async (req, res) => {
    try {
        await Item.findByIdAndDelete(req.params.id);
        res.json({ message: "Item deleted" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

/* =========================
   SALES ROUTES
========================= */
app.get("/api/sales", async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) return res.status(401).json({ message: "Unauthorized" });

        jwt.verify(token, process.env.JWT_SECRET);
        const sales = await Sale.find().populate("item");
        res.json(sales);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/api/sales", async (req, res) => {
    try {
        const { itemId, quantity } = req.body;
        const item = await Item.findById(itemId);
        if (!item) return res.status(400).json({ message: "Item not found" });

        const total = item.price * quantity;
        const sale = new Sale({ item: itemId, quantity, total });
        await sale.save();

        item.stock -= quantity;
        await item.save();

        res.json({ message: "Sale recorded" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

/* =========================
   SUPPLIERS ROUTES
========================= */
app.get("/api/suppliers", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    jwt.verify(token, process.env.JWT_SECRET);
    const suppliers = await Supplier.find();
    res.json(suppliers);
});

app.post("/api/suppliers", async (req, res) => {
    const { name, contact } = req.body;
    const supplier = new Supplier({ name, contact });
    await supplier.save();
    res.json({ message: "Supplier added" });
});

app.put("/api/suppliers/:id", async (req, res) => {
    const { name, contact } = req.body;
    await Supplier.findByIdAndUpdate(req.params.id, { name, contact });
    res.json({ message: "Supplier updated" });
});

app.delete("/api/suppliers/:id", async (req, res) => {
    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ message: "Supplier deleted" });
});

/* =========================
   REPORTS ROUTES
========================= */
app.get("/api/reports", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    jwt.verify(token, process.env.JWT_SECRET);
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
});

app.post("/api/reports", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Report name required" });

    const report = new Report({ name });
    await report.save();
    res.json({ message: "Report added" });
});

app.put("/api/reports/:id", async (req, res) => {
    const { name } = req.body;
    await Report.findByIdAndUpdate(req.params.id, { name });
    res.json({ message: "Report updated" });
});

app.delete("/api/reports/:id", async (req, res) => {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: "Report deleted" });
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));