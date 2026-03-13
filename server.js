const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

/* =========================
   MONGODB CONNECTION
========================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error:", err));

/* =========================
   SCHEMAS & MODELS
========================= */
const supplierSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contact: String
}, { timestamps: true });
const Supplier = mongoose.model("Supplier", supplierSchema);

const reportSchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, default: Date.now }
}, { timestamps: true });
const Report = mongoose.model("Report", reportSchema);

const itemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    stock: { type: Number, required: true },
    price: { type: Number, required: true },
}, { timestamps: true });
const Item = mongoose.model("Item", itemSchema);

const saleSchema = new mongoose.Schema({
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    total: { type: Number, required: true },
    date: { type: Date, default: Date.now }
}, { timestamps: true });
const Sale = mongoose.model("Sale", saleSchema);

/* =========================
   API ROUTES
========================= */

/* --- Suppliers --- */
app.get("/api/suppliers", async (req, res) => {
    const suppliers = await Supplier.find();
    res.json(suppliers);
});

app.post("/api/suppliers", async (req, res) => {
    const { name, contact } = req.body;
    if (!name) return res.status(400).json({ message: "Supplier name required" });
    const supplier = new Supplier({ name, contact });
    await supplier.save();
    res.json(supplier);
});

app.put("/api/suppliers/:id", async (req, res) => {
    const { name, contact } = req.body;
    const updated = await Supplier.findByIdAndUpdate(req.params.id, { name, contact }, { new: true });
    res.json(updated);
});

app.delete("/api/suppliers/:id", async (req, res) => {
    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

/* --- Reports --- */
app.get("/api/reports", async (req, res) => {
    const reports = await Report.find().sort({ date: -1 });
    res.json(reports);
});

app.post("/api/reports", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Report name required" });
    const report = new Report({ name });
    await report.save();
    res.json(report);
});

app.put("/api/reports/:id", async (req, res) => {
    const { name } = req.body;
    const updated = await Report.findByIdAndUpdate(req.params.id, { name }, { new: true });
    res.json(updated);
});

app.delete("/api/reports/:id", async (req, res) => {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

/* --- Items --- */
app.get("/api/items", async (req, res) => {
    const items = await Item.find();
    res.json(items);
});

app.post("/api/items", async (req, res) => {
    const { name, stock, price } = req.body;
    if (!name || stock == null || price == null) return res.status(400).json({ message: "All fields required" });
    const item = new Item({ name, stock: Number(stock), price: Number(price) });
    await item.save();
    res.json(item);
});

app.put("/api/items/:id", async (req, res) => {
    const { name, stock, price } = req.body;
    const updated = await Item.findByIdAndUpdate(req.params.id, { name, stock: Number(stock), price: Number(price) }, { new: true });
    res.json(updated);
});

app.delete("/api/items/:id", async (req, res) => {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

/* --- Sales --- */
app.get("/api/sales", async (req, res) => {
    const sales = await Sale.find().populate("item");
    const formatted = sales.map(s => ({
        _id: s._id,
        itemName: s.item.name,
        price: s.price,
        quantity: s.quantity,
        total: s.total,
        date: s.date
    }));
    res.json(formatted);
});

app.post("/api/sales", async (req, res) => {
    const { itemId, quantity, price } = req.body;
    if (!itemId || quantity == null || price == null) return res.status(400).json({ message: "All fields required" });
    const total = Number(quantity) * Number(price);
    const sale = new Sale({ item: itemId, quantity: Number(quantity), price: Number(price), total });
    await sale.save();
    res.json(sale);
});

app.delete("/api/sales/:id", async (req, res) => {
    await Sale.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

/* =========================
   SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));