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

/* =========================
   APP INIT
========================= */
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
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

/* =========================
   IMAGE UPLOAD
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

/* =========================
   SCHEMAS
========================= */
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
});

const itemSchema = new mongoose.Schema({
  name: String,
  description: String,
  stock: Number,
  price: Number,
  image: String,
});

const supplierSchema = new mongoose.Schema({
  name: String,
  contact: String,
});

const saleSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },
  quantity: Number,
  price: Number,
  total: Number,
  date: { type: Date, default: Date.now },
});

const reportSchema = new mongoose.Schema({
  name: String,
  date: { type: Date, default: Date.now },
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
  } catch (err) {
    return res.status(401).json({ message: "Invalid Token" });
  }
}

/* =========================
   AUTH ROUTES
========================= */

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: "User exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      email,
      password: hashed,
    });

    await user.save();

    res.json({ message: "Account created" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ message: "Invalid login" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Invalid login" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: "Login successful" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
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

  const image = req.file ? "/uploads/" + req.file.filename : "";

  const item = new Item({
    name,
    description,
    stock,
    price,
    image,
  });

  await item.save();

  res.json(item);
});

app.put("/api/items/:id", auth, async (req, res) => {
  const item = await Item.findByIdAndUpdate(
    req.params.id,
    req.body,
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
  const supplier = new Supplier(req.body);
  await supplier.save();
  res.json(supplier);
});

app.put("/api/suppliers/:id", auth, async (req, res) => {
  const supplier = await Supplier.findByIdAndUpdate(
    req.params.id,
    req.body,
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

app.get("/api/sales", auth, async (req, res) => {
  const sales = await Sale.find().populate("item");

  const formatted = sales.map((s) => ({
    _id: s._id,
    itemName: s.item ? s.item.name : "Deleted",
    price: s.price,
    quantity: s.quantity,
    total: s.total,
    date: s.date,
  }));

  res.json(formatted);
});

app.post("/api/sales", auth, async (req, res) => {
  const { itemId, quantity } = req.body;

  const item = await Item.findById(itemId);

  if (!item) {
    return res.status(404).json({ message: "Item not found" });
  }

  const total = item.price * quantity;

  const sale = new Sale({
    item: itemId,
    quantity,
    price: item.price,
    total,
  });

  await sale.save();

  item.stock -= quantity;
  await item.save();

  res.json({ message: "Sale added" });
});

app.delete("/api/sales/:id", auth, async (req, res) => {
  await Sale.findByIdAndDelete(req.params.id);
  res.json({ message: "Sale deleted" });
});

/* =========================
   REPORTS API
========================= */

app.get("/api/reports", auth, async (req, res) => {
  const reports = await Report.find();
  res.json(reports);
});

app.post("/api/reports", auth, async (req, res) => {
  const report = new Report(req.body);
  await report.save();
  res.json(report);
});

app.put("/api/reports/:id", auth, async (req, res) => {
  const report = await Report.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );

  res.json(report);
});

app.delete("/api/reports/:id", auth, async (req, res) => {
  await Report.findByIdAndDelete(req.params.id);
  res.json({ message: "Report deleted" });
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});