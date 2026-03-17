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

const fs = require("fs");

// GET all items
app.get("/api/items", auth, async (req, res) => {
    try {
        const items = await Item.find();
        res.json(items);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// POST add new item
app.post("/api/items", auth, upload.single("image"), async (req, res) => {
    try {
        const _id = await getNextSequence("items");

        const item = new Item({
            _id,
            name: req.body.name,
            description: req.body.description,
            stock: Number(req.body.stock),
            price: Number(req.body.price),
            image: req.file ? `/uploads/${req.file.filename}` : ""
        });

        await item.save();
        res.json(item);

    } catch (err) {
        res.status(500).json({ message: "Add failed" });
    }
});

// PUT update existing item
app.put("/api/items/:id", auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price } = req.body;

        if (!name || !description || price === undefined || isNaN(price)) {
            return res.status(400).json({ message: "Invalid input" });
        }

        const updated = await Item.findOneAndUpdate(
            { _id: Number(id) },
            { name, description, price: Number(price) },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Item not found" });
        }

        res.json(updated);

    } catch (err) {
        res.status(500).json({ message: "Update failed" });
    }
});

// DELETE an item
app.delete("/api/items/:id", auth, async (req, res) => {
    try {
        const { id } = req.params;

        const deleted = await Item.findOneAndDelete({ _id: Number(id) });

        if (!deleted) {
            return res.status(404).json({ message: "Item not found" });
        }

        // delete image file if exists
        if (deleted.image && fs.existsSync(`.${deleted.image}`)) {
            fs.unlinkSync(`.${deleted.image}`);
        }

        res.json({ message: "Deleted" });

    } catch (err) {
        res.status(500).json({ message: "Delete failed" });
    }
});

/* =========================
   SALES API
========================= */
app.get("/api/sales", auth, async (req, res) => {
    res.json(await Sale.find().sort({ date: -1 }));
});

app.post("/api/sales", auth, async (req, res) => {
    const itemData = await Item.findById(req.body.item);

    if (!itemData) {
        return res.status(404).json({ message: "Item not found" });
    }

    if (itemData.stock < req.body.quantity) {
        return res.status(400).json({ message: "Not enough stock" });
    }

    itemData.stock -= req.body.quantity;
    await itemData.save();

    const total = itemData.price * req.body.quantity;

    const sale = new Sale({
        _id: await getNextSequence("sales"),
        item: itemData._id,
        itemName: itemData.name,
        quantity: req.body.quantity,
        price: itemData.price,
        total
    });

    await sale.save();
    res.json(sale);
});

app.delete("/api/sales/:id", auth, async (req, res) => {
    await Sale.findByIdAndDelete(Number(req.params.id));
    res.json({ message: "Deleted" });
});

/* =========================
   SUPPLIERS API
========================= */
app.get("/api/suppliers", auth, async (req, res) => {
    res.json(await Supplier.find());
});

app.post("/api/suppliers", auth, async (req, res) => {
    const supplier = new Supplier({
        _id: await getNextSequence("suppliers"),
        name: req.body.name,
        contact: req.body.contact
    });

    await supplier.save();
    res.json(supplier);
});

app.put("/api/suppliers/:id", auth, async (req, res) => {
    await Supplier.findByIdAndUpdate(Number(req.params.id), req.body);
    res.json({ message: "Updated" });
});

app.delete("/api/suppliers/:id", auth, async (req, res) => {
    await Supplier.findByIdAndDelete(Number(req.params.id));
    res.json({ message: "Deleted" });
});

/* =========================
   REPORTS API
========================= */
app.get("/api/reports", auth, async (req, res) => {
    res.json(await Report.find().sort({ date: -1 }));
});

app.post("/api/reports", auth, async (req, res) => {
    const report = new Report({
        _id: await getNextSequence("reports"),
        name: req.body.name
    });

    await report.save();
    res.json(report);
});

app.put("/api/reports/:id", auth, async (req, res) => {
    await Report.findByIdAndUpdate(Number(req.params.id), req.body);
    res.json({ message: "Updated" });
});

app.delete("/api/reports/:id", auth, async (req, res) => {
    await Report.findByIdAndDelete(Number(req.params.id));
    res.json({ message: "Deleted" });
});

/* =========================
   DASHBOARD API
========================= */
app.get("/api/dashboard", auth, async (req, res) => {
    const items = await Item.find();
    const sales = await Sale.find();

    res.json({
        totalItems: items.length,
        availableItems: items.filter(i => i.stock > 0).length,
        outOfStock: items.filter(i => i.stock <= 0).length,
        totalSales: sales.length,
        totalRevenue: sales.reduce((sum, s) => sum + (s.total || 0), 0)
    });
});



/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log("🚀 Server running on port " + PORT);
});