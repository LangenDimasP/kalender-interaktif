const db = require('../../config/db');
const bcrypt = require('bcrypt'); // Jika perlu untuk hash PIN

// Ambil Status Setting Saat Ini
exports.getSettings = async (req, res) => {
    try {
        const { calendarName } = req.params;
        
        
        // ✅ PERBAIKI: Query ke table app_settings (bukan calendars)
        const [rows] = await db.query(
            "SELECT allow_double_booking FROM app_settings WHERE calendar_name = ?",
            [calendarName]
        );
        
        let allowDoubleBooking = false; // Default
        if (rows.length > 0) {
            allowDoubleBooking = !!rows[0].allow_double_booking;
        }

        // ✅ PIN SELALU DI-CEK DARI calendars table
        const [calendarRows] = await db.query(
            "SELECT pin_hash FROM calendars WHERE name = ?",
            [calendarName]
        );
        
        res.json({
            allow_double_booking: allowDoubleBooking,
            has_pin: calendarRows.length > 0 && !!calendarRows[0].pin_hash
        });
    } catch (err) {
        console.error('Settings error:', err);
        res.status(500).json({ error: err.message });
    }
};

// Update Status Setting
exports.toggleDoubleBooking = async (req, res) => {
    try {
        const { calendarName } = req.params;
        const { allow } = req.body; // true/false

        // ✅ PERBAIKI: Update di table app_settings
        const [result] = await db.query(
            "UPDATE app_settings SET allow_double_booking = ? WHERE calendar_name = ?",
            [allow ? 1 : 0, calendarName]
        );

        // ✅ Jika row tidak ada, insert baru
        if (result.affectedRows === 0) {
            await db.query(
                "INSERT INTO app_settings (calendar_name, allow_double_booking) VALUES (?, ?)",
                [calendarName, allow ? 1 : 0]
            );
        }

        res.json({ 
            success: true,
            message: allow ? 'Double booking diizinkan' : 'Double booking tidak diizinkan'
        });
    } catch (err) {
        console.error('Toggle error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ✅ TAMBAH: Set PIN untuk Kalender
exports.setPin = async (req, res) => {
    try {
        const { calendarName } = req.params;
        const { pin } = req.body;

        if (!pin || pin.length < 4) {
            return res.status(400).json({ error: 'PIN harus minimal 4 karakter' });
        }

        // Hash PIN
        const saltRounds = 10;
        const pinHash = await bcrypt.hash(pin, saltRounds);

        // Update PIN di calendars table
        await db.query(
            "UPDATE calendars SET pin_hash = ? WHERE name = ?",
            [pinHash, calendarName]
        );

        res.json({ success: true, message: 'PIN berhasil diset' });
    } catch (err) {
        console.error('Set PIN error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ✅ TAMBAH: Verify PIN
exports.verifyPin = async (req, res) => {
    try {
        const { calendarName } = req.params;
        const { pin } = req.body;

        const [calendarRows] = await db.query(
            "SELECT pin_hash FROM calendars WHERE name = ?",
            [calendarName]
        );

        if (calendarRows.length === 0 || !calendarRows[0].pin_hash) {
            return res.status(400).json({ error: 'PIN tidak diset' });
        }

        const isValid = await bcrypt.compare(pin, calendarRows[0].pin_hash);
        res.json({ valid: isValid });
    } catch (err) {
        console.error('Verify PIN error:', err);
        res.status(500).json({ error: err.message });
    }
};