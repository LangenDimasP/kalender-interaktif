const db = require("../../config/db");
const path = require("path");
const fs = require("fs");

// Helper function untuk cek bentrok
async function checkConflict(
  calendarName,
  roomId,
  startTime,
  endTime,
  excludeEventId = null
) {
  // Ambil setting per calendar
  const [settings] = await db.query(
    "SELECT allow_double_booking FROM app_settings WHERE calendar_name = ? LIMIT 1",
    [calendarName]
  );
  const allowDouble = settings[0]?.allow_double_booking || false;

  if (allowDouble) return false; // Jika boleh double, tidak ada konflik.

  // Logic SQL Cek Bentrok:
  // (StartA < EndB) AND (EndA > StartB)
  let sql = `
        SELECT count(*) as count FROM events 
        WHERE calendar_name = ? AND room_id = ? 
        AND (start_time < ? AND end_time > ?)
    `;

  const params = [calendarName, roomId, endTime, startTime];

  // Jika sedang edit, jangan cek diri sendiri
  if (excludeEventId) {
    sql += " AND id != ?";
    params.push(excludeEventId);
  }

  const [rows] = await db.query(sql, params);
  return rows[0].count > 0; // Return true jika ada bentrok
}

exports.getEvents = async (req, res) => {
  try {
    const calendarName = req.params.calendarName;
    const [events] = await db.query(
      `SELECT e.*, r.name as room_name, r.color as room_color 
       FROM events e 
       LEFT JOIN rooms r ON e.room_id = r.id 
       WHERE e.calendar_name = ? 
       ORDER BY e.start_time ASC`,
      [calendarName]
    );

    const formattedEvents = await Promise.all(events.map(async (event) => {
      const [docs] = await db.query(
        "SELECT id, file_path, file_type, file_name FROM event_documentations WHERE event_id = ? ORDER BY uploaded_at ASC",
        [event.id]
      );

      // ✅ PERBAIKI: Jangan tambah (pic_name) di sini!
      // ❌ SEBELUMNYA: title: `${event.title} (${event.pic_name})`
      // ✅ SEKARANG:
      return {
        id: event.id,
        title: event.title,  // ✅ HANYA title asli, TANPA pic_name atau location
        start: event.start_time,
        end: event.end_time,
        backgroundColor: event.room_color || "#60a5fa",
        borderColor: event.room_color || "#60a5fa",
        extendedProps: {
          room_id: event.room_id,
          room_name: event.room_name,
          room_color: event.room_color,
          organizer_name: event.organizer_name,
          organizer_phone: event.organizer_phone,
          pic_name: event.pic_name,  // ✅ Kirim sebagai extended prop (TERPISAH)
          participants_count: event.participants_count,
          notes: event.notes,
          poster_path: event.poster_path,
          meeting_link: event.meeting_link,
          documentations: docs,
        },
      };
    }));

    // --- REMINDERS ---
    const [reminders] = await db.query(
      "SELECT * FROM reminders WHERE calendar_name = ?",
      [calendarName]
    );
    const reminderEvents = reminders.map((reminder) => ({
      id: `reminder-${reminder.id}`,
      title: reminder.title,
      start: reminder.reminder_date,
      end: reminder.reminder_date,
      allDay: true,
      backgroundColor: "#a78bfa",
      borderColor: "#9333ea",
      textColor: "#fff",
      editable: true,
      extendedProps: {
        isReminder: true,
        notes: reminder.notes,
        reminder_id: reminder.id,
      },
    }));

    res.json([...formattedEvents, ...reminderEvents]);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Gagal mengambil data jadwal" });
  }
};

// ✅ TAMBAH: Upload Dokumentasi
exports.uploadDocumentation = async (req, res) => {
  try {
    const { calendarName, id } = req.params;

    // Validasi event ada
    const [event] = await db.query(
      "SELECT id FROM events WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );
    if (event.length === 0) {
      return res.status(404).json({ message: "Event tidak ditemukan" });
    }

    // Validasi file
    if (!req.file) {
      return res.status(400).json({ message: "File tidak ditemukan" });
    }

    // Tentukan tipe file (image atau video)
    const fileType = req.file.mimetype.startsWith("video") ? "video" : "image";
    const filePath = `/uploads/documentations/${req.file.filename}`;

    // Simpan ke database
    const [result] = await db.query(
      `INSERT INTO event_documentations 
       (event_id, calendar_name, file_path, file_type, file_name)
       VALUES (?, ?, ?, ?, ?)`,
      [id, calendarName, filePath, fileType, req.file.originalname]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      file_path: filePath,
      file_type: fileType,
      file_name: req.file.originalname,
    });
  } catch (err) {
    console.error("Error uploading documentation:", err);
    res.status(500).json({ message: "Gagal upload dokumentasi" });
  }
};

// ✅ TAMBAH: Hapus Dokumentasi
exports.deleteDocumentation = async (req, res) => {
  try {
    const { calendarName, eventId, docId } = req.params;
    const path = require("path");
    const fs = require("fs");

    // Cek dokumentasi ada
    const [doc] = await db.query(
      "SELECT file_path FROM event_documentations WHERE id = ? AND event_id = ? AND calendar_name = ?",
      [docId, eventId, calendarName]
    );

    if (doc.length === 0) {
      return res.status(404).json({ message: "Dokumentasi tidak ditemukan" });
    }

    // Hapus file fisik
    const filePath = path.join(__dirname, "../../public", doc[0].file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Hapus dari database
    await db.query(
      "DELETE FROM event_documentations WHERE id = ? AND event_id = ? AND calendar_name = ?",
      [docId, eventId, calendarName]
    );

    res.json({ success: true, message: "Dokumentasi dihapus" });
  } catch (err) {
    console.error("Error deleting documentation:", err);
    res.status(500).json({ message: "Gagal hapus dokumentasi" });
  }
};

// 2. Simpan Event Baru
exports.createEvent = async (req, res) => {
  try {
    const { calendarName } = req.params;
    const {
      room_id,
      title,
      start_time,
      end_time,
      organizer_name,
      organizer_phone,
      pic_name,
      participants_count,
      notes,
      meeting_link,  // ✅ TAMBAH
    } = req.body;
    const poster_path = req.file ? `/uploads/${req.file.filename}` : null;

    // Validasi field wajib
    if (
      !title ||
      !room_id ||
      !start_time ||
      !end_time ||
      !organizer_name ||
      !pic_name
    ) {
      return res.status(400).json({ message: "Semua field wajib diisi!" });
    }

    // Validasi waktu
    if (new Date(start_time) >= new Date(end_time)) {
      return res
        .status(400)
        .json({ message: "Waktu selesai harus setelah waktu mulai!" });
    }

    // Validasi Konflik Server-Side
    const isConflict = await checkConflict(
      calendarName,
      room_id,
      start_time,
      end_time
    );
    if (isConflict) {
      return res
        .status(409)
        .json({ message: "❌ Ruangan sudah terisi di jam tersebut!" });
    }

    const sql = `
            INSERT INTO events 
            (calendar_name, room_id, title, start_time, end_time, organizer_name, organizer_phone, pic_name, participants_count, poster_path, notes, meeting_link)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

    await db.query(sql, [
      calendarName,
      room_id,
      title,
      start_time,
      end_time,
      organizer_name,
      organizer_phone,
      pic_name,
      participants_count || 0,
      poster_path,
      notes,
      meeting_link || null,  // ✅ TAMBAH
    ]);

    res.status(201).json({ message: "✅ Booking berhasil dibuat!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
};

// 3. Update Tanggal (Drag & Drop)
exports.updateEventDate = async (req, res) => {
  try {
    const { calendarName, id } = req.params;
    const { start_time, end_time } = req.body;

    // Validasi waktu
    if (new Date(start_time) >= new Date(end_time)) {
      return res
        .status(400)
        .json({ message: "Waktu selesai harus setelah waktu mulai!" });
    }

    // Cek event aslinya dulu untuk tau room_id dan pastikan calendar benar
    const [existing] = await db.query(
      "SELECT room_id FROM events WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );
    if (existing.length === 0)
      return res.status(404).json({ message: "Event not found" });

    // Cek Konflik
    const isConflict = await checkConflict(
      calendarName,
      existing[0].room_id,
      start_time,
      end_time,
      id
    );
    if (isConflict)
      return res
        .status(409)
        .json({ message: "Gagal pindah jadwal: Bentrok!" });

    await db.query(
      "UPDATE events SET start_time = ?, end_time = ? WHERE id = ? AND calendar_name = ?",
      [start_time, end_time, id, calendarName]
    );
    res.json({ message: "Jadwal berhasil diupdate." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 4. Hapus Event
exports.deleteEvent = async (req, res) => {
  try {
    const { calendarName, id } = req.params;

    // ✅ CEK TIPE: Apakah reminder atau event biasa?
    const isReminder = id.startsWith('reminder-');
    const actualId = isReminder ? id.replace('reminder-', '') : id;

    if (isReminder) {
      // ✅ DELETE REMINDER
      const [reminder] = await db.query(
        "SELECT id FROM reminders WHERE id = ? AND calendar_name = ?",
        [actualId, calendarName]
      );
      if (reminder.length === 0)
        return res.status(404).json({ message: "Reminder not found" });

      await db.query("DELETE FROM reminders WHERE id = ? AND calendar_name = ?", [
        actualId,
        calendarName,
      ]);
      res.json({ message: "Reminder dihapus." });
    } else {
      // ✅ DELETE EVENT (EXISTING CODE)
      const [event] = await db.query(
        "SELECT poster_path FROM events WHERE id = ? AND calendar_name = ?",
        [actualId, calendarName]
      );
      if (event.length === 0)
        return res.status(404).json({ message: "Event not found" });

      if (event[0].poster_path) {
        const filePath = path.join(
          __dirname,
          "../../public",
          event[0].poster_path
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      await db.query("DELETE FROM events WHERE id = ? AND calendar_name = ?", [
        actualId,
        calendarName,
      ]);
      res.json({ message: "Event dihapus." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 5. API Cek Ketersediaan (Untuk AJAX Frontend)
exports.checkAvailability = async (req, res) => {
  try {
    const { room_id, start_time, end_time } = req.body;
    const calendarName = req.params.calendarName;

    // Cek apakah ruangan ada di kalender ini
    const [room] = await db.query(
      "SELECT * FROM rooms WHERE id = ? AND calendar_name = ?",
      [room_id, calendarName]
    );

    if (room.length === 0) {
      return res.status(404).json({ error: "Ruangan tidak ditemukan" });
    }

    // Cek setting double booking
    const [settings] = await db.query(
      "SELECT * FROM app_settings WHERE calendar_name = ?",
      [calendarName]
    );

    const allowDoubleBooking =
      settings.length > 0 ? settings[0].allow_double_booking : false;

    if (allowDoubleBooking) {
      return res.json({ available: true });
    }

    // Cek konflik jadwal di kalender ini
    const [conflicts] = await db.query(
      `SELECT * FROM events 
       WHERE calendar_name = ? AND room_id = ? 
       AND start_time < ? AND end_time > ?`,
      [calendarName, room_id, end_time, start_time]
    );

    res.json({ available: conflicts.length === 0 });
  } catch (error) {
    console.error("Error checking availability:", error);
    res.status(500).json({ error: "Gagal memeriksa ketersediaan" });
  }
};


// 6. Update Event Details
exports.updateEventDetails = async (req, res) => {
  try {
    const { calendarName, id } = req.params;

    // ✅ CEK TIPE: Apakah reminder atau event biasa?
    const isReminder = id.startsWith("reminder-");
    const actualId = isReminder ? id.replace("reminder-", "") : id;

    const {
      title,
      organizer_name,
      organizer_phone,
      pic_name,
      participants_count,
      notes,
      start_time,
      end_time,
      room_id,
      meeting_link,
      reminder_date, // ✅ TAMBAH
    } = req.body;

    if (isReminder) {
      // ✅ UPDATE REMINDER
      let updates = [];
      let values = [];

      if (title !== undefined) {
        updates.push("title = ?");
        values.push(title);
      }
      if (notes !== undefined) {
        updates.push("notes = ?");
        values.push(notes);
      }
      if (reminder_date !== undefined) {
        // ✅ TAMBAH: Handle update tanggal reminder
        updates.push("reminder_date = ?");
        values.push(reminder_date);
      }

      if (updates.length === 0) {
        return res
          .status(400)
          .json({ message: "Tidak ada data yang diupdate" });
      }

      values.push(actualId, calendarName);
      const sql = `UPDATE reminders SET ${updates.join(
        ", "
      )} WHERE id = ? AND calendar_name = ?`;

      await db.query(sql, values);
      res.json({ message: "Pengingat berhasil diupdate" });
    } else {
      // ✅ UPDATE EVENT (EXISTING CODE)
      // Build dynamic update query
      let updates = [];
      let values = [];

      if (title !== undefined) {
        updates.push("title = ?");
        values.push(title);
      }
      if (organizer_name !== undefined) {
        updates.push("organizer_name = ?");
        values.push(organizer_name);
      }
      if (organizer_phone !== undefined) {
        updates.push("organizer_phone = ?");
        values.push(organizer_phone);
      }
      if (pic_name !== undefined) {
        updates.push("pic_name = ?");
        values.push(pic_name);
      }
      if (participants_count !== undefined) {
        updates.push("participants_count = ?");
        values.push(participants_count);
      }
      if (notes !== undefined) {
        updates.push("notes = ?");
        values.push(notes);
      }
      if (meeting_link !== undefined) {
        updates.push("meeting_link = ?");
        values.push(meeting_link);
      }
      if (start_time !== undefined) {
        updates.push("start_time = ?");
        values.push(start_time);
      }
      if (end_time !== undefined) {
        updates.push("end_time = ?");
        values.push(end_time);
      }
      if (room_id !== undefined) {
        updates.push("room_id = ?");
        values.push(room_id);
      }

      if (updates.length === 0) {
        return res
          .status(400)
          .json({ message: "Tidak ada data yang diupdate" });
      }

      // ✅ Jika waktu atau room diubah, cek konflik jadwal
      if (
        start_time !== undefined ||
        end_time !== undefined ||
        room_id !== undefined
      ) {
        // Ambil data event asli
        const [existing] = await db.query(
          "SELECT room_id, start_time, end_time FROM events WHERE id = ? AND calendar_name = ?",
          [actualId, calendarName]
        );

        if (existing.length > 0) {
          const finalRoomId = room_id !== undefined ? room_id : existing[0].room_id;
          const finalStartTime = start_time !== undefined ? start_time : existing[0].start_time;
          const finalEndTime = end_time !== undefined ? end_time : existing[0].end_time;

          // Cek konflik
          const isConflict = await checkConflict(
            calendarName,
            finalRoomId,
            finalStartTime,
            finalEndTime,
            actualId
          );

          if (isConflict) {
            return res
              .status(409)
              .json({
                message: "Gagal update: Jadwal bentrok dengan event lain!",
              });
          }
        }
      }

      values.push(actualId, calendarName);
      const sql = `UPDATE events SET ${updates.join(
        ", "
      )} WHERE id = ? AND calendar_name = ?`;

      await db.query(sql, values);
      res.json({ message: "Data berhasil diupdate" });
    }
  } catch (err) {
    console.error("Error updating event details:", err);
    res.status(500).json({ error: err.message });
  }
};
// 7. Upload/Update Poster Event
exports.uploadPoster = async (req, res) => {
  try {
    const { calendarName, id } = req.params;

    // Cek event ada atau tidak dan pastikan calendar benar
    const [eventRows] = await db.query(
      "SELECT poster_path FROM events WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );
    if (eventRows.length === 0)
      return res.status(404).json({ message: "Event tidak ditemukan" });

    // Hapus poster lama jika ada
    const oldPoster = eventRows[0].poster_path;
    if (oldPoster) {
      const oldPath = path.join(__dirname, "../../public", oldPoster);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Simpan poster baru
    const poster_path = req.file ? `/uploads/${req.file.filename}` : null;
    if (!poster_path)
      return res.status(400).json({ message: "File poster tidak ditemukan" });

    await db.query(
      "UPDATE events SET poster_path = ? WHERE id = ? AND calendar_name = ?",
      [poster_path, id, calendarName]
    );
    res.json({ poster_path });
  } catch (err) {
    res.status(500).json({ message: "Gagal upload poster" });
  }
};
