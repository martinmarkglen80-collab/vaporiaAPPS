const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
require("dotenv").config();

const app = express();

/* =========================
   Middleware
========================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(__dirname));

/* =========================
   MongoDB Connection
========================= */
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("✅ MongoDB Connected"))
.catch(err=>console.log("❌ MongoDB Error:",err));

/* =========================
   Schemas & Models
========================= */

const userSchema = new mongoose.Schema({
username:{type:String,required:true,unique:true},
email:{type:String,required:true,unique:true},
password:{type:String,required:true}
});

const User = mongoose.model("User",userSchema);


const itemSchema = new mongoose.Schema({
name:{type:String,required:true},
description:{type:String},
stock:{type:Number,required:true},
image:{type:String}
});

const Item = mongoose.model("Item",itemSchema);

/* =========================
   Multer Upload
========================= */

if(!fs.existsSync("./uploads")){
fs.mkdirSync("./uploads");
}

const storage = multer.diskStorage({

destination:function(req,file,cb){
cb(null,"uploads/");
},

filename:function(req,file,cb){
const ext = path.extname(file.originalname);
cb(null,Date.now()+ext);
}

});

const upload = multer({storage});

/* =========================
   Routes
========================= */

app.get("/",(req,res)=>{
res.sendFile(path.join(__dirname,"login.html"));
});

/* ===== REGISTER ===== */

app.post("/register",async(req,res)=>{

try{

const {username,email,password}=req.body;

if(!username||!email||!password){
return res.status(400).json({message:"All fields required"});
}

const existingUser = await User.findOne({
$or:[{username},{email}]
});

if(existingUser){
return res.status(400).json({message:"Username or Email already exists"});
}

const hashedPassword = await bcrypt.hash(password,10);

const newUser = new User({
username,
email,
password:hashedPassword
});

await newUser.save();

res.json({message:"Account created successfully!"});

}catch(err){

console.error(err);
res.status(500).json({message:"Server error"});

}

});

/* ===== LOGIN ===== */

app.post("/login",async(req,res)=>{

try{

const {username,password}=req.body;

if(!username||!password){
return res.status(400).json({message:"Required"});
}

const user = await User.findOne({username});

if(!user){
return res.status(401).json({message:"Invalid credentials"});
}

const isMatch = await bcrypt.compare(password,user.password);

if(!isMatch){
return res.status(401).json({message:"Invalid credentials"});
}

const token = jwt.sign(
{id:user._id,username:user.username},
process.env.JWT_SECRET,
{expiresIn:"7d"}
);

res.cookie("token",token,{
httpOnly:true,
secure:process.env.NODE_ENV==="production",
sameSite:"Strict",
maxAge:7*24*60*60*1000
});

res.json({
message:"Login successful!",
user:{username:user.username}
});

}catch(err){

console.error(err);
res.status(500).json({message:"Server error"});

}

});

/* ===== LOGOUT ===== */

app.post("/logout",(req,res)=>{
res.clearCookie("token");
res.json({message:"Logged out"});
});

/* ===== DASHBOARD ===== */

app.get("/api/dashboard",async(req,res)=>{

const token = req.cookies.token;

if(!token){
return res.status(401).json({message:"Unauthorized"});
}

try{

jwt.verify(token,process.env.JWT_SECRET);

const totalItems = await Item.countDocuments();

const availableItems = await Item.countDocuments({
stock:{$gt:0}
});

const outOfStock = await Item.countDocuments({
stock:{$lte:0}
});

res.json({
totalItems,
availableItems,
outOfStock,
totalSales:50,
totalRevenue:1500
});

}catch{

res.status(401).json({message:"Invalid token"});

}

});

/* ===== GET ITEMS ===== */

app.get("/api/items",async(req,res)=>{

const token = req.cookies.token;

if(!token){
return res.status(401).json({message:"Unauthorized"});
}

try{

jwt.verify(token,process.env.JWT_SECRET);

const items = await Item.find().sort({name:1});

res.json(items);

}catch{

res.status(401).json({message:"Invalid token"});

}

});

/* ===== ADD ITEM ===== */

app.post("/api/items",upload.single("image"),async(req,res)=>{

const token = req.cookies.token;

if(!token){
return res.status(401).json({message:"Unauthorized"});
}

try{

jwt.verify(token,process.env.JWT_SECRET);

const {name,stock,description}=req.body;

if(!name||!stock){
return res.status(400).json({message:"Name and stock required"});
}

const newItem = new Item({

name,
stock:Number(stock),
description:description||"",
image:req.file ? `/uploads/${req.file.filename}` : ""

});

await newItem.save();

res.json({message:"Item added successfully!"});

}catch(err){

console.error(err);
res.status(500).json({message:"Server error"});

}

});

/* =========================
   Start Server
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
console.log(`🔥 Server running on port ${PORT}`);
});