const db = require("./config/db");
const bcrypt = require("bcrypt");

async function setupDatabase() {
  try {
    console.log("🔄 Memulai Setup Database...");

    // Helper function to add column if not exists
    async function addColumnIfNotExists(table, column, definition) {
      try {
        await db.query(
          `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
        console.log(`✅ Kolom '${column}' ditambahkan ke tabel '${table}'`);
      } catch (err) {
        if (err.code === "ER_DUP_FIELDNAME") {
          console.log(`⏭️  Kolom '${column}' sudah ada di tabel '${table}'`);
        } else {
          throw err;
        }
      }
    }

    // Helper function to add unique constraint if not exists
    async function addUniqueConstraintIfNotExists(
      table,
      columns,
      constraintName
    ) {
      try {
        await db.query(
          `ALTER TABLE ${table} ADD UNIQUE KEY ${constraintName} (${columns})`
        );
        console.log(
          `✅ Constraint UNIQUE '${constraintName}' ditambahkan ke tabel '${table}'`
        );
      } catch (err) {
        if (
          err.code === "ER_DUP_KEYNAME" ||
          err.code === "ER_MULTIPLE_PRI_KEY"
        ) {
          console.log(
            `⏭️  Constraint UNIQUE '${constraintName}' sudah ada di tabel '${table}'`
          );
        } else {
          throw err;
        }
      }
    }

    // ===== 1. CALENDARS TABLE =====
    await db.query(`
            CREATE TABLE IF NOT EXISTS calendars (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                pin_hash VARCHAR(255),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_name (name)
            )
        `);
    console.log("✅ Tabel 'calendars' berhasil dibuat/diverifikasi");

    // ===== 2. ROOMS TABLE =====
    await db.query(`
            CREATE TABLE IF NOT EXISTS rooms (
                id INT AUTO_INCREMENT PRIMARY KEY,
                calendar_name VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                color VARCHAR(50) NOT NULL DEFAULT '#3b82f6',
                capacity INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (calendar_name) REFERENCES calendars(name) ON DELETE CASCADE,
                INDEX idx_calendar_name (calendar_name)
            )
        `);
    console.log("✅ Tabel 'rooms' berhasil dibuat/diverifikasi");

    // Tambah kolom jika belum ada
    await addColumnIfNotExists(
      "rooms",
      "created_at",
      "DATETIME DEFAULT CURRENT_TIMESTAMP"
    );

    // Tambah unique constraint untuk (calendar_name, name)
    await addUniqueConstraintIfNotExists(
      "rooms",
      "calendar_name, name",
      "uk_calendar_room_name"
    );

    // ===== 3. APP_SETTINGS TABLE =====
    await db.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                calendar_name VARCHAR(255) NOT NULL,
                allow_double_booking BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (calendar_name) REFERENCES calendars(name) ON DELETE CASCADE,
                UNIQUE KEY uk_calendar_setting (calendar_name),
                INDEX idx_calendar_name (calendar_name)
            )
        `);
    console.log("✅ Tabel 'app_settings' berhasil dibuat/diverifikasi");

    // Tambah kolom jika belum ada
    await addColumnIfNotExists(
      "app_settings",
      "created_at",
      "DATETIME DEFAULT CURRENT_TIMESTAMP"
    );

    // ===== 4. EVENTS TABLE =====
    await db.query(`
            CREATE TABLE IF NOT EXISTS events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                calendar_name VARCHAR(255) NOT NULL,
                room_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                start_time DATETIME NOT NULL,
                end_time DATETIME NOT NULL,
                organizer_name VARCHAR(100),
                organizer_phone VARCHAR(20),
                pic_name VARCHAR(100),
                participants_count INT DEFAULT 0,
                poster_path VARCHAR(255),
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (calendar_name) REFERENCES calendars(name) ON DELETE CASCADE,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                INDEX idx_calendar_name (calendar_name),
                INDEX idx_room_id (room_id),
                INDEX idx_start_time (start_time),
                INDEX idx_end_time (end_time)
            )
        `);
    console.log("✅ Tabel 'events' berhasil dibuat/diverifikasi");

    // Tambah kolom jika belum ada
    await addColumnIfNotExists(
      "events",
      "created_at",
      "DATETIME DEFAULT CURRENT_TIMESTAMP"
    );

    // ===== 5. REMINDERS TABLE (BARU) =====
    await db.query(`
            CREATE TABLE IF NOT EXISTS reminders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                calendar_name VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                reminder_date DATE NOT NULL,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (calendar_name) REFERENCES calendars(name) ON DELETE CASCADE,
                INDEX idx_calendar_name (calendar_name),
                INDEX idx_reminder_date (reminder_date)
            )
        `);
    console.log("✅ Tabel 'reminders' berhasil dibuat/diverifikasi");

    console.log("\n✅ Semua Tabel Berhasil Dibuat/Diperbarui\n");

    // ===== 6. SEED DATA =====
    const [calendars] = await db.query(
      "SELECT * FROM calendars WHERE name = 'main'"
    );

    if (calendars.length === 0) {
      const defaultPin = "1234";
      const hashedPin = await bcrypt.hash(defaultPin, 10);
      await db.query("INSERT INTO calendars (name, pin_hash) VALUES (?, ?)", [
        "main",
        hashedPin,
      ]);
      console.log("🌱 Kalender default 'main' berhasil dibuat (PIN: 1234)");
    } else {
      console.log("⏭️  Kalender 'main' sudah ada");
    }

    // Seed Rooms untuk kalender 'main'
    const [existingRooms] = await db.query(
      "SELECT COUNT(*) as count FROM rooms WHERE calendar_name = 'main'"
    );

    if (existingRooms[0].count === 0) {
      const sqlInsert = `
                INSERT INTO rooms (calendar_name, name, color, capacity) 
                VALUES (?, ?, ?, ?)
            `;
      const roomsData = [
        ["main", "AULA PDS HB JASSIN", "#3b82f6", 100],
        ["main", "RUANG RAPAT KECIL", "#10b981", 15],
        ["main", "RUANG PODCAST", "#ef4444", 5],
      ];

      for (const room of roomsData) {
        await db.query(sqlInsert, room);
      }
      console.log(
        "🌱 3 Ruangan default berhasil ditambahkan ke kalender 'main'"
      );
    } else {
      console.log(`⏭️  Ruangan untuk kalender 'main' sudah ada`);
    }

    // Seed Settings untuk kalender 'main'
    const [existingSettings] = await db.query(
      "SELECT * FROM app_settings WHERE calendar_name = 'main'"
    );

    if (existingSettings.length === 0) {
      await db.query(
        "INSERT INTO app_settings (calendar_name, allow_double_booking) VALUES (?, ?)",
        ["main", false]
      );
      console.log("🌱 Setting default untuk kalender 'main' berhasil dibuat");
    } else {
      console.log("⏭️  Setting untuk kalender 'main' sudah ada");
    }

    console.log("\n🚀 Setup Database Selesai!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 Ringkasan:");
    console.log("  • Tabel: calendars, rooms, events, app_settings, reminders");
    console.log("  • Kalender default: 'main'");
    console.log("  • PIN default: 1234");
    console.log("  • Ruangan default: 3 buah");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error Setup Database:");
    console.error(`   ${error.message}`);
    console.error(`   Code: ${error.code}`);
    process.exit(1);
  }
}

setupDatabase();