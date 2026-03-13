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
   MULTER IMAGE UPLOAD
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

/* =========================
   SCHEMAS
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
    { upsert: true, new: true }
  );
  return doc.seq;
}

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String
});

const itemSchema = new mongoose.Schema({
  _id: Number,
  name: String,
  description: String,
  stock: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  image: String
});

const supplierSchema = new mongoose.Schema({
  _id: Number,
  name: String,
  contact: String
});

const saleSchema = new mongoose.Schema({
  _id: Number,
  item: { type: Number, ref: "Item" },
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
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid Token" });
  }
}

/* =========================
   AUTH ROUTES
========================= */
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (await User.findOne({ username })) return res.status(400).json({ message: "User exists" });
  const hashed = await bcrypt.hash(password, 10);
  await new User({ username, email, password: hashed }).save();
  res.json({ message: "Account created" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ message: "Invalid login" });

  const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 7*24*60*60*1000 });
  res.json({ message: "Login successful" });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

/* =========================
   ITEMS API
========================= */
app.get("/api/items", auth, async (req, res) => {
  const items = await Item.find();
  res.json(items);
});

app.post("/api/items", auth, upload.single("image"), async (req, res) => {
  const { name, description, stock, price } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : "";
  const _id = await getNextSequence("items");
  const item = new Item({ _id, name, description, stock, price, image });
  await item.save();
  res.json(item);
});

app.put("/api/items/:id", auth, upload.single("image"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, stock, price } = req.body;
  const update = { name, description, stock, price };
  if (req.file) update.image = `/uploads/${req.file.filename}`;

  const item = await Item.findByIdAndUpdate(id, update, { new: true });
  if (!item) return res.status(404).json({ message: "Item not found" });
  res.json(item);
});

app.delete("/api/items/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const item = await Item.findByIdAndDelete(id);
  if (!item) return res.status(404).json({ message: "Item not found" });
  res.json({ message: "Item deleted" });
});

/* =========================
   SALES API
========================= */
app.get("/api/sales", auth, async (req, res) => {
  const sales = await Sale.find();
  res.json(sales);
});

app.post("/api/sales", auth, async (req, res) => {
  const { item: itemId, quantity } = req.body;
  const id = Number(itemId);
  const item = await Item.findById(id);
  if (!item) return res.status(400).json({ message: "Item not found" });
  if (item.stock < quantity) return res.status(400).json({ message: "Insufficient stock" });

  const total = quantity * item.price; // use item.price for consistency
  item.stock -= quantity;
  await item.save();

  const _id = await getNextSequence("sales");
  const sale = new Sale({ _id, item: item._id, itemName: item.name, quantity, price: item.price, total });
  await sale.save();

  res.json(sale);
});

app.delete("/api/sales/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const sale = await Sale.findById(id);
  if (!sale) return res.status(404).json({ message: "Sale not found" });

  const item = await Item.findById(sale.item);
  if (item) {
    item.stock += sale.quantity; // revert stock
    await item.save();
  }

  await Sale.findByIdAndDelete(id);
  res.json({ message: "Sale deleted" });
});

/* =========================
   SUPPLIERS API
========================= */
app.get("/api/suppliers", auth, async (req, res) => {
  const suppliers = await Supplier.find();
  res.json(suppliers);
});

app.post("/api/suppliers", auth, async (req, res) => {
  const { name, contact } = req.body;
  const _id = await getNextSequence("suppliers");
  const supplier = new Supplier({ _id, name, contact });
  await supplier.save();
  res.json(supplier);
});

app.put("/api/suppliers/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, contact } = req.body;
  const supplier = await Supplier.findByIdAndUpdate(id, { name, contact }, { new: true });
  if (!supplier) return res.status(404).json({ message: "Supplier not found" });
  res.json(supplier);
});

app.delete("/api/suppliers/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const supplier = await Supplier.findByIdAndDelete(id);
  if (!supplier) return res.status(404).json({ message: "Supplier not found" });
  res.json({ message: "Supplier deleted" });
});

/* =========================
   REPORTS API
========================= */
app.get("/api/reports", auth, async (req, res) => {
  const reports = await Report.find();
  res.json(reports);
});

app.post("/api/reports", auth, async (req, res) => {
  const { name } = req.body;
  const _id = await getNextSequence("reports");
  const report = new Report({ _id, name });
  await report.save();
  res.json(report);
});

app.put("/api/reports/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  const report = await Report.findByIdAndUpdate(id, { name }, { new: true });
  if (!report) return res.status(404).json({ message: "Report not found" });
  res.json(report);
});

app.delete("/api/reports/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const report = await Report.findByIdAndDelete(id);
  if (!report) return res.status(404).json({ message: "Report not found" });
  res.json({ message: "Report deleted" });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));