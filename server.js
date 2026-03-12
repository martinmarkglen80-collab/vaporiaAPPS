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
app.use("/uploads", express.static("uploads")); // serve uploaded images

/* =========================
   MONGODB CONNECTION
========================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error:", err));

/* =========================
   MULTER CONFIG FOR IMAGE UPLOAD
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
   SCHEMAS & MODELS
========================= */
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
}, { timestamps: true });
const User = mongoose.model("User", userSchema);

const itemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    stock: { type: Number, required: true },
    price: { type: Number, required: true },
    image: { type: String }
}, { timestamps: true });
const Item = mongoose.model("Item", itemSchema);

const supplierSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contact: { type: String }
}, { timestamps: true });
const Supplier = mongoose.model("Supplier", supplierSchema);

const saleSchema = new mongoose.Schema({
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    total: { type: Number, required: true },
    date: { type: Date, default: Date.now }
}, { timestamps: true });
const Sale = mongoose.model("Sale", saleSchema);

const reportSchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, default: Date.now }
}, { timestamps: true });
const Report = mongoose.model("Report", reportSchema);

/* =========================
   AUTH ROUTES
========================= */
app.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ message: "All fields required" });

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
        if (!username || !password) return res.status(400).json({ message: "Username and password required" });

        const user = await User.findOne({ username });
        if (!user) return res.status(401).json({ message: "Invalid credentials" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        if (!process.env.JWT_SECRET) return res.status(500).json({ message: "JWT secret not set" });

        const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV==="production", sameSite:"Strict", maxAge:7*24*60*60*1000 });
        res.json({ message: "Login successful!", user: { username: user.username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/logout", (req,res)=>{
    res.clearCookie("token");
    res.json({ message: "Logged out" });
});

/* =========================
   AUTH MIDDLEWARE
========================= */
const authMiddleware = (req,res,next)=>{
    const token = req.cookies.token;
    if(!token) return res.status(401).json({ message:"Unauthorized" });

    try{
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    }catch(err){
        res.status(401).json({ message:"Invalid token" });
    }
};

/* =========================
   ITEMS ROUTES
========================= */
app.get("/api/items", authMiddleware, async (req,res)=>{
    const items = await Item.find();
    res.json(items);
});

app.post("/api/items", authMiddleware, upload.single("image"), async (req,res)=>{
    const { name, description, stock, price } = req.body;
    const image = req.file ? "/uploads/"+req.file.filename : "";
    const item = new Item({ name, description, stock, price, image });
    await item.save();
    res.json({ message:"Item added" });
});

app.put("/api/items/:id", authMiddleware, upload.single("image"), async (req,res)=>{
    const { name, description, stock, price } = req.body;
    const item = await Item.findById(req.params.id);
    if(!item) return res.status(404).json({ message:"Item not found" });
    item.name=name;
    item.description=description;
    item.stock=stock;
    item.price=price;
    if(req.file) item.image="/uploads/"+req.file.filename;
    await item.save();
    res.json({ message:"Item updated" });
});

app.delete("/api/items/:id", authMiddleware, async (req,res)=>{
    const item = await Item.findByIdAndDelete(req.params.id);
    if(!item) return res.status(404).json({ message:"Item not found" });
    res.json({ message:"Item deleted" });
});

/* =========================
   SUPPLIERS ROUTES
========================= */
app.get("/api/suppliers", authMiddleware, async (req,res)=>{
    const suppliers = await Supplier.find();
    res.json(suppliers);
});

app.post("/api/suppliers", authMiddleware, async (req,res)=>{
    const { name, contact } = req.body;
    const supplier = new Supplier({ name, contact });
    await supplier.save();
    res.json({ message:"Supplier added" });
});

app.put("/api/suppliers/:id", authMiddleware, async (req,res)=>{
    const { name, contact } = req.body;
    const supplier = await Supplier.findById(req.params.id);
    if(!supplier) return res.status(404).json({ message:"Supplier not found" });
    supplier.name=name;
    supplier.contact=contact;
    await supplier.save();
    res.json({ message:"Supplier updated" });
});

app.delete("/api/suppliers/:id", authMiddleware, async (req,res)=>{
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if(!supplier) return res.status(404).json({ message:"Supplier not found" });
    res.json({ message:"Supplier deleted" });
});

/* =========================
   SALES ROUTES
========================= */
app.get("/api/sales", authMiddleware, async (req,res)=>{
    const sales = await Sale.find().populate("item");
    res.json(sales);
});

app.post("/api/sales", authMiddleware, async (req,res)=>{
    const { itemId, quantity } = req.body;
    const item = await Item.findById(itemId);
    if(!item) return res.status(404).json({ message:"Item not found" });

    if(quantity > item.stock) return res.status(400).json({ message:"Not enough stock" });

    const total = item.price * quantity;
    const sale = new Sale({ item:itemId, quantity, price:item.price, total });
    await sale.save();

    item.stock -= quantity;
    await item.save();

    res.json({ message:"Sale added" });
});

app.delete("/api/sales/:id", authMiddleware, async (req,res)=>{
    const sale = await Sale.findByIdAndDelete(req.params.id);
    if(!sale) return res.status(404).json({ message:"Sale not found" });
    res.json({ message:"Sale deleted" });
});

/* =========================
   REPORTS ROUTES
========================= */
app.get("/api/reports", authMiddleware, async (req,res)=>{
    const reports = await Report.find().sort({ date:-1 });
    res.json(reports);
});

app.post("/api/reports", authMiddleware, async (req,res)=>{
    const { name } = req.body;
    const report = new Report({ name });
    await report.save();
    res.json({ message:"Report added" });
});

app.put("/api/reports/:id", authMiddleware, async (req,res)=>{
    const { name } = req.body;
    const report = await Report.findById(req.params.id);
    if(!report) return res.status(404).json({ message:"Report not found" });
    report.name=name;
    await report.save();
    res.json({ message:"Report updated" });
});

app.delete("/api/reports/:id", authMiddleware, async (req,res)=>{
    const report = await Report.findByIdAndDelete(req.params.id);
    if(!report) return res.status(404).json({ message:"Report not found" });
    res.json({ message:"Report deleted" });
});

/* =========================
   DASHBOARD ROUTE
========================= */
app.get("/api/dashboard", authMiddleware, async (req,res)=>{
    const totalItems = await Item.countDocuments();
    const availableItems = await Item.countDocuments({ stock: { $gt: 0 } });
    const outOfStock = await Item.countDocuments({ stock: { $lte: 0 } });
    const totalSales = await Sale.countDocuments();
    const salesData = await Sale.find();
    let totalRevenue = 0;
    salesData.forEach(s=> totalRevenue += s.total);
    res.json({ totalItems, availableItems, outOfStock, totalSales, totalRevenue });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));