require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const apiRoutes = require('./routes/api');
// ✅ Tambahkan holidays2027
const { holidays2025, holidays2026, holidays2027 } = require('./data/holidays');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'kalender-interaktif-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true jika menggunakan HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 jam
  }
}));

// Static Files (CSS, JS, Uploads)
app.use(express.static(path.join(__dirname, '../public')));

// View Engine (EJS)
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Routes
app.use('/', apiRoutes);

// API: Get Holidays (Local Data)
app.get('/api/holidays', (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        
        console.log(`📅 Fetching holidays for year: ${year}`);
        
        let holidays = [];
        
        if (year === 2025) {
            holidays = holidays2025;
        } else if (year === 2026) {
            holidays = holidays2026;
        } else if (year === 2027) { // ✅ Tambahkan untuk 2027
            holidays = holidays2027;
        } else {
            holidays = [];
        }
        
        res.json({
            is_success: true,
            message: 'Success',
            data: holidays
        });
        
        console.log(`✅ Successfully fetched ${holidays.length} holidays for ${year}`);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ 
            is_success: false, 
            data: [],
            error: error.message 
        });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});