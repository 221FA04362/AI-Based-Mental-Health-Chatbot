const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const mongoose = require("mongoose"); // Added this
const bcrypt = require("bcryptjs");   // Added this
const jwt = require("jsonwebtoken");  // Added this
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Database Connection
// Ensure you have MONGODB_URI and JWT_SECRET in your .env file
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/mindcare";
const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_key";

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// 2. Schemas & Models
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema); // Added this

// ================= AUTH ROUTES =================

app.post('/api/signup', async (req, res) => {
    try {
      const { fullName, email, password } = req.body;
      const cleanEmail = email.toLowerCase().trim(); 

      let user = await User.findOne({ email: cleanEmail });
      if (user) return res.status(400).json({ message: "User already exists" });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      user = new User({ fullName, email: cleanEmail, password: hashedPassword });
      await user.save();
      res.status(201).json({ message: "User created successfully!" });
    } catch (error) { 
      console.error(error);
      res.status(500).json({ message: "Registration failed" }); 
    }
});

app.post('/api/signin', async (req, res) => {
    try {
      const { email, password } = req.body;
      const cleanEmail = email.toLowerCase().trim(); 

      const user = await User.findOne({ email: cleanEmail });
      
      console.log(`Checking DB for: ${cleanEmail} | Found: ${!!user}`);

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ token, user: { name: user.fullName, email: user.email } });
    } catch (err) { 
      res.status(500).json({ message: "Login error" }); 
    }
});

// ================= CHAT ROUTES (JSON BASED) =================

const DATA_FILE = path.join(__dirname, "chatHistory.json");
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));

const readData = () => JSON.parse(fs.readFileSync(DATA_FILE));
const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

app.get("/api/history", (req, res) => res.json(readData()));

app.post("/api/chat/:id", async (req, res) => {
    const { id } = req.params;
    const { message, isEdit, messageIndex } = req.body;
    let chats = readData();
    
    let chat = chats.find(c => c.id === id);
    if (!chat) {
        chat = { id, title: "New Session...", messages: [] };
        chats.push(chat);
    }

    if (isEdit && messageIndex !== undefined) {
        chat.messages = chat.messages.slice(0, messageIndex);
    }
    
    chat.messages.push({ role: "user", content: message });

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai/gpt-3.5-turbo",
                messages: [{ role: "system", content: "You are MindCare AI." }, ...chat.messages]
            })
        });
        const data = await response.json();
        const botReply = data.choices[0].message;
        chat.messages.push(botReply);

        const titleRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai/gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "Analyze the current situation of this chat and provide a 2-3 word title. No quotes, no periods." },
                    ...chat.messages
                ]
            })
        });
        const titleData = await titleRes.json();
        if (titleData.choices && titleData.choices[0].message) {
            chat.title = titleData.choices[0].message.content.trim();
        }

        saveData(chats);
        res.json(botReply);
    } catch (err) {
        console.error("AI Error:", err);
        res.status(500).json({ content: "Error connecting to AI." });
    }
});

app.patch("/api/chat/:id", (req, res) => {
    let chats = readData();
    const chat = chats.find(c => c.id === req.params.id);
    if (chat) chat.title = req.body.title;
    saveData(chats);
    res.json({ success: true });
});

app.delete("/api/chat/:id", (req, res) => {
    saveData(readData().filter(c => c.id !== req.params.id));
    res.json({ success: true });
});

app.delete("/api/history", (req, res) => { saveData([]); res.json({ success: true }); });

app.listen(5000, () => console.log("🚀 MindCare Server running on http://localhost:5000"));