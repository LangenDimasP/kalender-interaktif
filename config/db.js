const mysql = require('mysql2');
require('dotenv').config();

// Buat koneksi pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', // sesuaikan password
    database: process.env.DB_NAME || 'kalender_interaktif',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Kita gunakan promise wrapper agar bisa pakai async/await (lebih rapi)
const db = pool.promise();

module.exports = db;