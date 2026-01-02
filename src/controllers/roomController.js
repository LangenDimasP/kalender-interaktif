const db = require("../../config/db");

// 1. Ambil Semua Ruangan
exports.getAllRooms = async (req, res) => {
  try {
    const calendarName = req.params.calendarName;
    const [rooms] = await db.query(
      "SELECT * FROM rooms WHERE calendar_name = ? ORDER BY display_order ASC, id ASC",
      [calendarName]
    );
    res.json(rooms);
  } catch (error) {
    console.error("Error fetching rooms:", error);
    res.status(500).json({ error: "Gagal mengambil data ruangan" });
  }
};

// ✅ PERBAIKI: CREATE ROOM - Validasi warna duplikat dari database
exports.createRoom = async (req, res) => {
  try {
    const { name, capacity, color } = req.body;
    const calendarName = req.params.calendarName;

    // Validasi input dasar
    if (!name || !capacity || !color) {
      return res.status(400).json({ error: "Data tidak lengkap" });
    }

    // ✅ CEK: Nama ruangan sudah ada?
    const [existingName] = await db.query(
      "SELECT id FROM rooms WHERE calendar_name = ? AND name = ?",
      [calendarName, name]
    );

    if (existingName.length > 0) {
      return res.status(400).json({ error: "Nama ruangan sudah ada di kalender ini" });
    }

    // ✅ TAMBAH: CEK WARNA DUPLIKAT DARI DATABASE
    const [existingColor] = await db.query(
      "SELECT id, name FROM rooms WHERE calendar_name = ? AND LOWER(color) = LOWER(?)",
      [calendarName, color]
    );

    if (existingColor.length > 0) {
      return res.status(400).json({ 
        error: `❌ Warna ini sudah digunakan oleh ruangan "${existingColor[0].name}"!` 
      });
    }

    // ✅ Hitung display_order baru (maksimal + 1)
    const [maxOrder] = await db.query(
      "SELECT MAX(display_order) as max_order FROM rooms WHERE calendar_name = ?",
      [calendarName]
    );
    const newOrder = (maxOrder[0].max_order || 0) + 1;

    // ✅ INSERT ruangan baru
    await db.query(
      "INSERT INTO rooms (calendar_name, name, capacity, color, display_order) VALUES (?, ?, ?, ?, ?)",
      [calendarName, name, capacity, color, newOrder]
    );

    res.json({ message: "✅ Ruangan berhasil ditambahkan" });
  } catch (error) {
    console.error("Error creating room:", error);
    res.status(500).json({ error: "Gagal membuat ruangan" });
  }
};

// ✅ PERBAIKI: UPDATE ROOM - Validasi warna duplikat dari database
exports.updateRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const calendarName = req.params.calendarName;
    const { name, capacity, color } = req.body;

    // Validasi input
    if (!name || !capacity || !color) {
      return res.status(400).json({ error: "Data tidak lengkap" });
    }

    // Cek ruangan exist
    const [room] = await db.query(
      "SELECT * FROM rooms WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );

    if (room.length === 0) {
      return res.status(404).json({ error: "Ruangan tidak ditemukan" });
    }

    // ✅ CEK: Nama baru tidak duplikat (kecuali nama yang sama)
    const [existingName] = await db.query(
      "SELECT id FROM rooms WHERE calendar_name = ? AND name = ? AND id != ?",
      [calendarName, name, id]
    );

    if (existingName.length > 0) {
      return res.status(400).json({ error: "Nama ruangan sudah ada" });
    }

    // ✅ TAMBAH: CEK WARNA TIDAK DUPLIKAT (kecuali warna yang sama)
    const [existingColor] = await db.query(
      "SELECT id, name FROM rooms WHERE calendar_name = ? AND LOWER(color) = LOWER(?) AND id != ?",
      [calendarName, color, id]
    );

    if (existingColor.length > 0) {
      return res.status(400).json({ 
        error: `❌ Warna ini sudah digunakan oleh ruangan "${existingColor[0].name}"!` 
      });
    }

    // Update ruangan
    await db.query(
      "UPDATE rooms SET name = ?, capacity = ?, color = ? WHERE id = ? AND calendar_name = ?",
      [name, capacity, color, id, calendarName]
    );

    res.json({ message: "✅ Ruangan berhasil diperbarui" });
  } catch (error) {
    console.error("Error updating room:", error);
    res.status(500).json({ error: "Gagal memperbarui ruangan" });
  }
};

// 3. Hapus Ruangan (Delete)
exports.deleteRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const calendarName = req.params.calendarName;

    // Cek ruangan milik kalender ini
    const [room] = await db.query(
      "SELECT * FROM rooms WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );

    if (room.length === 0) {
      return res.status(404).json({ error: "Ruangan tidak ditemukan" });
    }

    // Hapus semua events di ruangan ini
    await db.query("DELETE FROM events WHERE room_id = ?", [id]);

    // Hapus ruangan
    await db.query("DELETE FROM rooms WHERE id = ? AND calendar_name = ?", [
      id,
      calendarName,
    ]);

    res.json({ message: "✅ Ruangan berhasil dihapus" });
  } catch (error) {
    console.error("Error deleting room:", error);
    res.status(500).json({ error: "Gagal menghapus ruangan" });
  }
};

// 4. Move Room Up
exports.moveRoomUp = async (req, res) => {
  try {
    const { id } = req.params;
    const calendarName = req.params.calendarName;

    // ✅ Ambil room yang ingin dinaikkan
    const [currentRoom] = await db.query(
      "SELECT * FROM rooms WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );

    if (currentRoom.length === 0) {
      return res.status(404).json({ error: "Ruangan tidak ditemukan" });
    }

    const room = currentRoom[0];
    const currentOrder = room.display_order;

    // ✅ Cari ruangan dengan display_order lebih kecil (tertinggi)
    const [prevRoom] = await db.query(
      "SELECT * FROM rooms WHERE calendar_name = ? AND display_order < ? ORDER BY display_order DESC LIMIT 1",
      [calendarName, currentOrder]
    );

    if (prevRoom.length === 0) {
      return res.status(400).json({ error: "Ruangan sudah di posisi teratas" });
    }

    const prevOrder = prevRoom[0].display_order;

    // ✅ SWAP display_order (tidak ubah ID!)
    await db.query(
      "UPDATE rooms SET display_order = ? WHERE id = ? AND calendar_name = ?",
      [prevOrder, id, calendarName]
    );

    await db.query(
      "UPDATE rooms SET display_order = ? WHERE id = ? AND calendar_name = ?",
      [currentOrder, prevRoom[0].id, calendarName]
    );

    res.json({ 
      success: true, 
      message: "✅ Urutan ruangan berhasil diubah" 
    });
  } catch (error) {
    console.error("Error moving room:", error);
    res.status(500).json({ error: "Gagal mengubah urutan ruangan" });
  }
};

// 5. Move Room Down
exports.moveRoomDown = async (req, res) => {
  try {
    const { id } = req.params;
    const calendarName = req.params.calendarName;

    // ✅ Ambil room yang ingin diturunkan
    const [currentRoom] = await db.query(
      "SELECT * FROM rooms WHERE id = ? AND calendar_name = ?",
      [id, calendarName]
    );

    if (currentRoom.length === 0) {
      return res.status(404).json({ error: "Ruangan tidak ditemukan" });
    }

    const room = currentRoom[0];
    const currentOrder = room.display_order;

    // ✅ Cari ruangan dengan display_order lebih besar (terendah)
    const [nextRoom] = await db.query(
      "SELECT * FROM rooms WHERE calendar_name = ? AND display_order > ? ORDER BY display_order ASC LIMIT 1",
      [calendarName, currentOrder]
    );

    if (nextRoom.length === 0) {
      return res.status(400).json({ error: "Ruangan sudah di posisi terbawah" });
    }

    const nextOrder = nextRoom[0].display_order;

    // ✅ SWAP display_order
    await db.query(
      "UPDATE rooms SET display_order = ? WHERE id = ? AND calendar_name = ?",
      [nextOrder, id, calendarName]
    );

    await db.query(
      "UPDATE rooms SET display_order = ? WHERE id = ? AND calendar_name = ?",
      [currentOrder, nextRoom[0].id, calendarName]
    );

    res.json({ 
      success: true, 
      message: "✅ Urutan ruangan berhasil diubah" 
    });
  } catch (error) {
    console.error("Error moving room:", error);
    res.status(500).json({ error: "Gagal mengubah urutan ruangan" });
  }
};