const express = require("express");
const router = express.Router();
const upload = require("../helpers/uploadHelper");
const eventController = require("../controllers/eventController");
const roomController = require("../controllers/roomController");
const settingController = require("../controllers/settingController");
const db = require("../../config/db");
const bcrypt = require("bcrypt");
const PDFDocument = require('pdfkit');
const { holidays2025, holidays2026, holidays2027 } = require('../data/holidays');

// Import jsPDF and autoTable TOGETHER - order matters!
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

// Middleware untuk validasi kalender
const validateCalendar = async (req, res, next) => {
  const { calendarName } = req.params;
  const [calendar] = await db.query("SELECT * FROM calendars WHERE name = ?", [
    calendarName,
  ]);
  if (calendar.length === 0) {
    return res.status(404).json({ error: "Kalender tidak ditemukan" });
  }
  req.calendar = calendar[0];
  next();
};

// Middleware untuk validasi akses kalender (PIN jika ada)
const validateCalendarAccess = async (req, res, next) => {
  const { calendarName } = req.params;
  const [calendar] = await db.query("SELECT * FROM calendars WHERE name = ?", [
    calendarName,
  ]);

  if (calendar.length === 0) {
    return res.status(404).render("error", {
      message: "Kalender tidak ditemukan",
    });
  }

  const calendarData = calendar[0];

  // Jika kalender memiliki PIN
  if (calendarData.pin_hash) {
    // Cek apakah sudah verifikasi di session
    if (!req.session.verifiedCalendars) {
      req.session.verifiedCalendars = {};
    }

    // Jika belum verifikasi untuk kalender ini
    if (!req.session.verifiedCalendars[calendarName]) {
      req.pinVerified = false;
      req.calendar = calendarData;
      return next();
    }

    // Sudah verifikasi
    req.pinVerified = true;
  } else {
    req.pinVerified = true;
  }

  req.calendar = calendarData;
  next();
};

// Middleware untuk validasi PIN (untuk settings)
const validatePin = async (req, res, next) => {
  const { pin } = req.body;

  try {
    const [rows] = await db.query("SELECT pin_hash FROM calendars WHERE name = ?", [req.params.calendarName]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Kalender tidak ditemukan" });
    }

    // ✅ FIX: Cek pin_hash, bukan pin
    if (!rows[0].pin_hash) {
      console.log("Kalender tidak punya PIN, skip validasi");
      return next();
    }

    // Jika kalender punya PIN, validasi wajib
    if (!pin) {
      return res.status(400).json({ message: "PIN diperlukan untuk mengubah nama kalender" });
    }

    const isValid = await bcrypt.compare(pin, rows[0].pin_hash);
    if (!isValid) {
      return res.status(403).json({ message: "PIN salah" });
    }

    next();
  } catch (error) {
    console.error("Error validating PIN:", error);
    res.status(500).json({ message: "Terjadi kesalahan sistem" });
  }
};

// --- API ROUTES (Scoped per Calendar) ---

// 1. Data Events & Rooms
router.get(
  "/:calendarName/events",
  validateCalendar,
  eventController.getEvents
);
router.get(
  "/:calendarName/rooms",
  validateCalendar,
  roomController.getAllRooms
);

// 2. Transaksi Event
router.post(
  "/:calendarName/events",
  validateCalendar,
  upload.single("poster"),
  eventController.createEvent
);
router.put(
  "/:calendarName/events/:id/date",
  validateCalendar,
  eventController.updateEventDate
);
router.put(
  "/:calendarName/reminders/:id/date",
  validateCalendar,
  async (req, res) => {
    try {
      const { calendarName, id } = req.params;
      const { start_time } = req.body;

      if (!start_time) {
        return res.status(400).json({ message: "Tanggal tidak boleh kosong" });
      }

      // Update reminder date
      const [result] = await db.query(
        "UPDATE reminders SET reminder_date = ? WHERE id = ? AND calendar_name = ?",
        [start_time, id, calendarName]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Pengingat tidak ditemukan" });
      }

      res.json({ message: "Tanggal pengingat berhasil diupdate" });
    } catch (err) {
      console.error("Error updating reminder date:", err);
      res.status(500).json({ error: err.message });
    }
  }
);
router.delete(
  "/:calendarName/events/:id",
  validateCalendar,
  eventController.deleteEvent
);
router.put(
  "/:calendarName/events/:id",
  validateCalendar,
  eventController.updateEventDetails
);
router.post(
  "/:calendarName/events/:id/poster",
  validateCalendar,
  upload.single("poster"),
  eventController.uploadPoster
);

// 3. Helper Logic
router.post(
  "/:calendarName/check-availability",
  validateCalendar,
  eventController.checkAvailability
);

// 4. Settings Routes (Protected by PIN)
router.get(
  "/:calendarName/settings",
  validateCalendar,
  settingController.getSettings
);
router.post(
  "/:calendarName/settings",
  validateCalendar,
  settingController.toggleDoubleBooking
);

// 5. Room Management Routes
router.post(
  "/:calendarName/rooms",
  validateCalendar,
  roomController.createRoom
);
router.put(
  "/:calendarName/rooms/:id",
  validateCalendar,
  roomController.updateRoom
);
router.delete(
  "/:calendarName/rooms/:id",
  validateCalendar,
  roomController.deleteRoom
);



// 6. API: Verify PIN untuk akses kalender
router.post("/:calendarName/verify-pin", validateCalendar, async (req, res) => {
  const { pin } = req.body;
  const { calendarName } = req.params;

  if (!req.calendar.pin_hash) {
    return res.json({ success: true, message: "Kalender tanpa PIN" });
  }

  const isPinCorrect = await bcrypt.compare(pin || "", req.calendar.pin_hash);

  if (!isPinCorrect) {
    return res.status(403).json({ success: false, error: "PIN salah" });
  }

  // PIN benar, simpan di session
  if (!req.session.verifiedCalendars) {
    req.session.verifiedCalendars = {};
  }
  req.session.verifiedCalendars[calendarName] = true;

  res.json({ success: true, message: "PIN benar" });
});

// 7. Render View (Halaman Utama per Calendar)
router.get("/:calendarName", validateCalendarAccess, async (req, res) => {
  try {
    res.render("index", {
      calendarName: req.calendar.name,
      hasPin: !!req.calendar.pin_hash,
      requiresPin: !req.pinVerified && !!req.calendar.pin_hash,
      pinVerified: req.pinVerified || false,
          holidays2025, 
    holidays2026,  
    holidays2027
    });
  } catch (error) {
    console.error("Error rendering index:", error);
    res.status(500).send("Error loading calendar");
  }
});

// 8. Route untuk membuat kalender baru
router.post("/create-calendar", async (req, res) => {
  const { name, pin } = req.body;
  if (!name) return res.status(400).json({ error: "Nama kalender diperlukan" });
  const hashedPin = pin ? await bcrypt.hash(pin, 10) : null;
  try {
    await db.query("INSERT INTO calendars (name, pin_hash) VALUES (?, ?)", [
      name,
      hashedPin,
    ]);
    res.json({ message: "Kalender berhasil dibuat", calendarName: name });
  } catch (error) {
    res.status(500).json({ error: "Nama kalender sudah ada" });
  }
});

router.delete("/delete-calendar/:calendarName", async (req, res) => {
  const { calendarName } = req.params;

  try {
    await db.query("DELETE FROM events WHERE calendar_name = ?", [calendarName]);
    await db.query("DELETE FROM reminders WHERE calendar_name = ?", [calendarName]);
    await db.query("DELETE FROM rooms WHERE calendar_name = ?", [calendarName]);
    await db.query("DELETE FROM app_settings WHERE calendar_name = ?", [calendarName]);
    // ✅ TAMBAH: Hapus dari holidays
    await db.query("DELETE FROM holidays WHERE calendar_name = ?", [calendarName]);
    await db.query("DELETE FROM calendars WHERE name = ?", [calendarName]);

    res.json({
      success: true,
      message: "Kalender berhasil dihapus"
    });
  } catch (error) {
    console.error("Error deleting calendar:", error);
    res.status(500).json({ error: "Gagal menghapus kalender" });
  }
});

// 9. API: Rename Calendar
router.put(
  "/:calendarName/rename",
  validateCalendar,
  async (req, res) => {
    const { calendarName } = req.params;
    const { newName } = req.body;

    if (!newName || newName.trim() === "") {
      return res.status(400).json({ message: "Nama kalender tidak boleh kosong" });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return res.status(400).json({
        message: "Nama hanya boleh mengandung huruf, angka, dash, dan underscore",
      });
    }

    try {
      console.log("Starting rename for calendar:", calendarName, "to:", newName);

      const [existing] = await db.query("SELECT * FROM calendars WHERE name = ?", [newName]);
      if (existing.length > 0) {
        return res.status(400).json({ message: "Nama kalender sudah digunakan" });
      }

      // ✅ FIX: Gunakan transaksi dan disable foreign key checks sementara
      await db.query('START TRANSACTION');
      await db.query('SET FOREIGN_KEY_CHECKS = 0');  // Disable checks

      // Update parent table dulu (karena checks disabled)
      console.log("Updating calendars table...");
      await db.query("UPDATE calendars SET name = ? WHERE name = ?", [newName, calendarName]);

      // Lalu update child tables
      console.log("Updating rooms table...");
      await db.query("UPDATE rooms SET calendar_name = ? WHERE calendar_name = ?", [newName, calendarName]);

      console.log("Updating events table...");
      await db.query("UPDATE events SET calendar_name = ? WHERE calendar_name = ?", [newName, calendarName]);

      console.log("Updating reminders table...");
      await db.query("UPDATE reminders SET calendar_name = ? WHERE calendar_name = ?", [newName, calendarName]);

      console.log("Updating app_settings table...");
      await db.query("UPDATE app_settings SET calendar_name = ? WHERE calendar_name = ?", [newName, calendarName]);

      console.log("Updating holidays table...");
      await db.query("UPDATE holidays SET calendar_name = ? WHERE calendar_name = ?", [newName, calendarName]);

      // Re-enable checks
      await db.query('SET FOREIGN_KEY_CHECKS = 1');

      // Commit transaksi
      await db.query('COMMIT');

      console.log("Rename successful");
      res.json({
        success: true,
        message: "Nama kalender berhasil diubah",
        newName,
      });
    } catch (error) {
      // Rollback jika gagal (checks akan kembali enable otomatis)
      await db.query('ROLLBACK');
      console.error("Error renaming calendar:", error);
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ message: "Nama kalender sudah digunakan" });
      }
      res.status(500).json({ message: "Terjadi kesalahan sistem" });
    }
  }
);

// 10. API: Update/Remove PIN Kalender
router.post(
  "/:calendarName/update-pin",
  validateCalendar,
  validatePin,
  async (req, res) => {
    const { newPin } = req.body;
    let pinHash = null;
    if (newPin && newPin.trim() !== "") {
      pinHash = await bcrypt.hash(newPin, 10);
    }
    try {
      await db.query("UPDATE calendars SET pin_hash = ? WHERE name = ?", [
        pinHash,
        req.params.calendarName,
      ]);
      res.json({
        success: true,
        message: newPin ? "PIN berhasil diubah" : "PIN dinonaktifkan",
      });
    } catch (err) {
      res.status(500).json({ success: false, message: "Gagal update PIN" });
    }
  }
);

// Route utama: List kalender atau redirect ke default
router.get("/", async (req, res) => {
  const [calendars] = await db.query("SELECT name FROM calendars");
  res.render("calendar-list", { calendars });
});

// API: Get list of calendars (untuk frontend)
router.get("/api/calendars", async (req, res) => {
  try {
    const [calendars] = await db.query(
      "SELECT name, created_at FROM calendars ORDER BY created_at DESC"
    );
    res.json(calendars);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:calendarName/reminders", validateCalendar, async (req, res) => {
  try {
    const { title, reminder_date, notes } = req.body;
    const { calendarName } = req.params;

    if (!title || !reminder_date) {
      return res.status(400).json({ message: "Judul dan tanggal wajib diisi" });
    }

    // Simpan ke database (pastikan ada tabel reminders)
    await db.query(
      "INSERT INTO reminders (calendar_name, title, reminder_date, notes, created_at) VALUES (?, ?, ?, ?, NOW())",
      [calendarName, title, reminder_date, notes]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal membuat pengingat" });
  }
});

// ANALYTICS PAGE
router.get("/:calendarName/analytics", validateCalendar, async (req, res) => {
  try {
    res.render("analytics", {
      calendarName: req.params.calendarName
    });
  } catch (error) {
    console.error("Error rendering analytics:", error);
    res.status(500).send("Error loading analytics");
  }
});


// POST: Simpan holidays ke tabel terpisah
router.post('/:calendarName/holidays', async (req, res) => {
  try {
    const { calendarName } = req.params;
    const { year, holidays } = req.body;
    
    if (!year || !holidays || !Array.isArray(holidays)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // ✅ Simpan ke tabel holidays (bukan events)
    for (const holiday of holidays) {
      await db.query(
        `INSERT INTO holidays 
         (calendar_name, title, holiday_date, description, is_saved) 
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_saved = TRUE`,
        [
          calendarName,
          holiday.title,
          holiday.date,
          holiday.keterangan || holiday.title,
          true
        ]
      );
    }
    
    res.json({ 
      success: true, 
      message: `${holidays.length} holidays saved` 
    });
  } catch (err) {
    console.error('Error saving holidays:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:calendarName/holidays/:id', async (req, res) => {
  try {
    const { calendarName, id } = req.params;
    
    const [result] = await db.query(
      `DELETE FROM holidays 
       WHERE calendar_name = ? AND id = ?`,
      [calendarName, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Holiday tidak ditemukan' });
    }
    
    res.json({ 
      success: true, 
      message: 'Holiday berhasil dihapus'
    });
  } catch (err) {
    console.error('Error deleting holiday:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

router.post(
  "/:calendarName/events/:id/documentations",
  validateCalendar,
  upload.uploadDocumentation.single("documentation"),
  eventController.uploadDocumentation
);

router.delete(
  "/:calendarName/events/:eventId/documentations/:docId",
  validateCalendar,
  eventController.deleteDocumentation
);

// ✅ TAMBAH: Route untuk move room up
router.post(
  "/:calendarName/rooms/:id/move-up",
  validateCalendar,
  roomController.moveRoomUp
);

// DELETE: Hapus holidays per tahun
router.delete('/:calendarName/holidays/:year', async (req, res) => {
  try {
    const { calendarName, year } = req.params;
    
    const [result] = await db.query(
      `DELETE FROM holidays 
       WHERE calendar_name = ? AND YEAR(holiday_date) = ?`,
      [calendarName, year]
    );
    
    res.json({ 
      success: true, 
      message: `Holidays for ${year} deleted`,
      deletedRows: result.affectedRows
    });
  } catch (err) {
    console.error('Error deleting holidays:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET: Load holidays dari database by year
router.get('/:calendarName/holidays-by-year/:year', async (req, res) => {
  try {
    const { calendarName, year } = req.params;
    
    const [holidays] = await db.query(
      `SELECT id, calendar_name, title, holiday_date, description 
       FROM holidays 
       WHERE calendar_name = ? AND YEAR(holiday_date) = ?
       ORDER BY holiday_date ASC`,
      [calendarName, year]
    );
    
    res.json({ 
      success: true, 
      holidays: holidays.map(h => ({
        id: h.id,
        title: h.title,
        start_time: h.holiday_date,
        end_time: h.holiday_date,
        notes: h.description
      }))
    });
  } catch (err) {
    console.error('Error fetching holidays:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ✅ TAMBAH ROUTE INI (setelah import holidays)
router.get('/api/holidays/:year', (req, res) => {
  try {
    const year = parseInt(req.params.year);
    
    let holidays = [];
    if (year === 2025) {
      holidays = holidays2025;
    } else if (year === 2026) {
      holidays = holidays2026;
    } else if (year === 2027) {
      holidays = holidays2027;
    }
    
    res.json({
      is_success: true,
      year,
      data: holidays,
      count: holidays.length
    });
  } catch (error) {
    res.status(500).json({
      is_success: false,
      error: error.message
    });
  }
});

// ...existing code...
async function getAnalyticsData(calendarName, queryParams = {}) {
  const { period = 'all', startDate, endDate, startWeek, endWeek, startMonth, endMonth, startYear, endYear } = queryParams;

  let dateFilter = '';
  let reminderDateFilter = '';

  if (startDate && endDate) {
    dateFilter = `AND DATE(e.start_time) BETWEEN '${startDate}' AND '${endDate}'`;
    reminderDateFilter = `AND DATE(r.reminder_date) BETWEEN '${startDate}' AND '${endDate}'`;
  } else if (startWeek && endWeek) {
    const startWeekDate = getDateFromWeekString(startWeek);
    const endWeekDate = getDateFromWeekString(endWeek, true);
    dateFilter = `AND DATE(e.start_time) BETWEEN '${startWeekDate}' AND '${endWeekDate}'`;
    reminderDateFilter = `AND DATE(r.reminder_date) BETWEEN '${startWeekDate}' AND '${endWeekDate}'`;
  } else if (startMonth && endMonth) {
    dateFilter = `AND DATE_FORMAT(e.start_time, '%Y-%m') BETWEEN '${startMonth}' AND '${endMonth}'`;
    reminderDateFilter = `AND DATE_FORMAT(r.reminder_date, '%Y-%m') BETWEEN '${startMonth}' AND '${endMonth}'`;
  } else if (startYear && endYear) {
    dateFilter = `AND YEAR(e.start_time) BETWEEN ${startYear} AND ${endYear}`;
    reminderDateFilter = `AND YEAR(r.reminder_date) BETWEEN ${startYear} AND ${endYear}`;
  } else if (period !== 'all') {
    switch(period) {
      case 'daily':
        dateFilter = 'AND DATE(e.start_time) = CURDATE()';
        reminderDateFilter = 'AND DATE(r.reminder_date) = CURDATE()';
        break;
      case 'weekly':
        dateFilter = 'AND e.start_time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
        reminderDateFilter = 'AND r.reminder_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
        break;
      case 'monthly':
        dateFilter = 'AND e.start_time >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
        reminderDateFilter = 'AND r.reminder_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
        break;
      case 'yearly':
        dateFilter = 'AND YEAR(e.start_time) = YEAR(CURDATE())';
        reminderDateFilter = 'AND YEAR(r.reminder_date) = YEAR(CURDATE())';
        break;
    }
  }

  // 1. Total Events
  const [events] = await db.query(`SELECT COUNT(*) as count FROM events e WHERE e.calendar_name = ? ${dateFilter}`, [calendarName]);
  const totalEvents = events[0].count;

  // 2. Total Reminders
  const [reminders] = await db.query(`SELECT COUNT(*) as count FROM reminders r WHERE r.calendar_name = ? ${reminderDateFilter}`, [calendarName]);
  const totalReminders = reminders[0].count;

  // 3. Total Rooms
  const [rooms] = await db.query("SELECT COUNT(*) as count FROM rooms WHERE calendar_name = ?", [calendarName]);
  const totalRooms = rooms[0].count;

  // 4. Total Participants
  const [participants] = await db.query(`SELECT COALESCE(SUM(e.participants_count), 0) as total FROM events e WHERE e.calendar_name = ? ${dateFilter}`, [calendarName]);
  const totalParticipants = participants[0].total;

  // 5. Event per Room
  const [eventPerRoom] = await db.query(`SELECT r.id, r.name as room_name, COUNT(e.id) as count FROM rooms r LEFT JOIN events e ON r.id = e.room_id AND e.calendar_name = ? ${dateFilter} WHERE r.calendar_name = ? GROUP BY r.id, r.name ORDER BY count DESC`, [calendarName, calendarName]);

  // 6. Event per Month
  let monthFilter = dateFilter ? dateFilter : 'AND e.start_time >= DATE_SUB(NOW(), INTERVAL 12 MONTH)';
  const [eventPerMonth] = await db.query(`SELECT DATE_FORMAT(e.start_time, '%Y-%m') as month, COUNT(*) as count FROM events e WHERE e.calendar_name = ? ${monthFilter} GROUP BY DATE_FORMAT(e.start_time, '%Y-%m') ORDER BY month ASC`, [calendarName]);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedEventPerMonth = eventPerMonth.map(item => ({
    month: months[parseInt(item.month.split('-')[1]) - 1],
    count: item.count
  }));

  // 7. Room Utility
  const [roomUtility] = await db.query(`SELECT r.name as room_name, r.capacity, COALESCE(SUM(e.participants_count), 0) as participants FROM rooms r LEFT JOIN events e ON r.id = e.room_id AND e.calendar_name = ? ${dateFilter} WHERE r.calendar_name = ? GROUP BY r.id, r.name, r.capacity ORDER BY r.name ASC`, [calendarName, calendarName]);

  // 8. Event per Hour
  const [eventPerHour] = await db.query(`SELECT HOUR(e.start_time) as hour, COUNT(*) as count FROM events e WHERE e.calendar_name = ? ${dateFilter} GROUP BY HOUR(e.start_time) ORDER BY hour ASC`, [calendarName]);

  const formattedEventPerHour = Array.from({ length: 24 }, (_, i) => {
    const hourData = eventPerHour.find(e => e.hour === i);
    return {
      hour: `${String(i).padStart(2, '0')}:00`,
      count: hourData ? hourData.count : 0
    };
  });

  // 9. Room Details
  const [roomDetails] = await db.query(`SELECT r.id, r.name as room_name, r.capacity, r.color, COUNT(e.id) as totalEvents, COALESCE(SUM(e.participants_count), 0) as totalParticipants, COALESCE(AVG(e.participants_count), 0) as avgParticipants FROM rooms r LEFT JOIN events e ON r.id = e.room_id AND e.calendar_name = ? ${dateFilter} WHERE r.calendar_name = ? GROUP BY r.id, r.name, r.capacity, r.color ORDER BY totalEvents DESC`, [calendarName, calendarName]);

  // 10. Event Duration Distribution
  const [eventDuration] = await db.query(`SELECT CASE WHEN TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time) < 60 THEN '<1 jam' WHEN TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time) < 120 THEN '1-2 jam' WHEN TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time) < 240 THEN '2-4 jam' ELSE '>4 jam' END as duration_range, COUNT(*) as count FROM events e WHERE e.calendar_name = ? ${dateFilter} GROUP BY duration_range`, [calendarName]);

  // 11. Event Status
  const [eventStatus] = await db.query(`SELECT SUM(CASE WHEN e.start_time >= NOW() THEN 1 ELSE 0 END) as upcoming, SUM(CASE WHEN e.start_time < NOW() THEN 1 ELSE 0 END) as passed FROM events e WHERE e.calendar_name = ? ${dateFilter}`, [calendarName]);

  return {
    period,
    totalEvents,
    totalRooms,
    totalReminders,
    totalParticipants,
    eventPerRoom,
    eventPerMonth: formattedEventPerMonth,
    roomUtility,
    eventPerHour: formattedEventPerHour,
    eventDuration,
    eventStatus: eventStatus[0] || { upcoming: 0, passed: 0 },
    roomDetails
  };
}
router.get("/:calendarName/api/analytics", validateCalendar, async (req, res) => {
  try {
    const data = await getAnalyticsData(req.params.calendarName, req.query);
    res.json(data);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: error.message });
  }
});

function getDateFromWeekString(weekString, isEndOfWeek = false) {
  const [year, week] = weekString.split('-W').map(Number);
  const firstDayOfYear = new Date(year, 0, 1);
  const daysOffset = (week - 1) * 7 + (firstDayOfYear.getDay() === 0 ? 0 : 7 - firstDayOfYear.getDay());
  const date = new Date(year, 0, 1 + daysOffset);
  if (isEndOfWeek) {
    date.setDate(date.getDate() + 6); // Akhir minggu (Sabtu)
  }
  return date.toISOString().split('T')[0]; // Format YYYY-MM-DD
}

router.get("/:calendarName/api/analytics/export-pdf", validateCalendar, async (req, res) => {
  try {
    const { calendarName } = req.params;
    const { period = 'all', startDate, endDate, startWeek, endWeek, startMonth, endMonth, startYear, endYear, week, month, year } = req.query;

    let analyticsQuery = `?period=${period}`;
    if (startDate && endDate) {
      analyticsQuery += `&startDate=${startDate}&endDate=${endDate}`;
    } else if (startWeek && endWeek) {
      analyticsQuery += `&startWeek=${startWeek}&endWeek=${endWeek}`;
    } else if (startMonth && endMonth) {
      analyticsQuery += `&startMonth=${startMonth}&endMonth=${endMonth}`;
    } else if (startYear && endYear) {
      analyticsQuery += `&startYear=${startYear}&endYear=${endYear}`;
    } else if (week) {
      analyticsQuery += `&week=${week}`;
    } else if (month) {
      analyticsQuery += `&month=${month}`;
    } else if (year) {
      analyticsQuery += `&year=${year}`;
    }

    // Fetch analytics data
    const data = await getAnalyticsData(calendarName, req.query);

    // Create jsPDF document
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // ===== HEADER =====
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Laporan Analytics - ${calendarName}`, pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const periodText = getPeriodText(period, startDate, endDate, startWeek, endWeek, startMonth, endMonth, startYear, endYear);
    doc.text(periodText, pageWidth / 2, 28, { align: 'center' });
    
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Dibuat pada: ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, 34, { align: 'center' });
    
    doc.setDrawColor(200);
    doc.setLineWidth(0.5);
    doc.line(15, 38, pageWidth - 15, 38);

    // ===== SUMMARY STATS =====
    const stats = [
      { label: 'Total Event', value: data.totalEvents },
      { label: 'Total Ruangan', value: data.totalRooms },
      { label: 'Total Pengingat', value: data.totalReminders },
      { label: 'Total Peserta', value: data.totalParticipants }
    ];

    let startY = 45;
    const boxWidth = 42;
    const boxHeight = 22;
    const spacing = 3;
    const totalWidth = (boxWidth * 4) + (spacing * 3);
    let startX = (pageWidth - totalWidth) / 2;

    stats.forEach((stat, idx) => {
      const x = startX + (idx * (boxWidth + spacing));
      
      // Box background
      doc.setFillColor(240, 242, 245);
      doc.setDrawColor(200, 205, 210);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, startY, boxWidth, boxHeight, 2, 2, 'FD');
      
      // Label
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80);
      doc.text(stat.label, x + boxWidth / 2, startY + 6, { align: 'center' });
      
      // Value
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text(stat.value.toString(), x + boxWidth / 2, startY + 16, { align: 'center' });
    });

    // ===== TABLES =====
    let yPos = startY + boxHeight + 15;

    // Event per Ruangan
    if (data.eventPerRoom && data.eventPerRoom.length > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Event per Ruangan', 14, yPos);
      yPos += 2;
      
      const total = data.eventPerRoom.reduce((s, r) => s + r.count, 0);
      const tableData = data.eventPerRoom.map((room, idx) => [
        idx + 1,
        room.room_name || 'Tanpa Ruangan',
        room.count,
        total > 0 ? Math.round(room.count / total * 100) + '%' : '0%'
      ]);
      
      doc.autoTable({
        head: [['No', 'Ruangan', 'Jumlah Event', 'Persentase']],
        body: tableData,
        startY: yPos,
        theme: 'grid',
        styles: { 
          fontSize: 9,
          cellPadding: 3,
          halign: 'center'
        },
        headStyles: { 
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: 'bold',
          halign: 'center'
        },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 15 },
          1: { cellWidth: 80, halign: 'left' },
          2: { cellWidth: 40 },
          3: { cellWidth: 40 }
        },
        margin: { left: 14, right: 14 }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Tingkat Okupansi Ruangan
    if (data.roomUtility && data.roomUtility.length > 0) {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Tingkat Okupansi Ruangan', 14, yPos);
      yPos += 2;
      
      const tableData = data.roomUtility.map(room => [
        room.room_name || 'Tanpa Ruangan',
        room.capacity,
        room.participants,
        room.capacity > 0 ? Math.round(room.participants / room.capacity * 100) + '%' : '0%'
      ]);
      
      doc.autoTable({
        head: [['Ruangan', 'Kapasitas', 'Total Peserta', 'Okupansi']],
        body: tableData,
        startY: yPos,
        theme: 'grid',
        styles: { 
          fontSize: 9,
          cellPadding: 3,
          halign: 'center'
        },
        headStyles: { 
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: 'bold'
        },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 70, halign: 'left' },
          1: { cellWidth: 35 },
          2: { cellWidth: 45 },
          3: { cellWidth: 35 }
        },
        margin: { left: 14, right: 14 }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Distribusi Durasi Event
    if (data.eventDuration && data.eventDuration.length > 0) {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Distribusi Durasi Event', 14, yPos);
      yPos += 2;
      
      const total = data.eventDuration.reduce((s, x) => s + x.count, 0);
      const tableData = data.eventDuration.map(d => [
        d.duration_range,
        d.count,
        total > 0 ? Math.round(d.count / total * 100) + '%' : '0%'
      ]);
      
      doc.autoTable({
        head: [['Rentang Durasi', 'Jumlah Event', 'Persentase']],
        body: tableData,
        startY: yPos,
        theme: 'grid',
        styles: { 
          fontSize: 9,
          cellPadding: 3,
          halign: 'center'
        },
        headStyles: { 
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: 'bold'
        },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 70, halign: 'left' },
          1: { cellWidth: 50 },
          2: { cellWidth: 50 }
        },
        margin: { left: 14, right: 14 }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Detail Penggunaan Ruangan
    if (data.roomDetails && data.roomDetails.length > 0) {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Detail Penggunaan Ruangan', 14, yPos);
      yPos += 2;
      
      const tableData = data.roomDetails.map(room => [
        room.room_name || 'Tanpa Ruangan',
        room.capacity,
        room.totalEvents,
        room.totalParticipants,
        Math.round(room.avgParticipants)
      ]);
      
      doc.autoTable({
        head: [['Ruangan', 'Kapasitas', 'Total Event', 'Total Peserta', 'Rata-rata']],
        body: tableData,
        startY: yPos,
        theme: 'grid',
        styles: { 
          fontSize: 9,
          cellPadding: 3,
          halign: 'center'
        },
        headStyles: { 
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: 'bold'
        },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { cellWidth: 60, halign: 'left' },
          1: { cellWidth: 30 },
          2: { cellWidth: 30 },
          3: { cellWidth: 35 },
          4: { cellWidth: 30 }
        },
        margin: { left: 14, right: 14 }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // ===== REKAPAN KESELURUHAN =====
    if (yPos > pageHeight - 80) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Rekapan Keseluruhan', 14, yPos);
    yPos += 8;

    const avgUtilization = data.roomDetails && data.roomDetails.length > 0 
      ? Math.round(data.roomDetails.reduce((sum, room) => {
          const util = room.capacity > 0 ? (room.avgParticipants / room.capacity) * 100 : 0;
          return sum + util;
        }, 0) / data.roomDetails.length) 
      : 0;

    const busiestRoom = data.eventPerRoom && data.eventPerRoom.length > 0 
      ? data.eventPerRoom.reduce((max, room) => room.count > max.count ? room : max) 
      : null;

    const summaryData = [
      ['Total Event', data.totalEvents],
      ['Total Peserta', data.totalParticipants],
      ['Rata-rata Peserta per Event', data.totalEvents > 0 ? Math.round(data.totalParticipants / data.totalEvents) : 0],
      ['Utilisasi Rata-rata Ruangan', avgUtilization + '%'],
      ['Ruangan Paling Sibuk', busiestRoom ? `${busiestRoom.room_name} (${busiestRoom.count} event)` : 'Tidak ada data']
    ];

    doc.autoTable({
      body: summaryData,
      startY: yPos,
      theme: 'plain',
      styles: { 
        fontSize: 10,
        cellPadding: 3
      },
      columnStyles: {
        0: { cellWidth: 90, fontStyle: 'bold', textColor: [80, 80, 80] },
        1: { cellWidth: 90, halign: 'left' }
      },
      margin: { left: 14, right: 14 }
    });
    yPos = doc.lastAutoTable.finalY + 8;

    // Insight
    doc.setFillColor(255, 248, 220);
    doc.setDrawColor(255, 193, 7);
    doc.roundedRect(14, yPos, pageWidth - 28, 15, 2, 2, 'FD');
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 80, 0);
    doc.text('Insight:', 18, yPos + 5);
    
    doc.setFont('helvetica', 'normal');
    const insightText = data.totalEvents > 0 
      ? 'Aktivitas tinggi, pertimbangkan penambahan ruangan jika utilisasi >80%.' 
      : 'Belum ada event dalam periode ini.';
    doc.text(insightText, 18, yPos + 10);

    // ===== FOOTER =====
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Halaman ${i} dari ${pageCount} | AgendaCerdas © ${new Date().getFullYear()}`, 
        pageWidth / 2, 
        pageHeight - 10, 
        { align: 'center' }
      );
    }

    // Output as buffer
    const pdfBuffer = doc.output('arraybuffer');
    const fileName = `Analytics_${calendarName}_${period}_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBuffer));

  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== HELPER FUNCTION =====
function getPeriodText(period, startDate, endDate, startWeek, endWeek, startMonth, endMonth, startYear, endYear) {
  if (startDate && endDate) {
    const start = new Date(startDate).toLocaleDateString('id-ID');
    const end = new Date(endDate).toLocaleDateString('id-ID');
    return `Periode Harian: ${start} - ${end}`;
  }
  if (startWeek && endWeek) {
    return `Periode Mingguan: ${startWeek} - ${endWeek}`;
  }
  if (startMonth && endMonth) {
    return `Periode Bulanan: ${startMonth} - ${endMonth}`;
  }
  if (startYear && endYear) {
    return `Periode Tahunan: ${startYear} - ${endYear}`;
  }
  const labels = {
    'daily': 'Harian (Hari Ini)',
    'weekly': 'Mingguan (7 Hari Terakhir)',
    'monthly': 'Bulanan (30 Hari Terakhir)',
    'yearly': 'Tahunan (Tahun Ini)',
    'all': 'Seluruh Waktu'
  };
  return labels[period] || 'Seluruh Waktu';
}

// ...existing code...

module.exports = router;
