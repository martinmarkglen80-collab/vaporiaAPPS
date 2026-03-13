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
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

/* =========================
   SCHEMAS
========================= */
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String
},{ timestamps: true });

const itemSchema = new mongoose.Schema({
  numericId: Number,
  name: String,
  description: String,
  stock: Number,
  price: Number,
  image: String
},{ timestamps: true });

const supplierSchema = new mongoose.Schema({
  numericId: Number,
  name: String,
  contact: String
},{ timestamps: true });

const saleSchema = new mongoose.Schema({
  numericId: Number,
  itemId: Number,
  itemName: String,
  quantity: Number,
  price: Number,
  total: Number,
  date: { type: Date, default: Date.now }
},{ timestamps: true });

const reportSchema = new mongoose.Schema({
  numericId: Number,
  name: String,
  date: { type: Date, default: Date.now }
},{ timestamps: true });

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
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ message: "User exists" });
  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, email, password: hashed });
  await user.save();
  res.json({ message: "Account created" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ message: "Invalid login" });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: "Invalid login" });
  const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 7*24*60*60*1000 });
  res.json({ message: "Login successful" });
});

app.post("/logout", (req,res)=>{
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

/* =========================
   DASHBOARD
========================= */
app.get("/api/dashboard", auth, async (req,res)=>{
  const totalItems = await Item.countDocuments();
  const availableItems = await Item.countDocuments({ stock: { $gt: 0 } });
  const outOfStock = await Item.countDocuments({ stock: { $lte: 0 } });
  const totalSales = await Sale.countDocuments();
  const totalRevenueAgg = await Sale.aggregate([{ $group: { _id: null, total: { $sum: "$total" } } }]);
  const totalRevenue = totalRevenueAgg[0]?.total || 0;
  res.json({ totalItems, availableItems, outOfStock, totalSales, totalRevenue });
});

/* =========================
   ITEMS API
========================= */
app.get("/api/items", auth, async (req,res)=> res.json(await Item.find()));

app.post("/api/items", auth, upload.single("image"), async (req,res)=>{
  const { name, description, stock, price } = req.body;
  const lastItem = await Item.findOne().sort({ numericId: -1 });
  const numericId = lastItem ? lastItem.numericId + 1 : 1;
  const image = req.file ? `/uploads/${req.file.filename}` : "";
  const item = new Item({ numericId, name, description, stock, price, image });
  await item.save();
  res.json(item);
});

app.put("/api/items/:id", auth, upload.single("image"), async (req,res)=>{
  const item = await Item.findOne({ numericId: req.params.id });
  if(!item) return res.status(404).send("Item not found");
  const { name, description, stock, price } = req.body;
  if(name !== undefined) item.name = name;
  if(description !== undefined) item.description = description;
  if(stock !== undefined) item.stock = stock;
  if(price !== undefined) item.price = price;
  if(req.file) item.image = `/uploads/${req.file.filename}`;
  await item.save();
  res.json(item);
});

app.delete("/api/items/:id", auth, async (req,res)=>{
  await Item.deleteOne({ numericId: req.params.id });
  res.sendStatus(204);
});

/* =========================
   SALES API
========================= */
app.get("/api/sales", auth, async (req,res)=> res.json(await Sale.find()));

app.post("/api/sales", auth, async (req,res)=>{
  const { itemId, quantity, price } = req.body;
  const item = await Item.findOne({ numericId: itemId });
  if(!item) return res.status(404).send("Item not found");
  if(item.stock < quantity) return res.status(400).send("Insufficient stock");
  item.stock -= quantity;
  await item.save();
  const lastSale = await Sale.findOne().sort({ numericId: -1 });
  const numericId = lastSale ? lastSale.numericId + 1 : 1;
  const total = quantity * price;
  const sale = new Sale({ numericId, itemId, itemName: item.name, quantity, price, total });
  await sale.save();
  res.json(sale);
});

app.delete("/api/sales/:id", auth, async (req,res)=>{
  await Sale.deleteOne({ numericId: req.params.id });
  res.sendStatus(204);
});

/* =========================
   REPORTS API
========================= */
app.get("/api/reports", auth, async (req,res)=> res.json(await Report.find()));

app.post("/api/reports", auth, async (req,res)=>{
  const { name } = req.body;
  const last = await Report.findOne().sort({ numericId: -1 });
  const numericId = last ? last.numericId + 1 : 1;
  const report = new Report({ numericId, name });
  await report.save();
  res.json(report);
});

app.put("/api/reports/:id", auth, async (req,res)=>{
  const report = await Report.findOne({ numericId: req.params.id });
  if(!report) return res.status(404).send("Report not found");
  report.name = req.body.name ?? report.name;
  await report.save();
  res.json(report);
});

app.delete("/api/reports/:id", auth, async (req,res)=>{
  await Report.deleteOne({ numericId: req.params.id });
  res.sendStatus(204);
});

/* =========================
   SUPPLIERS API
========================= */
app.get("/api/suppliers", auth, async (req,res)=> res.json(await Supplier.find()));

app.post("/api/suppliers", auth, async (req,res)=>{
  const { name, contact } = req.body;
  const last = await Supplier.findOne().sort({ numericId: -1 });
  const numericId = last ? last.numericId + 1 : 1;
  const supplier = new Supplier({ numericId, name, contact });
  await supplier.save();
  res.json(supplier);
});

app.put("/api/suppliers/:id", auth, async (req,res)=>{
  const s = await Supplier.findOne({ numericId: req.params.id });
  if(!s) return res.status(404).send("Supplier not found");
  s.name = req.body.name ?? s.name;
  s.contact = req.body.contact ?? s.contact;
  await s.save();
  res.json(s);
});

app.delete("/api/suppliers/:id", auth, async (req,res)=>{
  await Supplier.deleteOne({ numericId: req.params.id });
  res.sendStatus(204);
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));