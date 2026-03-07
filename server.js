const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ MongoDB Error:", err));

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const itemSchema = new mongoose.Schema({
    name: String,
    stock: Number,
    price: Number
});

const saleSchema = new mongoose.Schema({
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },
    quantity: Number,
    totalPrice: Number,
    date: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Item = mongoose.model("Item", itemSchema);
const Sale = mongoose.model("Sale", saleSchema);

const authenticate = (req, res, next) => {

    const token = req.cookies.token || "";

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();

    } catch (err) {

        return res.status(401).json({ message: "Invalid token" });

    }

};

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/register", async (req, res) => {

    try {

        const { username, email, password } = req.body;

        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            return res
            .status(400)
            .json({ message: "Username or Email already exists" });
        }

        const newUser = new User({
            username,
            email,
            password
        });

        await newUser.save();

        res.json({ message: "Account created successfully!" });

    } catch (err) {

        console.error(err);
        res.status(500).json({ message: "Server error" });

    }

});

app.post("/login", async (req, res) => {

    try {

        const { username, password } = req.body;

        const user = await User.findOne({
            username,
            password
        });

        if (!user) {
            return res
            .status(401)
            .json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "Strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            message: "Login successful!",
            user: { username: user.username }
        });

    } catch (err) {

        res.status(500).json({ message: "Server error" });

    }

});

app.post("/api/logout", (req, res) => {

    res.clearCookie("token");

    res.json({ message: "Logged out" });

});

app.get("/api/dashboard", authenticate, async (req, res) => {

    try {

        const totalItems = await Item.countDocuments();

        const availableItems = await Item.countDocuments({
            stock: { $gt: 0 }
        });

        const outOfStock = await Item.countDocuments({
            stock: 0
        });

        const totalSales = await Sale.countDocuments();

        const totalRevenueAgg = await Sale.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalPrice" }
                }
            }
        ]);

        const totalRevenue = totalRevenueAgg[0]?.total || 0;

        res.json({
            totalItems,
            availableItems,
            outOfStock,
            totalSales,
            totalRevenue
        });

    } catch (err) {

        console.error(err);
        res.status(500).json({ message: "Server error" });

    }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});