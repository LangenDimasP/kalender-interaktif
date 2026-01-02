const mysql = require('mysql2');
require('dotenv').config();

// Buat koneksi pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kalender_interaktif',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // ✅ TAMBAHKAN INI WAJIB UNTUK TIDB/VERCEL:
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// Kita gunakan promise wrapper agar bisa pakai async/await (lebih rapi)
const db = pool.promise();

module.exports = db;