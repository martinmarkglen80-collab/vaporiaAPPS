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

// =========================
// NO CACHE MIDDLEWARE
// Prevent back button access to protected pages after logout
// =========================
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

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
    image: String,
    user: String
});

const supplierSchema = new mongoose.Schema({
    _id: Number,
    name: String,
    contact: String,
    user: String
});

const saleSchema = new mongoose.Schema({
    _id: Number,
    item: Number,
    itemName: String,
    quantity: Number,
    price: Number,
    total: Number,
    date: { type: Date, default: Date.now },
    user: String
});

const reportSchema = new mongoose.Schema({
    _id: Number,
    name: String,
    type: { type: String, default: "manual" }, // <-- THIS IS WHERE IT GOES
    date: { type: Date, default: Date.now },
    user: String
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

    if (!token) return res.status(401).json({ message: "Unauthorized" });

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

    await new User({ username, email, password: hashed }).save();
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
    const items = await Item.find({ user: req.user.id });
    res.json(items);
});

app.post("/api/items", auth, upload.single("image"), async (req, res) => {
    const _id = await getNextSequence("items");

    const item = new Item({
        _id,
        name: req.body.name,
        description: req.body.description,
        stock: Number(req.body.stock),
        price: Number(req.body.price),
        image: req.file ? `/uploads/${req.file.filename}` : "",
        user: req.user.id
    });

    await item.save();
    res.json(item);
});

app.put("/api/items/:id", auth, async (req, res) => {
    const updated = await Item.findOneAndUpdate(
        { _id: Number(req.params.id), user: req.user.id },
        req.body,
        { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Item not found" });

    res.json(updated);
});

app.delete("/api/items/:id", auth, async (req, res) => {
    const deleted = await Item.findOneAndDelete({
        _id: Number(req.params.id),
        user: req.user.id
    });

    if (!deleted) return res.status(404).json({ message: "Item not found" });

    if (deleted.image && fs.existsSync(`.${deleted.image}`)) {
        fs.unlinkSync(`.${deleted.image}`);
    }

    res.json({ message: "Deleted" });
});

/* =========================
   SALES API
========================= */
app.get("/api/sales", auth, async (req, res) => {
    res.json(await Sale.find({ user: req.user.id }).sort({ date: -1 }));
});

app.post("/api/sales", auth, async (req, res) => {
    const itemData = await Item.findOne({
        _id: Number(req.body.item),
        user: req.user.id
    });

    if (!itemData || itemData.stock < req.body.quantity) {
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
        total,
        user: req.user.id
    });

    await sale.save();
    res.json(sale);
});

app.delete("/api/sales/:id", auth, async (req, res) => {
    await Sale.findOneAndDelete({
        _id: Number(req.params.id),
        user: req.user.id
    });

    res.json({ message: "Deleted" });
});
// =========================
// REFUND SALE (NO STOCK RETURN)
// =========================
app.post("/api/sales/refund/:id", auth, async (req, res) => {
    try {
        const { id } = req.params;

        // Find the sale
        const sale = await Sale.findOne({
            _id: Number(id),
            user: req.user.id
        });

        if (!sale) {
            return res.status(404).json({ message: "Sale not found" });
        }

        // Create refund report log
        const reportId = await getNextSequence("reports");

        const report = new Report({
            _id: reportId,
            name: `Refunded: ${sale.itemName} (Qty: ${sale.quantity})`,
            type: "refund", // IMPORTANT
            user: req.user.id
        });

        await report.save();

        // Delete sale record
        await Sale.findOneAndDelete({
            _id: Number(id),
            user: req.user.id
        });

        res.json({ message: "Refund successful (no stock returned)" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Refund failed" });
    }
});

/* =========================
   SUPPLIERS API
========================= */
app.get("/api/suppliers", auth, async (req, res) => {
    res.json(await Supplier.find({ user: req.user.id }));
});

app.post("/api/suppliers", auth, async (req, res) => {
    const supplier = new Supplier({
        _id: await getNextSequence("suppliers"),
        name: req.body.name,
        contact: req.body.contact,
        user: req.user.id
    });

    await supplier.save();
    res.json(supplier);
});

app.put("/api/suppliers/:id", auth, async (req, res) => {
    await Supplier.findOneAndUpdate(
        { _id: Number(req.params.id), user: req.user.id },
        req.body
    );

    res.json({ message: "Updated" });
});

app.delete("/api/suppliers/:id", auth, async (req, res) => {
    await Supplier.findOneAndDelete({
        _id: Number(req.params.id),
        user: req.user.id
    });

    res.json({ message: "Deleted" });
});
/* =========================
   REPORTS API
========================= */
app.get("/api/reports", auth, async (req, res) => {
    res.json(await Report.find({ user: req.user.id }).sort({ date: -1 }));
});

app.post("/api/reports", auth, async (req, res) => {
    try {
        const reportId = await getNextSequence("reports");

        const report = new Report({
            _id: reportId,
            name: req.body.name,       // <- use frontend input
            type: "manual",            // <- mark manual reports
            user: req.user.id
        });

        await report.save();
        res.json(report);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to add report" });
    }
});

app.put("/api/reports/:id", auth, async (req, res) => {
    await Report.findOneAndUpdate(
        { _id: Number(req.params.id), user: req.user.id },
        req.body
    );

    res.json({ message: "Updated" });
});

app.delete("/api/reports/:id", auth, async (req, res) => {
    await Report.findOneAndDelete({
        _id: Number(req.params.id),
        user: req.user.id
    });

    res.json({ message: "Deleted" });
});

/* =========================
   DASHBOARD API
========================= */
app.get("/api/dashboard", auth, async (req, res) => {
    const items = await Item.find({ user: req.user.id });
    const sales = await Sale.find({ user: req.user.id });

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