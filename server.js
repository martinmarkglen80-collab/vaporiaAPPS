/* =========================
   IMPORTS
========================= */
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
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
app.use("/uploads", express.static("uploads"));

/* =========================
   MONGODB CONNECTION
========================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error:", err));

/* =========================
   MULTER (IMAGE UPLOAD)
========================= */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = "./uploads";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

/* =========================
   COUNTER (NUMERIC IDs)
========================= */
const counterSchema = new mongoose.Schema({
    _id: String,
    seq: Number
});

const Counter = mongoose.model("Counter", counterSchema);

async function getNextSequence(name) {
    const doc = await Counter.findByIdAndUpdate(
        name,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return doc.seq;
}

/* =========================
   SCHEMAS
========================= */
const userSchema = new mongoose.Schema({
    username: String,
    email: String,
    password: String
});

const itemSchema = new mongoose.Schema({
    _id: Number,
    name: String,
    description: String,
    stock: Number,
    price: Number,
    image: String
});

const supplierSchema = new mongoose.Schema({
    _id: Number,
    name: String,
    contact: String
});

const saleSchema = new mongoose.Schema({
    _id: Number,
    item: Number,
    itemName: String,
    quantity: Number,
    price: Number,
    total: Number,
    date: { type: Date, default: Date.now }
});

const reportSchema = new mongoose.Schema({
    _id: Number,
    name: String,
    date: { type: Date, default: Date.now }
});

/* =========================
   MODELS
========================= */
const User = mongoose.model("User", userSchema);
const Item = mongoose.model("Item", itemSchema);
const Supplier = mongoose.model("Supplier", supplierSchema);
const Sale = mongoose.model("Sale", saleSchema);
const Report = mongoose.model("Report", reportSchema);

/* =========================
   AUTH MIDDLEWARE
========================= */
function auth(req, res, next) {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ message: "Invalid token" });
    }
}

/* =========================
   AUTH ROUTES
========================= */
app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;

    if (await User.findOne({ username })) {
        return res.status(400).json({ message: "User exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await new User({
        username,
        email,
        password: hashed
    }).save();

    res.json({ message: "Registered" });
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ message: "Invalid login" });
    }

    const token = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax"
    });

    res.json({ message: "Logged in" });
});

app.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out" });
});

/* =========================
   ITEMS API
========================= */
app.get("/api/items", auth, async (req, res) => {
    res.json(await Item.find());
});

app.post("/api/items", auth, upload.single("image"), async (req, res) => {
    const _id = await getNextSequence("items");

    const item = new Item({
        _id,
        name: req.body.name,
        description: req.body.description,
        stock: Number(req.body.stock),
        price: Number(req.body.price),
        image: req.file ? `/uploads/${req.file.filename}` : null
    });

    await item.save();
    res.json(item);
});

app.put("/api/items/:id", auth, upload.single("image"), async (req, res) => {
    const updates = {
        name: req.body.name,
        description: req.body.description,
        price: Number(req.body.price)
        // stock is intentionally not included
    };

    if (req.file) {
        updates.image = `/uploads/${req.file.filename}`;
    }

    const updatedItem = await Item.findByIdAndUpdate(
        req.params.id,
        updates,
        { new: true }
    );

    if (!updatedItem) {
        return res.status(404).json({ message: "Item not found" });
    }

    res.json(updatedItem);
});

app.delete("/api/items/:id", auth, async (req, res) => {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);

    if (!deletedItem) {
        return res.status(404).json({ message: "Item not found" });
    }

    res.json({ message: "Deleted" });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});