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
  name: String,
  description: String,
  stock: Number,
  price: Number,
  image: String
},{ timestamps: true });

const supplierSchema = new mongoose.Schema({
  name: String,
  contact: String
},{ timestamps: true });

const saleSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },
  quantity: Number,
  price: Number,
  total: Number,
  date: { type: Date, default: Date.now }
},{ timestamps: true });

const reportSchema = new mongoose.Schema({
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

  const user = new User({
    username,
    email,
    password: hashed
  });

  await user.save();

  res.json({ message: "Account created" });

});

app.post("/login", async (req, res) => {

  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ message: "Invalid login" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: "Invalid login" });

  const token = jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

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

  const item = new Item({
    name,
    description,
    stock,
    price,
    image
  });

  await item.save();

  res.json(item);

});

app.put("/api/items/:id", auth, upload.single("image"), async (req, res) => {

  const { name, description, stock, price } = req.body;

  const update = { name, description, stock, price };

  if (req.file) update.image = `/uploads/${req.file.filename}`;

  const item = await Item.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  );

  res.json(item);

});

app.delete("/api/items/:id", auth, async (req, res) => {

  await Item.findByIdAndDelete(req.params.id);

  res.json({ message: "Item deleted" });

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

  const supplier = new Supplier({ name, contact });

  await supplier.save();

  res.json(supplier);

});

app.put("/api/suppliers/:id", auth, async (req, res) => {

  const { name, contact } = req.body;

  const supplier = await Supplier.findByIdAndUpdate(
    req.params.id,
    { name, contact },
    { new: true }
  );

  res.json(supplier);

});

app.delete("/api/suppliers/:id", auth, async (req, res) => {

  await Supplier.findByIdAndDelete(req.params.id);

  res.json({ message: "Supplier deleted" });

});

/* =========================
   SALES API
========================= */

// Get all sales
app.get("/api/sales", auth, async (req, res) => {
  const sales = await Sale.find().populate("item", "name price");
  // Map sales to include item name for frontend
  const formatted = sales.map(s => ({
    _id: s._id,
    itemId: s.item._id,
    itemName: s.item.name,
    price: s.price,
    quantity: s.quantity,
    total: s.total,
    date: s.date
  }));
  res.json(formatted);
});

// Add new sale and deduct item stock
app.post("/api/sales", auth, async (req, res) => {
  const { itemId, quantity, price } = req.body;

  if (!itemId || !quantity || !price)
    return res.status(400).json({ message: "All fields required" });

  const item = await Item.findById(itemId);
  if (!item) return res.status(404).json({ message: "Item not found" });

  if (item.stock < quantity)
    return res.status(400).json({ message: "Not enough stock" });

  const total = price * quantity;

  const sale = new Sale({
    item: item._id,
    quantity,
    price,
    total
  });

  await sale.save();

  // Deduct stock
  item.stock -= quantity;
  await item.save();

  res.json({ message: "Sale added and stock updated" });
});

// Delete sale (optional: restore stock if desired)
app.delete("/api/sales/:id", auth, async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.status(404).json({ message: "Sale not found" });

  // Restore item stock
  const item = await Item.findById(sale.item);
  if (item) {
    item.stock += sale.quantity;
    await item.save();
  }

  await Sale.findByIdAndDelete(req.params.id);
  res.json({ message: "Sale deleted and stock restored" });
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

  const report = new Report({ name });

  await report.save();

  res.json(report);

});

app.put("/api/reports/:id", auth, async (req, res) => {

  const { name } = req.body;

  const report = await Report.findByIdAndUpdate(
    req.params.id,
    { name },
    { new: true }
  );

  res.json(report);

});

app.delete("/api/reports/:id", auth, async (req, res) => {

  await Report.findByIdAndDelete(req.params.id);

  res.json({ message: "Report deleted" });

});

/* =========================
   DASHBOARD DATA
========================= */

app.get("/api/dashboard", auth, async (req, res) => {

  const totalItems = await Item.countDocuments();
  const availableItems = await Item.countDocuments({ stock: { $gt: 0 } });
  const outOfStock = await Item.countDocuments({ stock: { $lte: 0 } });
  const totalSales = await Sale.countDocuments();

  const totalRevenueAgg = await Sale.aggregate([
    { $group: { _id: null, total: { $sum: "$total" } } }
  ]);

  const totalRevenue = totalRevenueAgg[0]
    ? totalRevenueAgg[0].total
    : 0;

  res.json({
    totalItems,
    availableItems,
    outOfStock,
    totalSales,
    totalRevenue
  });

});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});