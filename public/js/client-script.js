let calendar;
let currentEventId = null;
let activeRoomFilter = "all";
let roomsCache = [];
let currentEditMode = null;
let editData = {};
let currentToast = null; 

let currentDocumentations = [];
let currentDocumentationIndex = 0;

let upcomingEventsData = [];
let currentEventFilter = 'today';
let updateUpcomingEventsTimeout;

let currentAddTab = 'event';


window.checkQuickAddConflict = async function(formId) {
  const form = document.getElementById(formId);
  if (!formId || !form) {
    console.warn(`⚠️ Form dengan ID '${formId}' tidak ditemukan`);
    return;
  }

  // Tentukan ID warning berdasarkan form
  let warningId;
  if (formId === 'quickAddEventForm') {
    warningId = 'quickAddEventConflictWarning';
  } else if (formId === 'bookingForm') {
    warningId = 'bookingFormConflictWarning';
  } else if (formId === 'addEventFormTabs') {
    warningId = 'addEventTabsConflictWarning';
  } else {
    return;
  }

  const roomId = form.querySelector('select[name="quick_room_id"]')?.value || 
                 form.querySelector('select[name="room_id"]')?.value;
  const eventDate = form.querySelector('input[name="quick_event_date"]')?.value || 
                    form.querySelector('input[name="event_date"]')?.value;
  const startTime = form.querySelector('input[name="quick_start_time"]')?.value || 
                    form.querySelector('input[name="start_time_only"]')?.value;
  const endTime = form.querySelector('input[name="quick_end_time"]')?.value || 
                  form.querySelector('input[name="end_time_only"]')?.value;
  const warningEl = document.getElementById(warningId);

  if (!warningEl) {
    console.warn(`⚠️ Warning element dengan ID '${warningId}' tidak ditemukan`);
    return;
  }

  // Jika field belum lengkap, sembunyikan warning
  if (!roomId || !eventDate || !startTime || !endTime) {
    warningEl.classList.add('hidden');
    return;
  }

  // Cek apakah double booking diizinkan
  try {
    const settingsRes = await fetch(`/${calendarName}/settings`);
    const settings = await settingsRes.json();

    // Jika double booking diizinkan, jangan tampilkan warning
    if (settings.allow_double_booking) {
      warningEl.classList.add('hidden');
      return;
    }

    // Cek ketersediaan ruangan
    const startDateTime = `${eventDate}T${startTime}:00`;
    const endDateTime = `${eventDate}T${endTime}:00`;

    const res = await fetch(`/${calendarName}/check-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: roomId,
        start_time: startDateTime,
        end_time: endDateTime,
      }),
    });

    const data = await res.json();

    if (!data.available) {
      // Ada konflik, tampilkan warning
      warningEl.classList.remove('hidden');
      console.log(`⚠️ KONFLIK: Ruangan ${roomId} tidak tersedia`);
    } else {
      // Tidak ada konflik, sembunyikan warning
      warningEl.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error checking conflict:', err);
    warningEl.classList.add('hidden');
  }
};

window.openAddModalTabs = function() {
  document.getElementById('addModalTabs').classList.remove('hidden');
  const today = new Date().toISOString().split('T')[0];
  
  // Set default tanggal di form event
  const eventDateInput = document.querySelector('#tab-content-event input[name="event_date"]');
  if (eventDateInput) eventDateInput.value = today;
  
  // Set default tanggal di form reminder
  const reminderDateInput = document.querySelector('#tab-content-reminder input[name="reminder_date"]');
  if (reminderDateInput) reminderDateInput.value = today;
  
  // ✅ TAMBAH: Set default tanggal di form holiday
  const holidayDateInput = document.querySelector('#tab-content-holiday input[name="holiday_date"]');
  if (holidayDateInput) holidayDateInput.value = today;
  
  // Populate room select
  const roomSelect = document.querySelector('#tab-content-event select[name="room_id"]');
  if (roomSelect && roomsCache.length > 0) {
    roomSelect.innerHTML = '<option value="">-- Pilih Ruangan --</option>';
    roomsCache.forEach(room => {
      roomSelect.innerHTML += `<option value="${room.id}">${room.name} (Kap: ${room.capacity})</option>`;
    });
  }
  
  // Reset forms
  document.getElementById('addEventFormTabs')?.reset();
  document.getElementById('addReminderFormTabs')?.reset();
  document.getElementById('addRoomFormTabs')?.reset();
  document.getElementById('addHolidayFormTabs')?.reset(); // ✅ TAMBAH
  
  // Set tanggal lagi setelah reset
  if (eventDateInput) eventDateInput.value = today;
  if (reminderDateInput) reminderDateInput.value = today;
  if (holidayDateInput) holidayDateInput.value = today; // ✅ TAMBAH
};

window.closeAddModalTabs = function() {
  document.getElementById('addModalTabs').classList.add('hidden');
  currentAddTab = 'event';
};

window.switchTab = function(tabName) {
  currentAddTab = tabName;
  
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.add('hidden');
  });
  
  // Remove active dari semua buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active', 'border-b-4', 'border-blue-400', 'text-blue-600');
    btn.classList.add('border-transparent', 'text-gray-600');
  });
  
  // Show selected tab
  const contentEl = document.getElementById(`tab-content-${tabName}`);
  if (contentEl) {
    contentEl.classList.remove('hidden');
  }
  
  // Highlight selected button - TAMBAHKAN CLASS 'active'
  const activeBtn = document.getElementById(`tab-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'border-b-4', 'border-blue-400', 'text-blue-600');
    activeBtn.classList.remove('border-transparent', 'text-gray-600');
  }
};

document.getElementById('submitAddBtn').addEventListener('click', async function() {
  const activeTab = document.querySelector('.tab-btn.active')?.id || 'tab-event';

  if (activeTab === 'tab-event') {
    await submitEventFormTabs();
  } else if (activeTab === 'tab-reminder') {
    await submitReminderFormTabs();
  } else if (activeTab === 'tab-room') {
    await submitRoomFormTabs();
  } else if (activeTab === 'tab-holiday') {
    // ✅ TAMBAH: Handle holiday form
    await submitHolidayFormTabs();
  }
});
async function submitHolidayFormTabs() {
  const form = document.getElementById('addHolidayFormTabs');
  const title = form.querySelector('input[name="title"]').value.trim();
  const holidayDate = form.querySelector('input[name="holiday_date"]').value;

  if (!title || !holidayDate) {
    showToast('Nama hari libur dan tanggal wajib diisi', 'error');
    return;
  }

  const btn = document.getElementById('submitAddBtn');
  const originalText = btn.innerText;
  btn.innerText = '<i class="fas fa-spinner fa-spin"></i> Membuat...';
  btn.disabled = true;

  try {
    const year = new Date(holidayDate).getFullYear();

    const res = await fetch(`/${calendarName}/holidays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: year,
        holidays: [
          {
            title: title,
            date: holidayDate,
            keterangan: title
          }
        ]
      })
    });

    const result = await res.json();
    if (res.ok) {
      // ✅ TAMBAH: Langsung tambah event ke calendar tanpa tunggu refetch
      const newId = result.id || `holiday-${year}-${Date.now()}`;
      
      calendar.addEvent({
        id: newId,
        title: title,
        start: holidayDate,
        allDay: true,
        backgroundColor: "#dc2626",
        borderColor: "#dc2626",
        textColor: "#fff",
        editable: false,
        extendedProps: {
          isHoliday: true,
          keterangan: title,
        },
      });

      showToast('Hari libur berhasil dibuat!', 'success');
      closeAddModalTabs();
      form.reset();
      
      // ✅ BARU: Refetch untuk sinkronisasi dengan data terbaru (optional, tapi aman)
      setTimeout(() => {
        calendar.refetchEvents();
      }, 500);
    } else {
      showToast(result.error || result.message || 'Gagal membuat hari libur', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan sistem', 'error');
    console.error(err);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}
// ===== SUBMIT ROOM FORM (PERBAIKAN) =====
async function submitRoomForm() {
  const form = document.getElementById('addRoomFormModal');
  const name = form.querySelector('input[name="name"]').value.trim();
  const capacity = form.querySelector('input[name="capacity"]').value.trim();
  const colorInput = form.querySelector('input[name="color"]');
  const color = colorInput.value.trim();

  // Validasi standar
  if (!name || name.length === 0) {
    showToast('❌ Nama ruangan harus diisi', 'error');
    return;
  }

  if (!capacity || capacity.length === 0 || parseInt(capacity) <= 0) {
    showToast('❌ Kapasitas harus diisi dengan angka positif', 'error');
    return;
  }

  if (!color || color.length === 0) {
    showToast('❌ Warna ruangan harus dipilih', 'error');
    return;
  }

  // ✅ TAMBAH: Validasi warna unik
  if (!validateRoomColor(colorInput)) {
    showToast('❌ Warna ruangan sudah digunakan oleh ruangan lain!', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/${calendarName}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        capacity: parseInt(capacity),
        color
      })
    });

    const data = await response.json();

    if (response.ok) {
      showToast('✅ Ruangan berhasil ditambahkan!', 'success');
      form.reset();
      closeAddModalTabs();
      await loadRooms();
    } else {
      showToast(data.error || 'Gagal menambahkan ruangan', 'error');
    }
  } catch (error) {
    console.error('Error adding room:', error);
    showToast('❌ Terjadi kesalahan saat menambahkan ruangan', 'error');
  }
}
let highlightedRoomId = null;
let highlightTimer = null;

window.highlightRoom = function(roomId) {
  
  if (highlightTimer) clearTimeout(highlightTimer);

  highlightedRoomId = roomId;
  calendar.refetchEvents(); // Trigger re-render dengan state baru
  
  // Auto-reset setelah 3 detik
  highlightTimer = setTimeout(() => {
    highlightedRoomId = null;
    calendar.refetchEvents();
  }, 3000);
};

function renderRoomLegend() {
  const legendEl = document.getElementById('roomLegend');
  const listEl = document.getElementById('roomLegendList');
  
  if (!legendEl || !listEl) return;
  
  if (roomsCache.length === 0) {
    legendEl.classList.add('hidden');
    return;
  }
  
  legendEl.classList.remove('hidden');
  
  // Ruangan
  let html = roomsCache.map(room => `
    <div class="flex items-center gap-2 p-2 bg-white rounded-md hover:bg-gray-100 transition cursor-pointer" onclick="highlightRoom('${room.id}')">
      <div class="w-3 h-3 rounded-full shadow-sm" style="background-color: ${room.color};"></div>
      <span class="text-xs font-semibold text-gray-700 truncate">${room.name}</span>
    </div>
  `).join('');

  // Tambahkan legend untuk Holidays dan Reminders
  html += `
    <div class="flex items-center gap-2 p-2 bg-white rounded-md">
      <div class="w-3 h-3 rounded-full shadow-sm" style="background-color: #dc2626;"></div>
      <span class="text-xs font-semibold text-red-700 truncate">Hari Libur</span>
    </div>
    <div class="flex items-center gap-2 p-2 bg-white rounded-md">
      <div class="w-3 h-3 rounded-full shadow-sm" style="background-color: #a78bfa;"></div>
      <span class="text-xs font-semibold text-purple-700 truncate">Pengingat</span>
    </div>
  `;

  listEl.innerHTML = html;
}


  async function loadRooms() {
    try {
      const res = await fetch(`/${calendarName}/rooms`);

      // Cek apakah response OK
      if (!res.ok) {
        console.error(`Error loading rooms: ${res.status} ${res.statusText}`);
        showToast("Gagal memuat daftar ruangan", "error");
        roomsCache = [];
        return;
      }

      const rooms = await res.json();

      // Validasi response adalah array
      if (!Array.isArray(rooms)) {
        console.error("Response rooms bukan array:", rooms);
        showToast("Format data ruangan tidak valid", "error");
        roomsCache = [];
        return;
      }

      roomsCache = rooms;

      // Dropdown filter
      const dropdown = document.getElementById("roomFilterDropdown");
      if (dropdown) {
        // Reset options
        dropdown.innerHTML = `<option value="all" data-color="#60a5fa">Semua Ruangan</option>`;
        rooms.forEach((room) => {
          dropdown.innerHTML += `<option value="${room.id}" data-color="${room.color}">${room.name}</option>`;
        });

        // Gunakan .onchange langsung (otomatis menimpa listener lama, jadi aman)
        dropdown.onchange = function () {
          setDropdownColor();
          window.applyFilter(this.value);
        };

        // PENTING: Set value dulu sesuai filter aktif, BARU set warnanya
        dropdown.value = activeRoomFilter;

        // Update tampilan warna
        setDropdownColor();
      }

      // Untuk select booking
      const select = document.getElementById("roomSelect");
      if (select) {
        select.innerHTML = '<option value="">-- Pilih Ruangan --</option>';
        rooms.forEach((room) => {
          select.innerHTML += `<option value="${room.id}">${room.name} (Kap: ${room.capacity})</option>`;
        });
      }
    } catch (err) {
      console.error("Gagal load rooms:", err);
      showToast("Terjadi kesalahan saat memuat ruangan", "error");
      roomsCache = [];
    }
    renderRoomLegend();
  }

  function setDropdownColor() {
    const dropdown = document.getElementById("roomFilterDropdown");
    if (!dropdown) return;
    const selected = dropdown.options[dropdown.selectedIndex];
    const color = selected.getAttribute("data-color") || "#60a5fa";

    // Hanya ubah border, background tetap putih
    dropdown.style.backgroundColor = "white";
    dropdown.style.borderColor = color;
    dropdown.style.borderWidth = "2px";
    dropdown.style.color = "#1f2937"; // Teks hitam
  }

  // Utility agar teks tetap terbaca (putih/hitam)
  function getContrastYIQ(hexcolor) {
    hexcolor = hexcolor.replace("#", "");
    if (hexcolor.length === 3)
      hexcolor = hexcolor
        .split("")
        .map((x) => x + x)
        .join("");
    var r = parseInt(hexcolor.substr(0, 2), 16);
    var g = parseInt(hexcolor.substr(2, 2), 16);
    var b = parseInt(hexcolor.substr(4, 2), 16);
    var yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? "#222" : "#fff";
  }

  // Utility untuk membuat warna lebih muda (lighter)
  function lightenColor(hexColor, percent = 40) {
    const num = parseInt(hexColor.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00ff) + amt);
    const B = Math.min(255, (num & 0x0000ff) + amt);
    return (
      "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)
    );
  }



// ✅ TAMBAH: Navigasi slider
window.nextDocumentation = function () {
  if (currentDocumentations.length === 0) return;
  currentDocumentationIndex = (currentDocumentationIndex + 1) % currentDocumentations.length;
  renderCurrentDocumentation();
  renderDocumentationIndicators();
};

window.prevDocumentation = function () {
  if (currentDocumentations.length === 0) return;
  currentDocumentationIndex =
    (currentDocumentationIndex - 1 + currentDocumentations.length) % currentDocumentations.length;
  renderCurrentDocumentation();
  renderDocumentationIndicators();
};

window.goToDocumentation = function (index) {
  if (index >= 0 && index < currentDocumentations.length) {
    currentDocumentationIndex = index;
    renderCurrentDocumentation();
    renderDocumentationIndicators();
  }
};

// ✅ TAMBAH: Open/Close upload form
window.openDocumentationUpload = function () {
  const fileInput = document.getElementById("documentationFileInput");
  const form = document.getElementById("documentationUploadForm");
  
  if (!fileInput) {
    console.error("❌ File input tidak ditemukan");
    return;
  }
  
  // Reset value dulu
  fileInput.value = "";
  
  // Tampilkan form upload
  if (form) {
    form.classList.remove("hidden");
  }
  
  // Trigger click untuk buka file picker
  fileInput.click();
};

window.resetDocumentationUploadForm = function () {
  const input = document.getElementById("documentationFileInput");
  const btn = document.getElementById("btnDocumentationUpload");
  
  if (input) input.value = "";
  if (btn) btn.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Upload';
};

// ===== GUNAKAN HANYA INI - Single event listener untuk toggleDoubleBooking =====
document.addEventListener('DOMContentLoaded', function() {
  const toggleDoubleBooking = document.getElementById('toggleDoubleBooking');
  
  if (toggleDoubleBooking) {
    // ✅ PENTING: removeEventListener dulu untuk hindari duplikat
    toggleDoubleBooking.removeEventListener('change', handleToggleDoubleBooking);
    
    // ✅ Tambah event listener SEKALI SAJA
    toggleDoubleBooking.addEventListener('change', handleToggleDoubleBooking);
  }
});

// ✅ PERBAIKI: Pisahkan ke function terpisah untuk mudah dikelola

async function handleToggleDoubleBooking() {
  const toggleDoubleBooking = document.getElementById('toggleDoubleBooking');
  const isEnabled = toggleDoubleBooking.checked;

  try {
    const res = await fetch(`/${calendarName}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allow: isEnabled // ✅ Ubah dari 'allow_double_booking' ke 'allow'
      })
    });

    const data = await res.json();

    if (res.ok) {
      const message = isEnabled 
        ? 'Jadwal bentrok diizinkan' 
        : 'Jadwal bentrok dilarang';

      // ✅ Gunakan mekanisme untuk menghapus toast sebelumnya
      if (currentToast) {
        currentToast.hideToast();
        currentToast = null;
      }

      currentToast = Toastify({
        text: `<div style="display: flex; align-items: center; gap: 12px; width: 100%;">
          <i class="fas fa-circle-check" style="font-size: 20px; flex-shrink: 0; color: #15803d;"></i>
          <span style="font-weight: 600; font-size: 14px; flex: 1; color: #15803d;">${message}</span>
          <button onclick="this.closest('.toastify').remove();" style="background: none; border: none; color: #15803d; cursor: pointer; font-size: 18px; padding: 0; margin: 0; display: flex; align-items: center;">
            <i class="fas fa-times"></i>
          </button>
        </div>`,
        duration: 4000,
        close: false,
        gravity: "top",
        position: "center",
        escapeMarkup: false,
        style: {
          background: "#dcfce7",
          border: "2px solid #86efac",
          borderRadius: "12px",
          padding: "16px 20px",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
          color: "#15803d",
          minWidth: "350px",
          maxWidth: "500px",
        },
        stopOnFocus: true,
        onClick: function () {},
      }).showToast();
    } else {
      toggleDoubleBooking.checked = !isEnabled;
      showToast(data.message || 'Gagal mengubah pengaturan', 'error');
    }
  } catch (err) {
    toggleDoubleBooking.checked = !isEnabled;
    showToast('Terjadi kesalahan sistem', 'error');
    console.error(err);
  }
}
document.addEventListener('DOMContentLoaded', function() {
  const fileInput = document.getElementById("documentationFileInput");
  
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      console.log('File input change event triggered');
      
      if (this.files.length > 0) {
        const file = this.files[0];
        console.log('File selected:', file.name, 'Size:', file.size);
        
        // Validasi ukuran (50MB)
        if (file.size > 50 * 1024 * 1024) {
          showToast("Ukuran file maksimal 50MB", "error");
          this.value = "";
          return;
        }
        
        // Validasi tipe file
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'];
        if (!allowedTypes.includes(file.type)) {
          showToast("Format file tidak didukung (JPG, PNG, GIF, MP4, WebM)", "error");
          this.value = "";
          return;
        }
        
        // Tampilkan form upload
        const form = document.getElementById("documentationUploadForm");
        const uploadBtn = document.getElementById("btnDocumentationUpload");
        
        if (form) {
          form.classList.remove("hidden");
          console.log('✅ Form upload ditampilkan');
          
          // ✅ TAMBAH: Scroll ke form agar terlihat
          setTimeout(() => {
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        } else {
          console.error('❌ Form upload tidak ditemukan');
        }
        
        // ✅ TAMBAH: Tampilkan nama file yang dipilih
        if (uploadBtn) {
          uploadBtn.innerHTML = `<i class="fas fa-check-circle mr-1"></i> Upload ${file.name}`;
          console.log('✅ Tombol upload diupdate:', uploadBtn.innerHTML);
        } else {
          console.error('❌ Tombol upload tidak ditemukan');
        }
        
        console.log('File ready to upload');
        
        // ✅ BARU: Auto-upload langsung setelah validasi
        submitDocumentationUpload();
      }
    });
  } else {
    console.warn("⚠️ documentationFileInput tidak ditemukan di HTML");
  }
});

window.cancelDocumentationUpload = function () {
  const form = document.getElementById("documentationUploadForm");
  const input = document.getElementById("documentationFileInput");
  
  if (form) form.classList.add("hidden");
  if (input) {
    input.value = "";
    // ✅ RESET tombol text
    const btn = document.getElementById("btnDocumentationUpload");
    if (btn) btn.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Upload';
  }
};
// ✅ TAMBAH: Upload dokumentasi
window.submitDocumentationUpload = async function () {
  if (!currentEventId) {
    showToast("Event tidak ditemukan", "error");
    return;
  }

  const fileInput = document.getElementById("documentationFileInput");
  if (!fileInput || fileInput.files.length === 0) {
    showToast("Pilih file terlebih dahulu", "error");
    return;
  }

  const file = fileInput.files[0];
  console.log('Uploading file:', file.name);

  // Validasi ukuran (50MB)
  if (file.size > 50 * 1024 * 1024) {
    showToast("Ukuran file maksimal 50MB", "error");
    return;
  }

  const formData = new FormData();
  formData.append("documentation", file);

  try {
    const res = await fetch(`/${calendarName}/events/${currentEventId}/documentations`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    console.log('Upload response:', data);

    if (res.ok && data.success) {
      showToast("✅ Dokumentasi berhasil diupload!", "success");
      
      currentDocumentations.push({
        id: data.id,
        file_path: data.file_path,
        file_type: data.file_type,
        file_name: data.file_name
      });
      
      currentDocumentationIndex = currentDocumentations.length - 1;
      
      renderCurrentDocumentation();
      renderDocumentationIndicators();
      // ✅ TAMBAH: Panggil ini juga
      updateDocumentationNavigation();
      
      resetDocumentationUploadForm();
    } else {
      showToast(data.message || "Gagal upload", "error");
    }
  } catch (err) {
    console.error('Upload error:', err);
    showToast("Terjadi kesalahan saat upload", "error");
  }
};

// ✅ TAMBAH: Update navigation buttons visibility
function updateDocumentationNavigation() {
  const prevBtn = document.getElementById("prevDocBtn");
  const nextBtn = document.getElementById("nextDocBtn");
  
  if (currentDocumentations.length <= 1) {
    // Sembunyikan arrows jika hanya 1 file atau kosong
    if (prevBtn) prevBtn.classList.add("hidden");
    if (nextBtn) nextBtn.classList.add("hidden");
  } else {
    // ✅ TAMPILKAN arrows jika lebih dari 1 file
    if (prevBtn) prevBtn.classList.remove("hidden");
    if (nextBtn) nextBtn.classList.remove("hidden");
  }
}

// ✅ PERBAIKI: renderCurrentDocumentation - Support video & gambar
function renderCurrentDocumentation() {
  if (currentDocumentations.length === 0) return;

  const doc = currentDocumentations[currentDocumentationIndex];
  const imgEl = document.getElementById("documentationImg");
  const videoEl = document.getElementById("documentationVideo");
  const fileNameEl = document.getElementById("documentationFileNameDisplay");
  
  // UPDATE COUNTER
  const counterEl = document.getElementById("docCounter");
  const totalEl = document.getElementById("docTotal");
  const badgeEl = document.getElementById("docCountBadge");
  
  if (counterEl) counterEl.textContent = currentDocumentationIndex + 1;
  if (totalEl) totalEl.textContent = currentDocumentations.length;
  if (badgeEl) badgeEl.textContent = currentDocumentations.length;

  // Sembunyikan keduanya dulu
  if (imgEl) imgEl.classList.add("hidden");
  if (videoEl) videoEl.classList.add("hidden");

  // Tampilkan sesuai tipe file
  if (doc.file_type === "image") {
    if (imgEl) {
      imgEl.src = doc.file_path;
      imgEl.classList.remove("hidden");
      imgEl.onclick = () => openDocumentationModal();
      imgEl.style.cursor = "pointer";
    }
  } else if (doc.file_type === "video") {
    if (videoEl) {
      videoEl.src = doc.file_path;
      videoEl.classList.remove("hidden");
    }
  }

  if (fileNameEl) {
    fileNameEl.textContent = doc.file_name || `File ${currentDocumentationIndex + 1}`;
  }
  
  // ✅ TAMBAH: Panggil ini setelah render
  updateDocumentationNavigation();
}

// ✅ PERBAIKI: renderDocumentationIndicators - Ganti dengan icons
function renderDocumentationIndicators() {
  const indicatorsEl = document.getElementById("documentationIndicators");
  if (!indicatorsEl) return;

  indicatorsEl.innerHTML = currentDocumentations
    .map((doc, idx) => `
      <button
        onclick="goToDocumentation(${idx})"
        class="w-3 h-3 rounded-full transition ${
          idx === currentDocumentationIndex 
            ? "bg-blue-500 shadow-lg" 
            : "bg-gray-300 hover:bg-gray-400"
        }"
        title="${doc.file_name}"
      ></button>
    `)
    .join("");
}

// ✅ PERBAIKI: Navigasi slider dengan render ulang
window.nextDocumentation = function () {
  if (currentDocumentations.length === 0) return;
  currentDocumentationIndex = (currentDocumentationIndex + 1) % currentDocumentations.length;
  renderCurrentDocumentation();
  renderDocumentationIndicators();
};

window.prevDocumentation = function () {
  if (currentDocumentations.length === 0) return;
  currentDocumentationIndex =
    (currentDocumentationIndex - 1 + currentDocumentations.length) % currentDocumentations.length;
  renderCurrentDocumentation();
  renderDocumentationIndicators();
};

window.goToDocumentation = function (index) {
  if (index >= 0 && index < currentDocumentations.length) {
    currentDocumentationIndex = index;
    renderCurrentDocumentation();
    renderDocumentationIndicators();
  }
};

// ✅ PERBAIKAN: deleteCurrentDocumentation - update empty state setelah delete
window.deleteCurrentDocumentation = async function () {
  if (currentDocumentations.length === 0) return;

  const doc = currentDocumentations[currentDocumentationIndex];

  const result = await Swal.fire({
    title: "Hapus Dokumentasi?",
    text: `${doc.file_name} akan dihapus`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#dc2626",
    cancelButtonColor: "#3b82f6",
    confirmButtonText: "Ya, Hapus!",
  });

  if (!result.isConfirmed) return;

  try {
    const res = await fetch(
      `/${calendarName}/events/${currentEventId}/documentations/${doc.id}`,
      { method: "DELETE" }
    );

    const data = await res.json();

    if (res.ok && data.success) {
      // Remove dari list
      currentDocumentations.splice(currentDocumentationIndex, 1);

      // Update index
      if (currentDocumentationIndex >= currentDocumentations.length) {
        currentDocumentationIndex = Math.max(0, currentDocumentations.length - 1);
      }

      // ✅ PERBAIKAN: Toggle content state ke empty state
      if (currentDocumentations.length === 0) {
        const docEmpty = document.getElementById("documentationEmpty");
        const docWithContent = document.getElementById("documentationWithContent");
        
        if (docEmpty && docWithContent) {
          docEmpty.classList.remove("hidden");
          docWithContent.classList.add("hidden");
        }
      } else {
        renderCurrentDocumentation();
        renderDocumentationIndicators();
      }

      // Update di calendar
      const event = calendar.getEventById(currentEventId);
      if (event) {
        event.setExtendedProp("documentations", currentDocumentations);
      }

      showToast("Dokumentasi dihapus", "success");
    } else {
      showToast(data.message || "Gagal hapus", "error");
    }
  } catch (err) {
    showToast("Terjadi kesalahan", "error");
    console.error(err);
  }
};

// ✅ TAMBAH: Function untuk generate summary text format
window.generateEventSummary = function() {
  const now = new Date();
  
  // ✅ PERBAIKI: Filter events sesuai currentEventFilter
  let filteredEvents = [];
  let summaryHeader = '';
  
  upcomingEventsData.forEach(event => {
    const eventDate = new Date(event.start);
    const isHoliday = event.extendedProps?.isHoliday;
    const isReminder = event.extendedProps?.isReminder;
    
    if (isHoliday || isReminder) return;

    let shouldInclude = false;

    if (currentEventFilter === 'today') {
      // Filter: Hari ini
      const isToday = eventDate.toDateString() === now.toDateString();
      shouldInclude = isToday;
    } else if (currentEventFilter === 'week') {
      // Filter: Minggu ini (7 hari ke depan dari hari ini)
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      shouldInclude = eventDate >= todayStart && eventDate <= weekFromNow;
    } else if (currentEventFilter === 'month') {
      // Filter: Bulan ini (30 hari ke depan dari hari ini)
      const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      shouldInclude = eventDate >= todayStart && eventDate <= monthFromNow;
    } else if (currentEventFilter === 'year') {
      // Filter: Tahun ini (365 hari ke depan dari hari ini)
      const yearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      shouldInclude = eventDate >= todayStart && eventDate <= yearFromNow;
    } else if (currentEventFilter === 'all') {
      // Filter: Semua event
      shouldInclude = true;
    }

    if (shouldInclude) {
      filteredEvents.push(event);
    }
  });

  // ✅ TAMBAH: Generate header sesuai filter
  if (currentEventFilter === 'today') {
    const todayDate = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    summaryHeader = `Agenda Hari Ini (${todayDate})`;
  } else if (currentEventFilter === 'week') {
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    
    const startStr = weekStart.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long'
    });
    const endStr = weekEnd.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    
    summaryHeader = `Agenda Minggu Ini (${startStr} - ${endStr})`;
  } else if (currentEventFilter === 'month') {
    const monthName = now.toLocaleDateString('id-ID', {
      month: 'long',
      year: 'numeric'
    });
    
    summaryHeader = `Agenda Bulan ${monthName}`;
  } else if (currentEventFilter === 'year') {
    const yearName = now.getFullYear();
    
    summaryHeader = `Agenda Tahun ${yearName}`;
  } else if (currentEventFilter === 'all') {
    summaryHeader = `Daftar Semua Agenda`;
  }

  // ✅ JIKA TIDAK ADA EVENT YANG COCOK
  if (filteredEvents.length === 0) {
    return `Assalamu'alaikum Wr Wb...\n\n${summaryHeader}\n\nTidak ada jadwal acara pada periode ini.\n\nSalam Literasi 👆menuju lima abad Jakarta 🤚`;
  }

  // ✅ SORT events berdasarkan filter
  if (currentEventFilter === 'today') {
    filteredEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  } else {
    filteredEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  let summaryText = `Assalamu'alaikum Wr Wb...\n\n${summaryHeader}\n\nMenginformasikan Agenda sbb :\n\n`;

  filteredEvents.forEach((event, index) => {
    const startTime = new Date(event.start).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const endTime = event.end 
      ? new Date(event.end).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      : 'selesai';

    // ✅ TAMBAH: Tampilkan tanggal event jika filter bukan 'today'
    let eventDateStr = '';
    if (currentEventFilter !== 'today') {
      const eventDate = new Date(event.start).toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      eventDateStr = `(${eventDate})\n`;
    }

    summaryText += `${index + 1}. ${event.title} ${eventDateStr}`;
    summaryText += `⏰ Waktu: ${startTime} - ${endTime}\n`;
    
    // ===== RUANGAN =====
    if (event.extendedProps?.room_name && event.extendedProps.room_name !== '-') {
      summaryText += `📍 Lokasi: ${event.extendedProps.room_name}\n`;
    }
    
    // ===== JUMLAH PESERTA =====
    if (event.extendedProps?.participants_count && event.extendedProps.participants_count !== '-' && event.extendedProps.participants_count > 0) {
      summaryText += `👥 Peserta: ${event.extendedProps.participants_count} orang\n`;
    }
    
    // ===== PENYELENGGARA =====
    if (event.extendedProps?.organizer_name && event.extendedProps.organizer_name !== '-') {
      summaryText += `🏢 Penyelenggara: ${event.extendedProps.organizer_name}\n`;
    }
    
    // ===== PIC =====
    if (event.extendedProps?.pic_name && event.extendedProps.pic_name !== '-') {
      summaryText += `👤 Penanggung Jawab: ${event.extendedProps.pic_name}\n`;
    }
    
    // ===== CATATAN =====
    if (event.extendedProps?.notes && event.extendedProps.notes !== '') {
      summaryText += `📝 Catatan: ${event.extendedProps.notes}\n`;
    }
    
    summaryText += `\n`;
  });

  summaryText += `* Mari kita jaga kebersihan demi kenyamanan dan kesehatan kita dan pemustaka Perpustakaan Jakarta dan PDS HB Jassin 🫶\n`;
  summaryText += `* Jangan lupa untuk selalu scan buku baca ditempat ya 🙏dan terapkan *standar layanan*🫰\n`;
  summaryText += `* Terima kasih, salam Literasi 👆menuju lima abad Jakarta 🤚\n`;
  summaryText += `* Semangaatt 💪💪`;

  return summaryText;
};

// ...existing code...


// ✅ TAMBAH: Open summary modal
window.openEventSummaryModal = function() {
  const modal = document.getElementById('eventSummaryModal');
  const summaryText = document.getElementById('summaryText');
  
  if (!modal || !summaryText) {
    console.error('❌ Modal atau elemen summary tidak ditemukan');
    return;
  }

  const summary = generateEventSummary();
  summaryText.value = summary;
  modal.classList.remove('hidden');
};

// ✅ TAMBAH: Close summary modal
window.closeEventSummaryModal = function() {
  const modal = document.getElementById('eventSummaryModal');
  if (modal) {
    modal.classList.add('hidden');
  }
};

// ✅ TAMBAH: Copy summary to clipboard
window.copySummaryToClipboard = function() {
  const summaryText = document.getElementById('summaryText');
  if (!summaryText) return;

  summaryText.select();
  document.execCommand('copy');
  showToast('Teks berhasil disalin ke clipboard!', 'success');
};

// ✅ TAMBAH: Download summary as text file
window.downloadSummaryAsFile = function() {
  const summaryText = document.getElementById('summaryText').value;
  const element = document.createElement('a');
  const file = new Blob([summaryText], { type: 'text/plain' });
  
  element.href = URL.createObjectURL(file);
  element.download = `agenda-${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  
  showToast('File berhasil diunduh!', 'success');
};

// ✅ TAMBAH: Clear summary text
window.clearSummaryText = function() {
  const summaryText = document.getElementById('summaryText');
  if (summaryText) {
    summaryText.value = '';
  }
};
// ✅ TAMBAH: Update character count saat modal dibuka
document.addEventListener('DOMContentLoaded', function() {
  const summaryText = document.getElementById('summaryText');
  
  if (summaryText) {
    summaryText.addEventListener('input', function() {
      const charCount = this.value.length;
      const lineCount = this.value.split('\n').length;
      
      const charCountEl = document.getElementById('charCount');
      const lineCountEl = document.getElementById('lineCount');
      
      if (charCountEl) charCountEl.textContent = charCount;
      if (lineCountEl) lineCountEl.textContent = lineCount;
    });
  }
});

// ✅ TAMBAH: Function khusus untuk delete holiday
window.deleteHoliday = async function (holidayId) {
  // HAPUS: Konfirmasi Swal.fire di sini

  try {
    // ✅ Ekstrak ID dari format "holiday-YYYY-ID"
    let actualId = holidayId;
    if (holidayId.startsWith('holiday-')) {
      actualId = holidayId.split('-').pop();
    }

    const res = await fetch(`/${calendarName}/holidays/${actualId}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showToast("Hari libur berhasil dihapus!", "success");
      // Hapus dari calendar
      const event = calendar.getEventById(holidayId);
      if (event) event.remove();
      closeDrawer();
      calendar.refetchEvents();
    } else {
      showToast(data.message || "Gagal hapus hari libur", "error");
    }
  } catch (err) {
    showToast("Terjadi kesalahan sistem", "error");
    console.error(err);
  }
};

async function submitEventFormTabs() {
  const form = document.getElementById('addEventFormTabs');
  const eventDate = form.querySelector('input[name="event_date"]').value;
  const startTime = form.querySelector('input[name="start_time_only"]').value;
  const endTime = form.querySelector('input[name="end_time_only"]').value;
  const title = form.querySelector('input[name="title"]').value;
  const roomId = form.querySelector('select[name="room_id"]').value;
  const participantsCount = parseInt(form.querySelector('input[name="participants_count"]')?.value) || 0;

  if (!eventDate || !startTime || !endTime || !title || !roomId) {
    showToast("Mohon isi semua field yang diperlukan", "error");
    return;
  }

  // ✅ Tambahkan validasi kapasitas peserta di sini
  if (participantsCount > 0) {
    const room = roomsCache.find(r => r.id == roomId);
    if (room && participantsCount > room.capacity) {
      showToast(`Jumlah peserta melebihi kapasitas ruangan! Maks: ${room.capacity} orang`, "error");
      return;
    }
  }

  if (new Date(`${eventDate}T${startTime}`) >= new Date(`${eventDate}T${endTime}`)) {
    showToast("Waktu selesai harus setelah waktu mulai", "error");
    return;
  }

  const formData = new FormData(form);
  formData.set("start_time", `${eventDate}T${startTime}:00`);
  formData.set("end_time", `${eventDate}T${endTime}:00`);
  formData.delete("event_date");
  formData.delete("start_time_only");
  formData.delete("end_time_only");

  const btn = document.getElementById('submitAddBtn');
  const originalText = btn.innerText;
  btn.innerText = '<i class="fas fa-spinner fa-spin"></i> Membuat...';
  btn.disabled = true;

  try {
    const res = await fetch(`/${calendarName}/events`, {
      method: "POST",
      body: formData
    });

    const result = await res.json();
    if (res.ok) {
      showToast("Event berhasil dibuat!", "success");
      closeAddModalTabs();
      calendar.refetchEvents();
      form.reset();
    } else {
      showToast(result.message || "Gagal membuat event", "error");
    }
  } catch (err) {
    showToast("Terjadi kesalahan sistem", "error");
    console.error(err);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

async function submitReminderFormTabs() {
  const form = document.getElementById('addReminderFormTabs');
  const title = form.querySelector('input[name="title"]').value;
  const reminderDate = form.querySelector('input[name="reminder_date"]').value;

  if (!title || !reminderDate) {
    showToast("Judul dan tanggal wajib diisi", "error");
    return;
  }

  const btn = document.getElementById('submitAddBtn');
  const originalText = btn.innerText;
  btn.innerText = '<i class="fas fa-spinner fa-spin"></i> Membuat...';
  btn.disabled = true;

  try {
    const res = await fetch(`/${calendarName}/reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        reminder_date: reminderDate,
        notes: form.querySelector('textarea[name="notes"]').value || ""
      })
    });

    const result = await res.json();
    if (res.ok) {
      showToast("Pengingat berhasil dibuat!", "success");
      closeAddModalTabs();
      calendar.refetchEvents();
      form.reset();
    } else {
      showToast(result.message || "Gagal membuat pengingat", "error");
    }
  } catch (err) {
    showToast("Terjadi kesalahan sistem", "error");
    console.error(err);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

window.validateRoomColor = function(colorInput) {
  const selectedColor = colorInput.value;
  const warningEl = document.getElementById('roomColorWarning') || createRoomColorWarning(colorInput);
  
  // Ambil semua warna yang sudah digunakan
  const usedColors = roomsCache.map(room => room.color.toLowerCase());
  
  if (usedColors.includes(selectedColor.toLowerCase())) {
    // Warna sudah digunakan
    warningEl.classList.remove('hidden');
    warningEl.innerHTML = `
      <i class="fas fa-exclamation-circle mr-2"></i>
      <span>Warna ini sudah digunakan oleh ruangan lain!</span>
    `;
    colorInput.style.borderColor = '#dc2626';
    colorInput.style.backgroundColor = '#fee2e2';
    return false;
  } else {
    // Warna belum digunakan
    warningEl.classList.add('hidden');
    colorInput.style.borderColor = '#e5e7eb';
    colorInput.style.backgroundColor = 'white';
    return true;
  }
};

// ✅ TAMBAH: Helper untuk buat warning element
function createRoomColorWarning(colorInput) {
  const warningEl = document.createElement('div');
  warningEl.id = 'roomColorWarning';
  warningEl.className = 'hidden mt-2 text-red-600 text-xs font-semibold flex items-center bg-red-50 p-2 rounded border border-red-200';
  
  if (colorInput && colorInput.parentElement) {
    colorInput.parentElement.appendChild(warningEl);
  }
  
  return warningEl;
}


async function submitRoomFormTabs() {
  const form = document.getElementById('addRoomFormTabs');
  const name = form.querySelector('input[name="name"]').value;
  const capacity = form.querySelector('input[name="capacity"]').value;
  const colorInput = form.querySelector('input[name="color"]');
  const color = colorInput.value;

  // ✅ VALIDASI STANDAR
  if (!name || name.length === 0) {
    showToast('Nama ruangan harus diisi', 'error');
    return;
  }

  if (!capacity || capacity.length === 0 || parseInt(capacity) <= 0) {
    showToast('Kapasitas harus diisi dengan angka positif', 'error');
    return;
  }

  if (!color || color.length === 0) {
    showToast('Warna ruangan harus dipilih', 'error');
    return;
  }

  // ✅ TAMBAH: Validasi warna unik
  if (!validateRoomColor(colorInput)) {
    showToast('Warna ruangan sudah digunakan oleh ruangan lain!', 'error');
    return;
  }

  const btn = document.getElementById('submitAddBtn');
  const originalText = btn.innerText;
  btn.innerText = '<i class="fas fa-spinner fa-spin"></i> Membuat...';
  btn.disabled = true;

  try {
    const res = await fetch(`/${calendarName}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, capacity, color })
    });

    const result = await res.json();
    if (res.ok) {
      showToast("Ruangan berhasil ditambahkan!", "success");
      closeAddModalTabs();
      loadRooms();
      calendar.refetchEvents();
      form.reset();
    } else {
      showToast(result.message || "Gagal membuat ruangan", "error");
    }
  } catch (err) {
    showToast("Terjadi kesalahan sistem", "error");
    console.error(err);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

window.openAddModal = function (dateStr) {
  const quickAddModal = document.getElementById("quickAddModal");
  if (quickAddModal) {
    quickAddModal.classList.remove("hidden");

    // === Tambahkan kode ini untuk populate ruangan ===
    const roomSelect = document.querySelector(
      '#quickAddModal select[name="quick_room_id"]'
    );
    if (roomSelect) {
      roomSelect.innerHTML = '<option value="">-- Pilih Ruangan --</option>';
      roomsCache.forEach((room) => {
        roomSelect.innerHTML += `<option value="${room.id}">${room.name} (Kap: ${room.capacity})</option>`;
      });
    }
    
    // ✅ PERBAIKI: Tambahkan definisi holidayDateInput
    const eventDateInput = document.querySelector(
      '#quickAddModal input[name="quick_event_date"]'
    );
    const reminderDateInput = document.querySelector(
      '#quickAddModal input[name="quick_reminder_date"]'
    );
    const holidayDateInput = document.querySelector(
      '#quickAddModal input[name="quick_holiday_date"]'
    );

    if (eventDateInput) eventDateInput.value = dateStr;
    if (reminderDateInput) reminderDateInput.value = dateStr;
    if (holidayDateInput) holidayDateInput.value = dateStr;  // ✅ Sekarang aman

    // Set waktu default untuk event
    const defaultTimeStart = "09:00";
    const defaultTimeEnd = "10:00";
    const startTimeEl = document.querySelector(
      '#quickAddModal input[name="quick_start_time"]'
    );
    const endTimeEl = document.querySelector(
      '#quickAddModal input[name="quick_end_time"]'
    );

    if (startTimeEl) startTimeEl.value = defaultTimeStart;
    if (endTimeEl) endTimeEl.value = defaultTimeEnd;

    // Reset forms
    const quickEventForm = document.getElementById("quickAddEventForm");
    const quickReminderForm = document.getElementById("quickAddReminderForm");
    if (quickEventForm) quickEventForm.reset();
    if (quickReminderForm) quickReminderForm.reset();

    // Set tanggal lagi setelah reset
    if (eventDateInput) eventDateInput.value = dateStr;
    if (reminderDateInput) reminderDateInput.value = dateStr;
    if (startTimeEl) startTimeEl.value = defaultTimeStart;
    if (endTimeEl) endTimeEl.value = defaultTimeEnd;

    // Switch ke tab event
    window.switchQuickAddTab("event");

    return;
  }
};

    // ✅ TAMBAH: Global function untuk validasi
    window.validateParticipantsCapacity = function() {
      const editParticipantsEl = document.getElementById("editParticipants");
      const warningEl = document.getElementById("detailParticipantsWarning");
      const editRoomSelect = document.getElementById("editRoomSelect");
      
      if (!editParticipantsEl || !warningEl) return;
      
      const roomId = editRoomSelect?.value || props.room_id;
      const participants = parseInt(editParticipantsEl.value) || 0;
      
      if (!roomId) return;
      
      const room = roomsCache.find(r => r.id == roomId);
      if (!room) return;
      
      if (participants > room.capacity) {
        warningEl.innerHTML = `
          <i class="fas fa-exclamation-circle mr-2"></i>
          Maks peserta: <strong>${room.capacity} orang</strong> (kapasitas ${room.name})
        `;
        warningEl.classList.remove("hidden");
      } else if (participants > 0) {
        warningEl.classList.add("hidden");
      }
    };

window.closeQuickAddModal = function () {
  const modal = document.getElementById("quickAddModal");
  if (modal) modal.classList.add("hidden");
};

window.switchQuickAddTab = function (tabName) {
  let currentQuickAddTab = tabName;

  // Hide all tabs
  document.querySelectorAll(".quick-add-tab-content").forEach((tab) => {
    tab.classList.add("hidden");
  });

  // Remove active dari semua buttons
  document.querySelectorAll(".quick-add-tab-btn").forEach((btn) => {
    btn.classList.remove(
      "border-b-4",
      "border-green-400",
      "border-purple-400",
      "text-blue-700",
      "text-blue-700"
    );
    btn.classList.add("border-transparent", "text-gray-600");
  });

  // Show selected tab
  const contentEl = document.getElementById(`quick-add-content-${tabName}`);
  if (contentEl) {
    contentEl.classList.remove("hidden");
  }

  // Highlight selected button
  const activeBtn = document.getElementById(`quick-add-tab-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.remove("border-transparent", "text-gray-600");

    if (tabName === "event") {
      activeBtn.classList.add("border-green-400", "text-green-600");
    } else if (tabName === "reminder") {
      activeBtn.classList.add("border-purple-400", "text-purple-600");
    }
  }
  
  // Store di window scope agar bisa diakses dari submitQuickAdd
  window.currentQuickAddTab = tabName;
};

window.submitQuickAdd = async function () {
  // ✅ PERBAIKI: Deteksi tab aktif dari tombol yang REALLY ACTIVE
  const activeTabBtn = document.querySelector('.quick-add-tab-btn[class*="active"]');
  
  let tabName = 'event'; // Default
  
  if (activeTabBtn) {
    const btnId = activeTabBtn.id;
    
    // Ekstrak tab name dari ID
    // ID format: "quick-add-tab-EVENT" atau "quick-add-tab-REMINDER" atau "quick-add-tab-HOLIDAY"
    if (btnId.includes('reminder')) {
      tabName = 'reminder';
    } else if (btnId.includes('holiday')) {
      tabName = 'holiday';
    } else if (btnId.includes('event')) {
      tabName = 'event';
    }
  }
  
  console.log('🔍 Active tab detected:', tabName, '| Button ID:', activeTabBtn?.id); // Debug
  
  if (tabName === "event") {
    await window.submitQuickAddEvent();
  } else if (tabName === "reminder") {
    await window.submitQuickAddReminder();
  } else if (tabName === "holiday") {
    await window.submitQuickAddHoliday();
  }
};


window.submitQuickAddHoliday = async function () {
  const form = document.getElementById("quickAddHolidayForm");
  if (!form) {
    console.error("❌ quickAddHolidayForm tidak ditemukan");
    return;
  }

  const title = form.querySelector('input[name="quick_holiday_name"]')?.value.trim();
  const holidayDate = form.querySelector('input[name="quick_holiday_date"]')?.value;

  console.log('🔍 Holiday form data:', { title, holidayDate }); // Debug

  if (!title || !holidayDate) {
    showToast("❌ Nama hari libur dan tanggal wajib diisi", "error");
    return;
  }

  const submitBtn = document.getElementById("quickAddSubmitBtn");
  if (!submitBtn) {
    console.error("❌ quickAddSubmitBtn tidak ditemukan");
    return;
  }

  const originalText = submitBtn.innerText;
  submitBtn.innerText = '<i class="fas fa-spinner fa-spin"></i> Membuat...';
  submitBtn.disabled = true;

  try {
    const year = new Date(holidayDate).getFullYear();

    const res = await fetch(`/${calendarName}/holidays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: year,
        holidays: [
          {
            title: title,
            date: holidayDate,
            keterangan: title
          }
        ]
      })
    });

    const result = await res.json();
    console.log('📝 Holiday response:', result); // Debug

    if (res.ok) {
      // ✅ LANGSUNG TAMBAH KE CALENDAR
      const newId = `holiday-${year}-${Date.now()}`;
      
      calendar.addEvent({
        id: newId,
        title: title,
        start: holidayDate,
        allDay: true,
        backgroundColor: "#dc2626",
        borderColor: "#dc2626",
        textColor: "#fff",
        editable: false,
        extendedProps: {
          isHoliday: true,
          keterangan: title,
        },
      });

      showToast("✅ Hari libur berhasil ditambahkan!", "success");
      closeQuickAddModal();
      form.reset();
      
      // Reset tanggal ke hari ini
      const today = new Date().toISOString().split("T")[0];
      const holidayDateInput = form.querySelector('input[name="quick_holiday_date"]');
      if (holidayDateInput) {
        holidayDateInput.value = today;
      }
      
      // ✅ UPDATE UPCOMING EVENTS
      setTimeout(() => {
        updateUpcomingEvents();
      }, 300);
    } else {
      showToast("❌ " + (result.error || result.message || "Gagal membuat hari libur"), "error");
    }
  } catch (err) {
    showToast("❌ Terjadi kesalahan sistem", "error");
    console.error(err);
  } finally {
    submitBtn.innerText = originalText;
    submitBtn.disabled = false;
  }
};


window.submitQuickAddEvent = async function () {
  const form = document.getElementById("quickAddEventForm");
  if (!form) {
    console.error("❌ quickAddEventForm tidak ditemukan");
    return;
  }

  const eventDate = form.querySelector(
    'input[name="quick_event_date"]'
  )?.value;
  const startTime = form.querySelector(
    'input[name="quick_start_time"]'
  )?.value;
  const endTime = form.querySelector('input[name="quick_end_time"]')?.value;
  const title = form.querySelector('input[name="quick_title"]')?.value;
  const roomId = form.querySelector('select[name="quick_room_id"]')?.value;
  const meetingLink =
    form.querySelector('input[name="quick_meeting_link"]')?.value || "";

  if (!eventDate || !startTime || !endTime || !title || !roomId) {
    window.showToast("Mohon isi semua field yang diperlukan", "error");
    return;
  }

  const startDateTime = `${eventDate}T${startTime}:00`;
  const endDateTime = `${eventDate}T${endTime}:00`;

  if (new Date(startDateTime) >= new Date(endDateTime)) {
    window.showToast("Waktu selesai harus setelah waktu mulai", "error");
    return;
  }

  // ✅ TAMBAH: Ambil participants count dan validasi kapasitas
  const participantsCount = parseInt(
    form.querySelector('input[name="quick_participants_count"]')?.value || 0
  );
  
  // ✅ TAMBAH: Validasi kapasitas ruangan
  if (participantsCount > 0) {
    const room = roomsCache.find(r => r.id == roomId);
    if (room && participantsCount > room.capacity) {
      window.showToast(
        `Jumlah peserta melebihi kapasitas ruangan! Maks: ${room.capacity} orang`,
        "error"
      );
      return;
    }
  }

  // ✅ AMBIL SEMUA DATA DARI FORM (TERMASUK YANG OPSIONAL)
  const organizerName =
    form.querySelector('input[name="quick_organizer_name"]')?.value || "";
  const organizerPhone =
    form.querySelector('input[name="quick_organizer_phone"]')?.value || "";
  const picName =
    form.querySelector('input[name="quick_pic_name"]')?.value || "";
  const notes =
    form.querySelector('textarea[name="quick_notes"]')?.value || "";

  const submitBtn = document.getElementById("quickAddSubmitBtn");
  if (!submitBtn) return;

  const originalText = submitBtn.innerText;
  submitBtn.innerText = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
  submitBtn.disabled = true;

  try {
    // ✅ GUNAKAN FormData UNTUK SUPPORT FILE UPLOAD
    const formData = new FormData();
    formData.append("room_id", roomId);
    formData.append("title", title);
    formData.append("start_time", startDateTime);
    formData.append("end_time", endDateTime);
    formData.append("organizer_name", organizerName);
    formData.append("organizer_phone", organizerPhone);
    formData.append("pic_name", picName);
    formData.append("participants_count", participantsCount); // ✅ Gunakan nilai yang sudah divalidasi
    formData.append("notes", notes);
    formData.append("meeting_link", meetingLink);

    // ✅ TAMBAH: Append file jika ada
    const posterInput = form.querySelector('input[name="quick_poster"]');
    if (posterInput && posterInput.files.length > 0) {
      formData.append("poster", posterInput.files[0]);
    }

    const calendarName = window.location.pathname.split("/")[1] || "default";

    const res = await fetch(`/${calendarName}/events`, {
      method: "POST",
      body: formData, // ✅ Gunakan FormData, bukan JSON
    });

    const result = await res.json();

    if (res.ok) {
      window.showToast("Event berhasil dibuat!", "success");
      document.getElementById("quickAddModal").classList.add("hidden");
      if (window.calendar) {
        window.calendar.refetchEvents();
      }
      form.reset();
    } else {
      window.showToast(result.message || "Gagal membuat event", "error");
    }
  } catch (err) {
    window.showToast("Terjadi kesalahan sistem", "error");
    console.error(err);
  } finally {
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }
};

window.submitQuickAddReminder = async function () {
  const form = document.getElementById("quickAddReminderForm");
  if (!form) {
    console.error("❌ quickAddReminderForm tidak ditemukan");
    return;
  }

  const reminderDate = form.querySelector(
    'input[name="quick_reminder_date"]'
  )?.value;
  const title = form.querySelector(
    'input[name="quick_reminder_title"]'
  )?.value;

  if (!reminderDate || !title) {
    window.showToast("Judul dan tanggal wajib diisi", "error");
    return;
  }

  const submitBtn = document.getElementById("quickAddSubmitBtn");
  if (!submitBtn) return;

  const originalText = submitBtn.innerText;
  submitBtn.innerText = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
  submitBtn.disabled = true;

  try {
    const calendarName = window.location.pathname.split("/")[1] || "default";

    const res = await fetch(`/${calendarName}/reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        reminder_date: reminderDate,
        notes:
          form.querySelector('textarea[name="quick_reminder_notes"]')?.value ||
          "",
      }),
    });

    const result = await res.json();

    if (res.ok) {
      window.showToast("Pengingat berhasil dibuat!", "success");
      document.getElementById("quickAddModal").classList.add("hidden");
      if (window.calendar) {
        window.calendar.refetchEvents();
      }
      form.reset();
    } else {
      window.showToast(result.message || "Gagal membuat pengingat", "error");
    }
  } catch (err) {
    window.showToast("Terjadi kesalahan sistem", "error");
    console.error(err);
  } finally {
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }
};
function validateTabParticipants() {
  const form = document.getElementById('addEventFormTabs');
  if (!form) return;
  const roomSelect = form.querySelector('select[name="room_id"]');
  const participantsInput = form.querySelector('input[name="participants_count"]');
  if (!roomSelect || !participantsInput) return;

  const roomId = roomSelect.value;
  const participants = parseInt(participantsInput.value) || 0;

  // Cari/siapkan elemen warning
  let warningEl = participantsInput.parentElement.querySelector('.capacity-warning');
  if (!warningEl) {
    warningEl = document.createElement('p');
    warningEl.className = 'capacity-warning text-red-600 text-xs font-semibold mt-1';
    participantsInput.parentElement.appendChild(warningEl);
  }

  // Validasi
  if (!roomId || participants === 0) {
    warningEl.textContent = '';
    warningEl.style.display = 'none';
    participantsInput.style.borderColor = '#e5e7eb';
    participantsInput.style.backgroundColor = '#f9fafb';
    return;
  }

  const room = roomsCache.find(r => r.id == roomId);
  if (room && participants > room.capacity) {
    warningEl.textContent = `Melebihi kapasitas! Maks: ${room.capacity} orang`;
    warningEl.style.display = '';
    participantsInput.style.borderColor = '#dc2626';
    participantsInput.style.backgroundColor = '#fee2e2';
  } else {
    warningEl.textContent = '';
    warningEl.style.display = 'none';
    participantsInput.style.borderColor = '#e5e7eb';
    participantsInput.style.backgroundColor = '#f9fafb';
  }
}
// ===== GENERATE HOLIDAYS MODAL (OUTSIDE DOMContentLoaded) =====
window.openGenerateHolidaysModal = function() {
  const modal = document.getElementById("generateHolidaysModal");
  const yearInput = document.getElementById("holidaysYearInput");
  
  if (!modal || !yearInput) {
    console.error("🔴 Modal atau input tahun tidak ditemukan");
    return;
  }
  
  // Set default ke tahun ini
  yearInput.value = new Date().getFullYear();
  modal.classList.remove("hidden");
};

window.closeGenerateHolidaysModal = function() {
  const modal = document.getElementById("generateHolidaysModal");
  if (modal) {
    modal.classList.add("hidden");
  }
};

window.generateHolidays = async function() {
  const yearInput = document.getElementById("holidaysYearInput");
  if (!yearInput) return;
  
  const year = parseInt(yearInput.value, 10);
  
  if (!year || year < 2025 || year > 2027) {
    showToast("Pilih tahun yang valid (2025-2027)", "error");
    return;
  }
  
  try {
    // ✅ Cek di database holidays
    const checkRes = await fetch(`/${calendarName}/holidays-by-year/${year}`);
    const checkData = await checkRes.json();
    
    if (checkData.success && checkData.holidays.length > 0) {
      const result = await Swal.fire({
        title: `Hari Libur ${year} Sudah Ada!`,
        html: `Kalender sudah memiliki <strong>${checkData.holidays.length} hari libur</strong> untuk tahun ${year}.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#dc2626",
        cancelButtonColor: "#3b82f6",
        confirmButtonText: "Hapus & Buat Baru",
        cancelButtonText: "Lewati",
      });
      
      if (!result.isConfirmed) return;
      
      // Delete dari database
      await fetch(`/${calendarName}/holidays/${year}`, {
        method: 'DELETE'
      });
    }
    
    // Fetch dari API
    const res = await fetch(`/api/holidays/${year}`);
    const result = await res.json();
    
    if (!result.is_success || !result.data) {
      showToast(`Tidak ada data hari libur untuk ${year}`, "error");
      return;
    }
    
    // Simpan ke database
    const holidaysToSave = result.data.map(holiday => ({
      title: holiday.name,
      date: holiday.date,
      keterangan: holiday.name,
    }));
    
    const saveRes = await fetch(`/${calendarName}/holidays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: year,
        holidays: holidaysToSave
      })
    });
    
    if (!saveRes.ok) {
      console.warn("⚠️ Gagal simpan holiday ke database");
    }
    
    // ✅ PERBAIKI: Hapus event holiday lama di calendar
    calendar.getEvents()
      .filter(e => e.extendedProps.isHoliday && e.start && new Date(e.start).getFullYear() === year)
      .forEach(e => e.remove());
    
    // Tambah holiday baru
    let addedCount = 0;
    result.data.forEach((holiday) => {
      calendar.addEvent({
        title: holiday.name,
        start: holiday.date,
        allDay: true,
        backgroundColor: "#dc2626",
        borderColor: "#dc2626",
        textColor: "#fff",
        editable: false,
        extendedProps: {
          isHoliday: true,
          keterangan: holiday.name,
        },
      });
      addedCount++;
    });
    
    showToast(`${addedCount} hari libur berhasil ditambahkan!`, "success");
    window.closeGenerateHolidaysModal();
    
  } catch (err) {
    console.error("Error:", err);
    showToast("Terjadi kesalahan saat generate hari libur", "error");
  }
};
document.addEventListener("DOMContentLoaded", function () {
  // --- 1. GLOBAL VARIABLES ---
  // Extract calendarName from URL path (e.g., /myCalendar/ -> "myCalendar")
  const calendarName = window.location.pathname.split("/")[1] || "default"; // Fallback if no calendarName
  const modal = document.getElementById("bookingModal");
  const addRoomModal = document.getElementById("addRoomModal");
  const drawer = document.getElementById("eventDrawer");
  const drawerOverlay = document.getElementById("eventDrawerOverlay");

    const btnGenerateHolidays = document.getElementById('btnGenerateHolidays');
  if (btnGenerateHolidays) {
    btnGenerateHolidays.addEventListener('click', function() {
      window.openGenerateHolidaysModal();
    });
  }
    const addEventFormTabs = document.getElementById('addEventFormTabs');
  if (addEventFormTabs) {
    const roomSelect = addEventFormTabs.querySelector('select[name="room_id"]');
    const participantsInput = addEventFormTabs.querySelector('input[name="participants_count"]');
    if (roomSelect && participantsInput) {
      roomSelect.addEventListener('change', validateTabParticipants);
      participantsInput.addEventListener('input', validateTabParticipants);
    }
  }


  // TAMBAH NULL CHECK untuk openModal/closeModal

  window.openModal = function (dateStr) {
    if (!modal) {
      console.warn("bookingModal tidak ditemukan");
      return;
    }

    // ✅ TAMBAH: Tampilkan modal quick add dengan tab
    const quickAddModal = document.getElementById("quickAddModal");
    if (quickAddModal) {
      quickAddModal.classList.remove("hidden");

      // === Tambahkan kode ini untuk populate ruangan ===
      const roomSelect = document.querySelector(
        '#quickAddModal select[name="quick_room_id"]'
      );
      if (roomSelect) {
        roomSelect.innerHTML = '<option value="">-- Pilih Ruangan --</option>';
        roomsCache.forEach((room) => {
          roomSelect.innerHTML += `<option value="${room.id}">${room.name} (Kap: ${room.capacity})</option>`;
        });
      }
      
      // ✅ PERBAIKI: Tambahkan definisi holidayDateInput
      const eventDateInput = document.querySelector(
        '#quickAddModal input[name="quick_event_date"]'
      );
      const reminderDateInput = document.querySelector(
        '#quickAddModal input[name="quick_reminder_date"]'
      );
      const holidayDateInput = document.querySelector(
        '#quickAddModal input[name="quick_holiday_date"]'
      );

      if (eventDateInput) eventDateInput.value = dateStr;
      if (reminderDateInput) reminderDateInput.value = dateStr;
      if (holidayDateInput) holidayDateInput.value = dateStr;  // ✅ Sekarang aman

      // Set waktu default untuk event
      const defaultTimeStart = "09:00";
      const defaultTimeEnd = "10:00";
      const startTimeEl = document.querySelector(
        '#quickAddModal input[name="quick_start_time"]'
      );
      const endTimeEl = document.querySelector(
        '#quickAddModal input[name="quick_end_time"]'
      );

      if (startTimeEl) startTimeEl.value = defaultTimeStart;
      if (endTimeEl) endTimeEl.value = defaultTimeEnd;

      // Reset forms
      const quickEventForm = document.getElementById("quickAddEventForm");
      const quickReminderForm = document.getElementById("quickAddReminderForm");
      if (quickEventForm) quickEventForm.reset();
      if (quickReminderForm) quickReminderForm.reset();

      // Set tanggal lagi setelah reset
      if (eventDateInput) eventDateInput.value = dateStr;
      if (reminderDateInput) reminderDateInput.value = dateStr;
      if (startTimeEl) startTimeEl.value = defaultTimeStart;
      if (endTimeEl) endTimeEl.value = defaultTimeEnd;

      // Switch ke tab event
      switchQuickAddTab("event");

      return;
    }

    // Fallback ke modal booking lama jika quick add modal tidak ada
    const bookingFormEl = document.getElementById("bookingForm");
    if (bookingFormEl) bookingFormEl.reset();
    const statusEl = document.getElementById("availabilityStatus");
    if (statusEl) statusEl.classList.add("hidden");

    if (dateStr) {
      const defaultTimeStart = "09:00";
      const defaultTimeEnd = "10:00";
      const startTimeEl = document.getElementById("startTime");
      const endTimeEl = document.getElementById("endTime");
      if (startTimeEl) startTimeEl.value = `${dateStr}T${defaultTimeStart}`;
      if (endTimeEl) endTimeEl.value = `${dateStr}T${defaultTimeEnd}`;
    }

    modal.classList.remove("hidden");
  };

  window.closeModal = function () {
    if (modal) modal.classList.add("hidden");
  };

  // ✅ TAMBAH: Function untuk switch tab di quick add modal
  let currentQuickAddTab = "event";

window.switchQuickAddTab = function (tabName) {
  // Hide all tabs
  document.querySelectorAll(".quick-add-tab-content").forEach((tab) => {
    tab.classList.add("hidden");
  });

  // Remove active dari semua buttons
  document.querySelectorAll(".quick-add-tab-btn").forEach((btn) => {
    btn.classList.remove(
      "active",  // ✅ TAMBAH: Remove class 'active'
      "border-b-4",
      "border-green-400",
      "border-purple-400",
      "border-red-400",
      "text-green-600",
      "text-purple-600",
      "text-red-600"
    );
    btn.classList.add("border-transparent", "text-gray-600");
  });

  // Show selected tab
  const contentEl = document.getElementById(`quick-add-content-${tabName}`);
  if (contentEl) {
    contentEl.classList.remove("hidden");
  }

  // Highlight selected button dengan ACTIVE class
  const activeBtn = document.getElementById(`quick-add-tab-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.add("active"); // ✅ TAMBAH class active
    activeBtn.classList.remove("border-transparent", "text-gray-600");

    if (tabName === "event") {
      activeBtn.classList.add("border-b-4", "border-green-400", "text-green-600");
    } else if (tabName === "reminder") {
      activeBtn.classList.add("border-b-4", "border-purple-400", "text-purple-600");
    } else if (tabName === "holiday") {
      activeBtn.classList.add("border-b-4", "border-red-400", "text-red-600");
    }
  }
  
  // Store di window scope
  window.currentQuickAddTab = tabName;
};

  async function submitQuickAddEvent() {
    const form = document.getElementById("quickAddEventForm");
    const eventDate = form.querySelector(
      'input[name="quick_event_date"]'
    ).value;
    const startTime = form.querySelector(
      'input[name="quick_start_time"]'
    ).value;
    const endTime = form.querySelector('input[name="quick_end_time"]').value;
    const title = form.querySelector('input[name="quick_title"]').value;
    const roomId = form.querySelector('select[name="quick_room_id"]').value;
    const meetingLink =
      form.querySelector('input[name="quick_meeting_link"]').value || "";

    if (!eventDate || !startTime || !endTime || !title || !roomId) {
      showToast("Mohon isi semua field yang diperlukan", "error");
      return;
    }

    const startDateTime = `${eventDate}T${startTime}:00`;
    const endDateTime = `${eventDate}T${endTime}:00`;

    if (new Date(startDateTime) >= new Date(endDateTime)) {
      showToast("Waktu selesai harus setelah waktu mulai", "error");
      return;
    }

    // ✅ AMBIL SEMUA DATA DARI FORM (TERMASUK YANG OPSIONAL)
    const organizerName =
      form.querySelector('input[name="quick_organizer_name"]').value || "";
    const organizerPhone =
      form.querySelector('input[name="quick_organizer_phone"]').value || "";
    const picName =
      form.querySelector('input[name="quick_pic_name"]').value || "";
    const participantsCount =
      form.querySelector('input[name="quick_participants_count"]').value || "";
    const notes =
      form.querySelector('textarea[name="quick_notes"]').value || "";

    const submitBtn = document.getElementById("quickAddSubmitBtn");
    const originalText = submitBtn.innerText;
    submitBtn.innerText = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    submitBtn.disabled = true;

    try {
      // ✅ GUNAKAN FormData UNTUK SUPPORT FILE UPLOAD
      const formData = new FormData();
      formData.append("room_id", roomId);
      formData.append("title", title);
      formData.append("start_time", startDateTime);
      formData.append("end_time", endDateTime);
      formData.append("organizer_name", organizerName);
      formData.append("organizer_phone", organizerPhone);
      formData.append("pic_name", picName);
      formData.append("participants_count", participantsCount);
      formData.append("notes", notes);
      formData.append("meeting_link", meetingLink);

      // ✅ TAMBAH: Append file jika ada
      const posterInput = form.querySelector('input[name="quick_poster"]');
      if (posterInput && posterInput.files.length > 0) {
        formData.append("poster", posterInput.files[0]);
      }

      const res = await fetch(`/${calendarName}/events`, {
        method: "POST",
        body: formData, // ✅ Gunakan FormData, bukan JSON
      });

      const result = await res.json();

      if (res.ok) {
        showToast("Event berhasil dibuat!", "success");
        document.getElementById("quickAddModal").classList.add("hidden");
        calendar.refetchEvents();
        form.reset();
      } else {
        showToast(result.message || "Gagal membuat event", "error");
      }
    } catch (err) {
      showToast("Terjadi kesalahan sistem", "error");
      console.error(err);
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
    }
  }

  async function submitQuickAddReminder() {
    const form = document.getElementById("quickAddReminderForm");
    const reminderDate = form.querySelector(
      'input[name="quick_reminder_date"]'
    ).value;
    const title = form.querySelector(
      'input[name="quick_reminder_title"]'
    ).value;

    if (!reminderDate || !title) {
      showToast("Judul dan tanggal wajib diisi", "error");
      return;
    }

    const submitBtn = document.getElementById("quickAddSubmitBtn");
    const originalText = submitBtn.innerText;
    submitBtn.innerText = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    submitBtn.disabled = true;

    try {
      const res = await fetch(`/${calendarName}/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          reminder_date: reminderDate,
          notes:
            form.querySelector('textarea[name="quick_reminder_notes"]').value ||
            "",
        }),
      });

      const result = await res.json();

      if (res.ok) {
        showToast("Pengingat berhasil dibuat!", "success");
        document.getElementById("quickAddModal").classList.add("hidden");
        calendar.refetchEvents();
        form.reset();
      } else {
        showToast(result.message || "Gagal membuat pengingat", "error");
      }
    } catch (err) {
      showToast("Terjadi kesalahan sistem", "error");
      console.error(err);
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
    }
  }

  window.closeQuickAddModal = function () {
    document.getElementById("quickAddModal").classList.add("hidden");
  };

  // ✅ SETELAH loadAllHolidays() - TAMBAHKAN INI:

document.addEventListener('DOMContentLoaded', function() {
    // QUICK ADD EVENT FORM - Setup listeners
  const quickAddEventForm = document.getElementById('quickAddEventForm');
  if (quickAddEventForm) {
    
    const roomSelect = quickAddEventForm.querySelector('select[name="quick_room_id"]');
    const eventDateInput = quickAddEventForm.querySelector('input[name="quick_event_date"]');
    const startTimeInput = quickAddEventForm.querySelector('input[name="quick_start_time"]');
    const endTimeInput = quickAddEventForm.querySelector('input[name="quick_end_time"]');

    if (roomSelect) {
      roomSelect.addEventListener('change', () => window.checkQuickAddConflict('quickAddEventForm'));
    }
    if (eventDateInput) {
      eventDateInput.addEventListener('change', () => window.checkQuickAddConflict('quickAddEventForm'));
    }
    if (startTimeInput) {
      startTimeInput.addEventListener('change', () => window.checkQuickAddConflict('quickAddEventForm'));
    }
    if (endTimeInput) {
      endTimeInput.addEventListener('change', () => window.checkQuickAddConflict('quickAddEventForm'));
    }
  }

  // BOOKING FORM - Setup listeners
  const bookingForm = document.getElementById('bookingForm');
  if (bookingForm) {
    
    const roomSelect = bookingForm.querySelector('select[name="room_id"]');
    const startTimeInput = bookingForm.querySelector('input[name="start_time"]');
    const endTimeInput = bookingForm.querySelector('input[name="end_time"]');

    if (roomSelect) {
      roomSelect.addEventListener('change', () => window.checkQuickAddConflict('bookingForm'));
    }
    if (startTimeInput) {
      startTimeInput.addEventListener('change', () => window.checkQuickAddConflict('bookingForm'));
    }
    if (endTimeInput) {
      endTimeInput.addEventListener('change', () => window.checkQuickAddConflict('bookingForm'));
    }
  }

  // ADD EVENT TABS FORM - Setup listeners
  const addEventFormTabs = document.getElementById('addEventFormTabs');
  if (addEventFormTabs) {
    
    const roomSelect = addEventFormTabs.querySelector('select[name="room_id"]');
    const eventDateInput = addEventFormTabs.querySelector('input[name="event_date"]');
    const startTimeInput = addEventFormTabs.querySelector('input[name="start_time_only"]');
    const endTimeInput = addEventFormTabs.querySelector('input[name="end_time_only"]');

    if (roomSelect) {
      roomSelect.addEventListener('change', () => window.checkQuickAddConflict('addEventFormTabs'));
    }
    if (eventDateInput) {
      eventDateInput.addEventListener('change', () => window.checkQuickAddConflict('addEventFormTabs'));
    }
    if (startTimeInput) {
      startTimeInput.addEventListener('change', () => window.checkQuickAddConflict('addEventFormTabs'));
    }
    if (endTimeInput) {
      endTimeInput.addEventListener('change', () => window.checkQuickAddConflict('addEventFormTabs'));
    }
  }
});

  // --- 2. INITIALIZE FULLCALENDAR ---
  const calendarEl = document.getElementById("calendar");

  // Load rooms dulu sebelum render calendar
  loadRooms().then(() => {
    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,listWeek",
      },
      themeSystem: "standard",
      height: "100%",
      locale: "id",
      editable: true,
      droppable: true,
      eventTimeFormat: false, // TAMBAH INI - Disable default time format
      eventDisplay: "block", // Buat event tampil sebagai block, bukan compact
      events: async function (info, successCallback, failureCallback) {
        try {

          const response = await fetch(`/${calendarName}/events`);

          // ✅ CEK RESPONSE STATUS
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          let events = await response.json();

          // ✅ VALIDASI RESPONSE
          if (!Array.isArray(events)) {
            console.error("❌ Events bukan array:", events);
            throw new Error("Response format invalid");
          }

          // Apply filter
          if (activeRoomFilter !== "all") {
            // Tampilkan event yang:
            // - room_id == filter
            // - ATAU isReminder == true
            const filtered = events.filter(
              (e) =>
                (e.extendedProps.room_id == activeRoomFilter) ||
                (e.extendedProps.isReminder === true)
            );
            successCallback(filtered);
          } else {
            successCallback(events);
          }
        } catch (error) {
          console.error("❌ Error loading events:", error);
          failureCallback(error);
          showToast(`Gagal memuat jadwal: ${error.message}`, "error");
        }
      },


      eventDidMount: function (info) {
  const color = info.event.extendedProps.room_color || info.event.backgroundColor;
  const isHoliday = info.event.extendedProps.isHoliday || false;
  const isReminder = info.event.extendedProps.isReminder || false;

  // Styling untuk event ruangan biasa
  if (color && !isHoliday && !isReminder) {
    const bgColor = lightenColor(color, 70);
    info.el.style.backgroundColor = bgColor;
    info.el.style.borderColor = "transparent";
    info.el.style.color = color;

    const titleEls = info.el.querySelectorAll(".fc-event-title");
    if (titleEls.length > 1) {
      console.warn("⚠️ Ada lebih dari satu .fc-event-title di event:", info.event.title, titleEls);
      for (let i = 1; i < titleEls.length; i++) {
        titleEls[i].remove();
      }
    }

    const titleEl = info.el.querySelector(".fc-event-title");
    if (titleEl) {
      titleEl.style.color = color;
      titleEl.style.fontWeight = "600";
      
      // ✅ PERBAIKI: Ambil title ASLI (tanpa location/pic)
      let originalTitle = info.event.title;
      
      // ✅ HAPUS location dari title jika ada di akhir
      const locationMatch = originalTitle.match(/\s*\([^)]+\)$/);
      if (locationMatch) {
        originalTitle = originalTitle.replace(locationMatch[0], "").trim();
      }
      
      // ✅ TRUNCATE HANYA TITLE ASLI (tanpa location)
      const truncatedTitle = truncateText(originalTitle, 25);
      
      // ✅ TAMBAH location kembali SETELAH truncate
      const picName = info.event.extendedProps.pic_name;
      const displayTitle = picName && picName !== '-' 
        ? `${truncatedTitle} (${picName})`
        : truncatedTitle;
      
      titleEl.innerText = displayTitle;
      titleEl.title = originalTitle + (picName ? ` (${picName})` : "");
    }
    info.el.style.boxShadow = `0 2px 4px ${color}30`;
    
    // Set transition selalu untuk animasi
    info.el.style.transition = "transform 0.5s ease-out, border 0.5s ease-out, box-shadow 0.5s ease-out";
    
    // Highlight jika room_id match highlightedRoomId
    if (info.event.extendedProps.room_id == highlightedRoomId) {
      info.el.style.border = `3px solid ${color}`;
      info.el.style.boxShadow = `0 4px 12px ${color}50`;
      info.el.style.transform = "scale(1.05)";
    } else {
      // Reset ke normal
      info.el.style.border = "transparent";
      info.el.style.boxShadow = `0 2px 4px ${color}30`;
      info.el.style.transform = "scale(1)";
    }
  }

        if (isHoliday) {
          info.el.style.backgroundColor = "#fee2e2";
          info.el.style.color = "#7f1d1d";
          const titleEl = info.el.querySelector(".fc-event-title");
          if (titleEl) {
            titleEl.style.color = "#7f1d1d";
          }
        }

          if (isReminder) {
    info.el.style.backgroundColor = "#f3e8ff";
    info.el.style.color = "#6d28d9";
    const titleEl = info.el.querySelector(".fc-event-title");
    if (titleEl) {
      titleEl.style.color = "#6d28d9";
    }
  }

  // ===== TAMPILKAN JAM HANYA UNTUK EVENT BIASA =====
  const titleEl = info.el.querySelector(".fc-event-title");
  if (titleEl && !isHoliday && !isReminder) {
    const startTime = info.event.start;
    const endTime = info.event.end;

    const startStr = startTime.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const endStr = endTime
      ? endTime.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : startStr;

    // ✅ BUAT ELEMEN CONTAINER UNTUK WAKTU
    const timeDiv = document.createElement("div");
    timeDiv.style.fontSize = "0.65rem";
    timeDiv.style.fontWeight = "600";
    timeDiv.style.marginTop = "3px";
    timeDiv.style.lineHeight = "1.2";
    timeDiv.style.color = color;
    timeDiv.textContent = `${startStr} → ${endStr}`;

    titleEl.parentElement.appendChild(timeDiv);

    // ✅ TAMBAH: Tampilkan link meeting dengan styling seperti gambar
    if (info.event.extendedProps.meeting_link) {
      const meetingLink = info.event.extendedProps.meeting_link;
      const linkDetection = detectLinkType(meetingLink);

      // Container
      const linkContainer = document.createElement("div");
      linkContainer.style.marginTop = "4px";
      linkContainer.style.borderRadius = "4px";
      linkContainer.style.overflow = "visible";
      linkContainer.style.minHeight = "24px";

      // Button
      const linkButton = document.createElement("a");
      linkButton.href = meetingLink;
      linkButton.target = "_blank";
      linkButton.style.display = "flex";
      linkButton.style.alignItems = "center";
      linkButton.style.justifyContent = "center";
      linkButton.style.gap = "4px";
      linkButton.style.padding = "4px 6px";
      linkButton.style.backgroundColor = "#000";
      linkButton.style.color = "#fff";
      linkButton.style.fontSize = "0.6rem";
      linkButton.style.fontWeight = "700";
      linkButton.style.textDecoration = "none";
      linkButton.style.borderRadius = "3px";
      linkButton.style.width = "100%";
      linkButton.style.boxSizing = "border-box";
      linkButton.style.cursor = "pointer";
      linkButton.style.transition =
        "background-color 0.2s ease, box-shadow 0.2s ease";
      linkButton.style.whiteSpace = "nowrap";
      linkButton.style.overflow = "hidden";
      linkButton.style.textOverflow = "ellipsis";
      linkButton.title = meetingLink;

      // ===== ICON - JANGAN PAKSA UKURAN PERSEGI =====
      const iconImg = document.createElement("img");
      iconImg.src = `/images/link-icons/${linkDetection.icon}`;
      iconImg.style.width = "auto";
      iconImg.style.height = "auto";
      iconImg.style.maxWidth = "1rem";
      iconImg.style.maxHeight = "1rem";
      iconImg.style.objectFit = "contain";
      iconImg.style.flexShrink = "0";
      iconImg.onerror = function () {
        this.style.display = "none";
        const fallbackIcon = document.createElement("i");
        fallbackIcon.className = "fas fa-link";
        fallbackIcon.style.fontSize = "0.9rem";
        fallbackIcon.style.flexShrink = "0";
        linkButton.insertBefore(
          fallbackIcon,
          linkButton.querySelector("span")
        );
      };

      const spanText = document.createElement("span");
      spanText.style.overflow = "hidden";
      spanText.style.textOverflow = "ellipsis";
      spanText.textContent = `Go to ${linkDetection.label}`;

      linkButton.appendChild(iconImg);
      linkButton.appendChild(spanText);

      // Hover effect
      linkButton.addEventListener("mouseenter", function () {
        this.style.backgroundColor = "#1a1a1a";
        this.style.boxShadow = "0 1px 3px rgba(0,0,0,0.4)";
      });

      linkButton.addEventListener("mouseleave", function () {
        this.style.backgroundColor = "#000";
        this.style.boxShadow = "none";
      });

      linkContainer.appendChild(linkButton);
      titleEl.parentElement.appendChild(linkContainer);
    }
  }
  const shouldHighlight = info.event.extendedProps.room_id == highlightedRoomId;
    if (shouldHighlight && info.event.extendedProps.room_id) {
    info.el.classList.add('event-highlighted');
    // Element akan ter-highlight otomatis setiap kali di-render
  }
},

      eventClick: function (info) {
        openDrawer(info.event);
      },
      dateClick: function (info) {
        openModal(info.dateStr);
      },
      eventDrop: async function (info) {
        function toLocalString(dt) {
          return (
            dt.getFullYear() +
            "-" +
            String(dt.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(dt.getDate()).padStart(2, "0") +
            "T" +
            String(dt.getHours()).padStart(2, "0") +
            ":" +
            String(dt.getMinutes()).padStart(2, "0") +
            ":" +
            String(dt.getSeconds()).padStart(2, "0")
          );
        }

        // ✅ TAMBAH: Helper untuk format YYYY-MM-DD saja (lokal timezone)
        function toLocalDateString(dt) {
          return (
            dt.getFullYear() +
            "-" +
            String(dt.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(dt.getDate()).padStart(2, "0")
          );
        }

        // ✅ TAMBAH: CEK APAKAH REMINDER
        const isReminder = info.event.extendedProps.isReminder || false;

        // ✅ UNTUK REMINDER: Gunakan helper function lokal, bukan toISOString()
        const newStart = isReminder
          ? toLocalDateString(info.event.start)
          : toLocalString(info.event.start);

        const newEnd = isReminder
          ? toLocalDateString(info.event.start)
          : info.event.end
          ? toLocalString(info.event.end)
          : newStart;

        if (
          !confirm(`Pindahkan jadwal "${info.event.title}" ke tanggal baru?`)
        ) {
          info.revert();
          return;
        }

        try {
          // ✅ UBAH ENDPOINT BERDASARKAN TIPE EVENT
          const endpoint = isReminder
            ? `/${calendarName}/reminders/${info.event.id.replace("reminder-", "")}/date`
            : `/${calendarName}/events/${info.event.id}/date`;

          const res = await fetch(endpoint, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              start_time: newStart,
              end_time: newEnd,
              allDay: info.event.allDay,
            }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.message);

          showToast("Jadwal berhasil dipindahkan!", "success");
          await calendar.refetchEvents();
        } catch (err) {
          info.revert();
          showToast(err.message, "error");
        }
      },
      eventMouseEnter: function (info) {
        const isHoliday = info.event.extendedProps.isHoliday || false;
        const isReminder = info.event.extendedProps.isReminder || false;
      
        if (isHoliday || isReminder) {
          // ✅ UNTUK HOLIDAY DAN REMINDER: Tampilkan nama dan klik untuk detail
          tippy(info.el, {
            content: `
                              <strong>${info.event.title}</strong><br>
                              <span style="font-size:0.8em">Klik untuk detail</span>
                          `,
            allowHTML: true,
            theme: "light",
          });
        } else {
          // ✅ UNTUK EVENT BIASA: Tampilkan nama, location (ruangan), dan klik untuk detail
          tippy(info.el, {
            content: `
                              <strong>${info.event.title}</strong><br>
                              Location: ${info.event.extendedProps.room_name || "-"}<br>
                              <span style="font-size:0.8em">Klik untuk detail</span>
                          `,
            allowHTML: true,
            theme: "light",
          });
        }
      },

    });

    calendar.render();
    window.calendar = calendar;
    
    loadAllHolidays();

    calendar.on("eventsSet", function () {
      updateUpcomingEvents();
    });


    setTimeout(() => {
      if (calendar) {
        upcomingEventsData = calendar.getEvents().map((event) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          extendedProps: event.extendedProps,
        }));
        renderUpcomingEvents();
      }
    }, 1500);

    // Update setiap kali ada perubahan melalui API
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const promise = originalFetch.apply(this, args);
      return promise.then((response) => {
        // Jika berhasil create/update/delete event, update sidebar dengan delay
        if (response.ok && args[0].includes("/events")) {
          // Gunakan debounced function, bukan setTimeout langsung
          debouncedUpdateUpcomingEvents();
        }
        return response;
      });
    };

    // --- SETUP MONTH/YEAR PICKER ---
    const monthYearPicker = document.getElementById("monthYearPicker");

    // Set initial value ke bulan/tahun sekarang
    const today = new Date();
    const currentMonth = String(today.getMonth() + 1).padStart(2, "0");
    const currentYear = today.getFullYear();
    monthYearPicker.value = `${currentYear}-${currentMonth}`;

    // Ketika user pilih bulan/tahun
    monthYearPicker.addEventListener("change", function () {
      const [year, month] = this.value.split("-");
      const firstDay = new Date(year, parseInt(month) - 1, 1);
      calendar.gotoDate(firstDay);
    });
  });

  // --- HELPER: Reset ke Hari Ini ---
  window.resetToToday = function () {
    const today = new Date();
    calendar.today();

    // Update month picker ke bulan sekarang
    const currentMonth = String(today.getMonth() + 1).padStart(2, "0");
    const currentYear = today.getFullYear();
    document.getElementById(
      "monthYearPicker"
    ).value = `${currentYear}-${currentMonth}`;
  };

  // --- 3. BOOKING FORM ---
  const bookingForm = document.getElementById("bookingForm");
  const participantsInput = document.getElementById("participantsCount");
  const roomSelect = document.getElementById("roomSelect");
  const participantsWarning = document.getElementById("participantsWarning");

  // HANYA JALANKAN JIKA ELEMEN ADA
  if (bookingForm && participantsInput && roomSelect && participantsWarning) {
    function validateParticipants() {
      const roomId = roomSelect.value;
      const participants = parseInt(participantsInput.value, 10) || 0;
      if (!roomId) {
        participantsWarning.classList.add("hidden");
        return true;
      }
      const room = roomsCache.find((r) => r.id == roomId);
      if (room && participants > room.capacity) {
        participantsWarning.innerText = `Jumlah peserta tidak boleh melebihi kapasitas ruangan (${room.capacity})`;
        participantsWarning.classList.remove("hidden");
        return false;
      } else {
        participantsWarning.classList.add("hidden");
        return true;
      }
    }

    participantsInput.addEventListener("input", validateParticipants);
    roomSelect.addEventListener("change", validateParticipants);

    bookingForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validateParticipants()) {
        participantsInput.focus();
        return;
      }
      const formData = new FormData(bookingForm);
      const btnSave = document.getElementById("btnSave");
      const originalText = btnSave.innerText;
      btnSave.innerText = "Menyimpan...";
      btnSave.disabled = true;

      try {
        const res = await fetch(`/${calendarName}/events`, {
          method: "POST",
          body: formData,
        });

        const result = await res.json();

        if (res.ok) {
          showToast("Booking Berhasil!", "success");
          closeModal();
          calendar.refetchEvents();
          bookingForm.reset();
        } else {
          showToast(result.message || "Gagal menyimpan", "error");
        }
      } catch (err) {
        showToast("Terjadi kesalahan sistem", "error");
      } finally {
        btnSave.innerText = originalText;
        btnSave.disabled = false;
      }
    });

    ["roomSelect", "startTime", "endTime"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", checkAvailability);
    });
  } else {
    console.warn("Booking form elements not found in HTML");
  }

  // --- 4. HELPER FUNCTIONS ---

  async function checkAvailability() {
    const roomSelectEl = document.getElementById("roomSelect");
    const startTimeEl = document.getElementById("startTime");
    const endTimeEl = document.getElementById("endTime");
    const statusEl = document.getElementById("availabilityStatus");

    // Jika elemen tidak ada, skip
    if (!roomSelectEl || !startTimeEl || !endTimeEl || !statusEl) {
      return;
    }

    const roomId = roomSelectEl.value;
    const start = startTimeEl.value;
    const end = endTimeEl.value;

    if (!roomId || !start || !end) {
      statusEl.classList.add("hidden");
      return;
    }

    if (new Date(start) >= new Date(end)) {
      statusEl.innerHTML =
        "<span class='text-red-600 font-bold'><i class='fas fa-times-circle mr-2'></i>Jam selesai harus setelah mulai</span>";
      statusEl.classList.remove("hidden");
      statusEl.style.borderColor = "#dc2626";
      statusEl.style.backgroundColor = "#fee2e2";
      return;
    }

    try {
      const res = await fetch(`/${calendarName}/check-availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          start_time: start,
          end_time: end,
        }),
      });
      const data = await res.json();

      statusEl.classList.remove("hidden");
      if (data.available) {
        statusEl.innerHTML =
          "<span class='text-green-600 font-bold'><i class='fas fa-check-circle mr-2'></i>Ruangan Tersedia</span>";
        statusEl.style.borderColor = "#16a34a";
        statusEl.style.backgroundColor = "#dcfce7";
      } else {
        statusEl.innerHTML =
          "<span class='text-red-600 font-bold'><i class='fas fa-exclamation-circle mr-2'></i>Ruangan Terpakai / Bentrok!</span>";
        statusEl.style.borderColor = "#dc2626";
        statusEl.style.backgroundColor = "#fee2e2";
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Helper untuk konversi Date ke format 'YYYY-MM-DDTHH:mm' lokal
  function toDatetimeLocal(dt) {
    const offset = dt.getTimezoneOffset();
    const local = new Date(dt.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

window.openDrawer = function (eventObj) {
    const props = eventObj.extendedProps;
    currentEventId = eventObj.id;

    const isHoliday = props.isHoliday || false;
    const isReminder = props.isReminder || false;

        const btnChangePoster = document.getElementById("btnChangePoster");
    const posterContainer = document.getElementById("detailPosterContainer");
    const posterEmpty = document.getElementById("detailPosterEmpty");
    
    if (btnChangePoster) {
      if (!isHoliday && !isReminder) {
        // Tampilkan tombol ganti poster untuk event biasa
        btnChangePoster.classList.remove("hidden");
        btnChangePoster.style.display = "flex";
      } else {
        // Sembunyikan untuk holiday/reminder
        btnChangePoster.classList.add("hidden");
        btnChangePoster.style.display = "none";
      }
    }

    

    // Judul
    const titleEl = document.getElementById("detailTitle");
    if (titleEl) titleEl.innerText = eventObj.title;

    // === TAMPILKAN/HILANGKAN ICON EDIT JUDUL SESUAI TIPE ===
    const editTitleBtn = document.getElementById("editTitleBtn");
    if (editTitleBtn) {
      if (isHoliday) {
        editTitleBtn.classList.add("hidden");
      } else {
        editTitleBtn.classList.remove("hidden");
      }
    }

    // Tipe Event Indicator
    const eventTypeEl = document.getElementById("eventTypeIndicator");
    if (eventTypeEl) {
      if (isHoliday) {
        eventTypeEl.textContent = "Holiday";
        eventTypeEl.className =
          "px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600";
      } else if (isReminder) {
        eventTypeEl.textContent = "Reminder";
        eventTypeEl.className =
          "px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-600";
      } else {
        eventTypeEl.textContent = "Event";
        eventTypeEl.className =
          "px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-600";
      }
    }

    // ✅ PERBAIKI: Convert start & end ke Date objects jika belum
    const startDate = eventObj.start instanceof Date ? eventObj.start : new Date(eventObj.start);
    const endDate = eventObj.end instanceof Date ? eventObj.end : new Date(eventObj.end);

    

  // ===== TIME SECTION (untuk event biasa saja) =====
  const timeSection = document.getElementById("timeSection");
  const editTimeButtons = document.getElementById("editTimeButtons");

  if (timeSection) {
    timeSection.classList.toggle("hidden", isHoliday || isReminder);
  }
  if (editTimeButtons) {
    editTimeButtons.classList.add("hidden");
  }

  // ✅ TAMBAH: REMINDER DATE SECTION
  if (isReminder) {
    // Tampilkan section tanggal reminder
    const reminderDateSection = document.getElementById("reminderDateSection");
    if (reminderDateSection) {
      reminderDateSection.classList.remove("hidden");
      
      const reminderDateEl = document.getElementById("detailReminderDate");
      const reminderDateDisplay = document.getElementById("reminderDateDisplay");
      
      if (reminderDateEl && reminderDateDisplay) {
        const dateStr = startDate.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        reminderDateDisplay.innerText = dateStr;
        
        // ✅ PERBAIKI: Gunakan helper function untuk format YYYY-MM-DD dengan local timezone
        reminderDateEl.value = toLocalDateString(startDate);
      }
    }
  } else {
    // Sembunyikan untuk event biasa
    const reminderDateSection = document.getElementById("reminderDateSection");
    if (reminderDateSection) {
      reminderDateSection.classList.add("hidden");
    }
  }

  function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

  // Start Time & Date (hanya untuk event biasa)
  const startTimeEl = document.getElementById("detailStartTime");
  const startDateEl = document.getElementById("detailStartDate");
  if (startTimeEl && startDateEl && !isHoliday && !isReminder) {
    const timeStr = startDate.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const dateStr = startDate.toLocaleDateString("id-ID", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    startTimeEl.innerText = timeStr;
    startDateEl.innerText = dateStr;
  }

    // End Time & Date
    const endTimeEl = document.getElementById("detailEndTime");
    const endDateEl = document.getElementById("detailEndDate");
    if (endTimeEl && endDateEl && !isHoliday && !isReminder) {
      const timeStr = endDate.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      const dateStr = endDate.toLocaleDateString("id-ID", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      endTimeEl.innerText = timeStr;
      endDateEl.innerText = dateStr;
    }

    // Duration
    const detailDurationEl = document.getElementById("detailDuration");
    if (detailDurationEl) {
      if (isHoliday || isReminder) {
        detailDurationEl.parentElement.parentElement.classList.add("hidden");
      } else {
        const durationMs = endDate - startDate;
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const minutes = Math.floor(
          (durationMs % (1000 * 60 * 60)) / (1000 * 60)
        );
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        detailDurationEl.innerText = durationStr;
      }
    }

        const documentationSection = document.getElementById("documentationSection");
  const docEmpty = document.getElementById("documentationEmpty");
  const docWithContent = document.getElementById("documentationWithContent");
  const docData = props.documentations || [];

  if (documentationSection) {
    if (!isHoliday && !isReminder) {
      // Event (bukan Holiday/Reminder) - tampilkan dokumentasi section
      documentationSection.classList.remove("hidden");
      
      if (docData.length > 0) {
        // Ada dokumentasi - tampilkan slider
        docEmpty.classList.add("hidden");
        docWithContent.classList.remove("hidden");
        currentDocumentations = docData;
        currentDocumentationIndex = 0;
        renderCurrentDocumentation();
        renderDocumentationIndicators();
      } else {
        // Belum ada dokumentasi - tampilkan empty state
        docWithContent.classList.add("hidden");
        docEmpty.classList.remove("hidden");
        currentDocumentations = [];
      }
    } else {
      // Holiday/Reminder - sembunyikan dokumentasi
      documentationSection.classList.add("hidden");
      currentDocumentations = [];
    }
  }

  



    // Event Details Grid (untuk event biasa)
    const eventDetailsGrid = document.getElementById("eventDetailsGrid");
    const notesSection = document.getElementById("notesSection");

    if (eventDetailsGrid) {
      eventDetailsGrid.classList.toggle("hidden", isHoliday || isReminder);
    }
    if (notesSection) {
      notesSection.classList.remove("hidden");
    }

    // ===== POSTER (Event Only) =====
    
    if (posterContainer && posterEmpty) {
      if (!isHoliday && !isReminder && props.poster_path) {
        // Ada poster, tampilkan gambar
        document.getElementById("detailPoster").src = props.poster_path;
        posterContainer.classList.remove("hidden");
        posterEmpty.classList.add("hidden");
      } else if (!isHoliday && !isReminder) {
        // Tidak ada poster, tampilkan tombol tambah
        posterContainer.classList.add("hidden");
        posterEmpty.classList.remove("hidden");
      } else {
        // Holiday atau Reminder, sembunyikan keduanya
        posterContainer.classList.add("hidden");
        posterEmpty.classList.add("hidden");
      }
    }

    // ===== RUANGAN =====
    const detailRoomEl = document.getElementById("detailRoom");
    if (detailRoomEl) {
      if (isHoliday || isReminder) {
        detailRoomEl.parentElement.parentElement.parentElement.classList.add(
          "hidden"
        );
      } else {
        detailRoomEl.parentElement.parentElement.parentElement.classList.remove(
          "hidden"
        );
        detailRoomEl.innerText = props.room_name || "-";

        const roomSelect = document.getElementById("editRoomSelect");
        if (roomSelect) {
          roomSelect.innerHTML =
            '<option value="">-- Pilih Ruangan --</option>';
          roomsCache.forEach((room) => {
            roomSelect.innerHTML += `<option value="${room.id}" ${
              room.id == props.room_id ? "selected" : ""
            }>${room.name}</option>`;
          });
          roomSelect.value = props.room_id || "";
        }
      }
    }

    // ===== ORGANIZER =====
    const detailOrganizerEl = document.getElementById("detailOrganizer");
    if (detailOrganizerEl) {
      if (isHoliday || isReminder) {
        detailOrganizerEl.parentElement.parentElement.parentElement.classList.add(
          "hidden"
        );
      } else {
        detailOrganizerEl.parentElement.parentElement.parentElement.classList.remove(
          "hidden"
        );
        detailOrganizerEl.innerText = props.organizer_name || "-";
      }
    }

    // ===== PHONE =====
    const detailPhoneEl = document.getElementById("detailOrganizerPhone");
    if (detailPhoneEl) {
      if (isHoliday || isReminder) {
        detailPhoneEl.parentElement.parentElement.parentElement.classList.add(
          "hidden"
        );
      } else {
        detailPhoneEl.parentElement.parentElement.parentElement.classList.remove(
          "hidden"
        );
        detailPhoneEl.innerText = props.organizer_phone || "-";
      }
    }

    // ===== PIC =====
    const detailPicEl = document.getElementById("detailPic");
    if (detailPicEl) {
      if (isHoliday || isReminder) {
        detailPicEl.parentElement.parentElement.parentElement.classList.add(
          "hidden"
        );
      } else {
        detailPicEl.parentElement.parentElement.parentElement.classList.remove(
          "hidden"
        );
        detailPicEl.innerText = props.pic_name || "-";
      }
    }

    // ===== PARTICIPANTS (dengan validasi kapasitas) =====
    const detailParticipantsEl = document.getElementById("detailParticipants");
    if (detailParticipantsEl) {
      if (isHoliday || isReminder) {
        detailParticipantsEl.parentElement.parentElement.parentElement.classList.add(
          "hidden"
        );
      } else {
        detailParticipantsEl.parentElement.parentElement.parentElement.classList.remove(
          "hidden"
        );
        detailParticipantsEl.innerText = props.participants_count
          ? `${props.participants_count} Orang`
          : "-";
        
        // ✅ TAMBAH: Setup edit participants dengan validasi
        const editParticipantsEl = document.getElementById("editParticipants");
        const warningEl = document.getElementById("detailParticipantsWarning") || 
          createParticipantsWarning();
        
        if (editParticipantsEl) {
          editParticipantsEl.addEventListener("input", validateParticipantsCapacity);
          // Initial validation
          setTimeout(() => validateParticipantsCapacity(), 100);
        }
      }
    }
    
    // ✅ TAMBAH: Helper function untuk buat warning element
    function createParticipantsWarning() {
      const warningEl = document.createElement("div");
      warningEl.id = "detailParticipantsWarning";
      warningEl.className = "hidden rounded-lg p-2 text-red-600 text-xs font-semibold bg-red-50 border border-red-200 mt-2";
      
      const editParticipantsEl = document.getElementById("editParticipants");
      if (editParticipantsEl && editParticipantsEl.parentElement) {
        editParticipantsEl.parentElement.appendChild(warningEl);
      }
      
      return warningEl;
    }
  
    
    // ✅ TAMBAH: Update validation saat room berubah
    const editRoomSelect = document.getElementById("editRoomSelect");
    if (editRoomSelect) {
      editRoomSelect.addEventListener("change", validateParticipantsCapacity);
    }

    // ===== NOTES =====
    const detailNotesEl = document.getElementById("detailNotes");

    if (notesSection) {
      // Tampilkan untuk event biasa dan reminder
      if (isHoliday) {
        notesSection.classList.add("hidden");
      } else {
        notesSection.classList.remove("hidden");
      }
    }

    if (detailNotesEl) {
      const notesText = isHoliday ? props.keterangan : props.notes;
      detailNotesEl.innerText = notesText || "-";
    }

    // ===== MEETING LINK (dengan truncate) =====
    const meetingLinkContainer = document.getElementById(
      "detailMeetingLinkContainer"
    );
    if (meetingLinkContainer) {
      if (!isHoliday && !isReminder) {
        if (props.meeting_link) {
          // ✅ ADA LINK - Tampilkan link
          const meetingLink = document.getElementById("detailMeetingLink");
          const meetingLinkText = document.getElementById("meetingLinkText");
          const meetingLinkIcon = document.getElementById("meetingLinkIcon");

          if (meetingLink && meetingLinkText) {
            const linkDetection = detectLinkType(props.meeting_link);

            meetingLink.href = props.meeting_link;
            meetingLinkText.textContent = `Go to ${linkDetection.label}`;
            meetingLink.title = props.meeting_link;

            // Update icon - JANGAN PAKSA UKURAN
            if (meetingLinkIcon) {
              meetingLinkIcon.src = `/images/link-icons/${linkDetection.icon}`;
              // ✅ HILANGKAN width & height - biarkan ukuran asli
              meetingLinkIcon.style.width = "auto";
              meetingLinkIcon.style.height = "auto";
              meetingLinkIcon.style.maxWidth = "1.5rem";
              meetingLinkIcon.style.maxHeight = "1.5rem";
              meetingLinkIcon.style.objectFit = "contain";
              meetingLinkIcon.onerror = function () {
                this.style.display = "none";
              };
            }
          }
          meetingLinkContainer.classList.remove("hidden");
        } else {
          // ✅ TIDAK ADA LINK - Tampilkan tombol tambah
          const meetingLink = document.getElementById("detailMeetingLink");
          const meetingLinkText = document.getElementById("meetingLinkText");
          const meetingLinkIcon = document.getElementById("meetingLinkIcon");

          if (meetingLink && meetingLinkText) {
            // Ubah ke button style
            meetingLink.className = "flex items-center gap-2 bg-gray-50 border-2 border-dashed border-gray-300 px-4 py-3 rounded-lg text-gray-600 font-semibold hover:bg-gray-100 hover:border-blue-400 transition cursor-pointer";
            meetingLink.href = "#";
            meetingLink.style.display = "flex";
            meetingLink.onclick = function(e) {
              e.preventDefault();
              window.toggleEditMeetingLink();
            };
            
            meetingLinkText.textContent = "Tambah Link Meeting";
            
            if (meetingLinkIcon) {
              meetingLinkIcon.innerHTML = '<i class="fas fa-plus text-lg"></i>';
              meetingLinkIcon.style.width = "auto";
              meetingLinkIcon.style.height = "auto";
            }
          }
          meetingLinkContainer.classList.remove("hidden");
        }
      } else {
        meetingLinkContainer.classList.add("hidden");
      }
    }

    // ===== SET EDIT INPUT VALUES =====
    const editEventTitleEl = document.getElementById("editEventTitle");
    if (editEventTitleEl) {
      editEventTitleEl.value = eventObj.title.split(" (")[0];
    }

    const editOrganizerEl = document.getElementById("editOrganizer");
    if (editOrganizerEl) {
      editOrganizerEl.value = props.organizer_name || "";
    }

    const editPhoneEl = document.getElementById("editPhone");
    if (editPhoneEl) {
      editPhoneEl.value = props.organizer_phone || "";
    }

    const editPicEl = document.getElementById("editPic");
    if (editPicEl) {
      editPicEl.value = props.pic_name || "";
    }

    const editParticipantsEl = document.getElementById("editParticipants");
    if (editParticipantsEl) {
      editParticipantsEl.value = props.participants_count || "";
    }

    const editNotesEl = document.getElementById("editNotes");
    if (editNotesEl) {
      editNotesEl.value = props.notes || "";
    }

    const editStartTimeEl = document.getElementById("editStartTime");
    if (editStartTimeEl) {
      editStartTimeEl.value = toDatetimeLocal(startDate);
    }

    const editEndTimeEl = document.getElementById("editEndTime");
    if (editEndTimeEl) {
      editEndTimeEl.value = toDatetimeLocal(endDate);
    }

    const editMeetingLinkEl = document.getElementById("editMeetingLink");
    if (editMeetingLinkEl) {
      editMeetingLinkEl.value = props.meeting_link || "";
    }

    // ===== NORMAL & EDIT ACTIONS =====
        const normalActions = document.getElementById("normalActions");
    const editActions = document.getElementById("editActions");

    // ✅ PERBAIKI: Holiday BISA dihapus, tapi tidak bisa edit
    if (isHoliday) {
      if (normalActions) normalActions.classList.remove("hidden");
      if (editActions) editActions.classList.add("hidden");
    } else {
      // Event biasa dan Reminder sama-sama bisa edit dan delete
      if (normalActions) normalActions.classList.remove("hidden");
      if (editActions) editActions.classList.add("hidden");
    }

    // ===== BUKA DRAWER =====
    const drawer = document.getElementById("eventDrawer");
    const drawerOverlay = document.getElementById("eventDrawerOverlay");

    if (drawer) drawer.classList.remove("translate-x-full");
    if (drawerOverlay) drawerOverlay.classList.remove("hidden");
  };

  document
    .getElementById("editPosterInput")
    .addEventListener("change", async function () {
      if (!currentEventId || !this.files.length) return;
      
      const file = this.files[0];
      const formData = new FormData();
      formData.append("poster", file);
  
      // Tampilkan loading
      const posterContainer = document.getElementById("detailPosterContainer");
      const posterEmpty = document.getElementById("detailPosterEmpty");
      const originalHTML = posterContainer.innerHTML;
  
      try {
        const res = await fetch(
          `/${calendarName}/events/${currentEventId}/poster`,
          {
            method: "POST",
            body: formData,
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Gagal upload poster");
  
        // Update poster di drawer
        if (data.poster_path) {
          document.getElementById("detailPoster").src = data.poster_path;
          posterContainer.classList.remove("hidden");
          if (posterEmpty) posterEmpty.classList.add("hidden");
        }
        showToast("Poster berhasil diunggah", "success");
        
        // Update event di kalender
        const event = calendar.getEventById(currentEventId);
        if (event) event.setExtendedProp("poster_path", data.poster_path);
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        this.value = "";
      }
    });

  window.openPosterModal = function () {
    const posterImg = document.getElementById("detailPoster");
    const posterModalImg = document.getElementById("posterModalImg");
    const modal = document.getElementById("posterModal");
    
    if (!posterImg || !posterModalImg || !modal) {
      console.error("❌ Elemen poster modal tidak ditemukan");
      return;
    }
    
    if (!posterImg.src || posterImg.src === '') {
      console.warn("⚠️ Poster src kosong");
      return;
    }
    
    posterModalImg.src = posterImg.src;
    modal.classList.remove("hidden");
  
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handlePosterKeydown);
  };
  
  window.closePosterModal = function () {
    const modal = document.getElementById("posterModal");
  
    if (!modal) return;
    modal.classList.add("hidden");
  
    document.body.style.overflow = "auto";
    document.removeEventListener("keydown", handlePosterKeydown);
  };
  
  // ✅ HANDLE KEYBOARD ESC
  function handlePosterKeydown(e) {
    if (e.key === "Escape") {
      closePosterModal();
    }
  }
  
  // ✅ CLOSE SAAT KLIK OVERLAY
  document.addEventListener("click", function(e) {
    const modal = document.getElementById("posterModal");
    if (!modal) return;
    
    // Klik di modal element sendiri (bukan di gambar)
    if (e.target.id === "posterModal") {
      closePosterModal();
    }
  });
    
    window.closePosterModal = function () {
  const modal = document.getElementById("posterModal");
  const drawerDimOverlay = document.getElementById("drawerDimOverlay");

  if (!modal) return;
  modal.classList.add("hidden");

  // ✅ HILANGKAN OVERLAY
  if (drawerDimOverlay) {
    drawerDimOverlay.style.display = "none";
  }

  document.body.style.overflow = "auto";
  document.removeEventListener("keydown", handlePosterKeydown);
};


    
    // ✅ HANDLE KEYBOARD ESC
    function handlePosterKeydown(e) {
      if (e.key === "Escape") {
        closePosterModal();
      }
    }
    
    // ✅ CLOSE SAAT KLIK OVERLAY
    document.addEventListener("click", function(e) {
      const modal = document.getElementById("posterModal");
      if (!modal) return;
      
      // ✅ PERBAIKI: Modal element ini sendiri, bukan child
      if (e.target.id === "posterModal") {
        closePosterModal();
      }
    });
  
  // ✅ HANDLE KEYBOARD ESC
  function handlePosterKeydown(e) {
    if (e.key === "Escape") {
      closePosterModal();
    }
  }
  
  // ✅ CLOSE SAAT KLIK OVERLAY
  document.addEventListener("click", function(e) {
    const modal = document.getElementById("posterModal");
    if (!modal) return;
    
    // ✅ PERBAIKI: Modal element ini sendiri, bukan child
    if (e.target.id === "posterModal") {
      closePosterModal();
    }
  });


  window.closeDrawer = function () {
    drawer.classList.add("translate-x-full");
    drawerOverlay.classList.add("hidden");
    currentEventId = null;
    if (currentEditMode) cancelEdit();
  };

  window.openDocumentationModal = function () {
  const docImg = document.getElementById("documentationImg");
  const docModal = document.getElementById("documentationModal");
  const docModalImg = document.getElementById("documentationModalImg");
  
  if (!docImg || !docImg.src || docImg.src === '' || docImg.classList.contains('hidden')) {
    console.warn("⚠️ Dokumentasi gambar tidak ditemukan atau video yang ditampilkan");
    return;
  }
  
  if (!docModal || !docModalImg) {
    console.error("❌ Elemen modal dokumentasi tidak ditemukan");
    return;
  }
  
  docModalImg.src = docImg.src;
  docModal.classList.remove("hidden");

  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", handleDocumentationKeydown);
};

window.closeDocumentationModal = function () {
  const modal = document.getElementById("documentationModal");

  if (!modal) return;
  modal.classList.add("hidden");

  document.body.style.overflow = "auto";
  document.removeEventListener("keydown", handleDocumentationKeydown);
};

// ✅ HANDLE KEYBOARD ESC untuk dokumentasi
function handleDocumentationKeydown(e) {
  if (e.key === "Escape") {
    closeDocumentationModal();
  }
}
document.addEventListener("click", function(e) {
  const modal = document.getElementById("documentationModal");
  if (!modal) return;
  
  // Klik di modal element sendiri (bukan di gambar)
  if (e.target.id === "documentationModal") {
    closeDocumentationModal();
  }
});

  window.setQuickTime = function (period) {
    let currentVal = document.getElementById("startTime").value;
    if (!currentVal) {
      showToast("Silakan pilih tanggal di input Mulai dulu", "info");
      return;
    }

    let datePart = currentVal.split("T")[0];

    let startT, endT;
    if (period === "pagi") {
      startT = "09:00";
      endT = "12:00";
    }
    if (period === "siang") {
      startT = "13:30";
      endT = "17:00";
    }
    if (period === "malam") {
      startT = "18:30";
      endT = "21:00";
    }

    document.getElementById("startTime").value = `${datePart}T${startT}`;
    document.getElementById("endTime").value = `${datePart}T${endT}`;

    checkAvailability();
  };


  window.toggleEditMeetingLink = function() {
    if (currentEditMode) cancelEdit();
  
    currentEditMode = "meetingLink";
    
    const displayEl = document.getElementById("detailMeetingLinkContainer");
    const inputContainerEl = document.getElementById("editMeetingLinkInputContainer");
    const inputEl = document.getElementById("editMeetingLinkInput");
  
    if (!displayEl || !inputContainerEl || !inputEl) {
      console.warn("⚠️ Meeting link elements tidak ditemukan");
      currentEditMode = null;
      return;
    }
  
    // Isi input dengan nilai yang ada
    const currentLink = displayEl.querySelector('#detailMeetingLink');
    if (currentLink) {
      inputEl.value = currentLink.href || "";
    }
  
    // Sembunyikan display container, tampilkan input container
    displayEl.classList.add("hidden");
    inputContainerEl.classList.remove("hidden");
    inputEl.classList.remove("hidden");
    inputEl.focus();
  
    // Tampilkan tombol simpan/batal
    document.getElementById("editActions").classList.remove("hidden");
    document.getElementById("normalActions").classList.add("hidden");
  };

  window.toggleEditMode = function (field) {
    if (currentEditMode) cancelEdit();
  
    currentEditMode = field;
    editData = { field };
  
    // Special handling untuk berbagai fields
    let displayId, inputId;
  
    if (field === "room") {
      displayId = "detailRoom";
      inputId = "editRoomSelect";
    } else if (field === "eventTitle") {
      displayId = "detailTitle";
      inputId = "editEventTitle";
    } else if (field === "reminderDate") {
      // ✅ TAMBAH: Handle reminder date
      const reminderDateDisplay = document.getElementById("reminderDateDisplay");
      const reminderDateInput = document.getElementById("detailReminderDate");
  
      if (!reminderDateDisplay || !reminderDateInput) {
        console.warn("⚠️ Reminder date elements tidak ditemukan");
        currentEditMode = null;
        return;
      }
  
      reminderDateDisplay.classList.add("hidden");
      reminderDateInput.classList.remove("hidden");
      reminderDateInput.focus();
  
      document.getElementById("editActions").classList.remove("hidden");
      document.getElementById("normalActions").classList.add("hidden");
      return;
    } else if (field === "startTime" || field === "endTime") {
      // Handle time edit
      const timeSection = document.getElementById("timeSection");
      const editTimeButtons = document.getElementById("editTimeButtons");
  
      if (timeSection) timeSection.classList.add("hidden");
      if (editTimeButtons) editTimeButtons.classList.remove("hidden");
  
      document.getElementById("editActions").classList.remove("hidden");
      document.getElementById("normalActions").classList.add("hidden");
  
      currentEditMode = field;
      
      // ✅ PERBAIKI: Focus ke input yang sesuai
      const inputEl = document.getElementById(`edit${capitalizeFirst(field)}`);
      if (inputEl) {
        setTimeout(() => inputEl.focus(), 100);
      }
      
      return;
    } else if (field === "phone") {
      // ✅ PERBAIKI: Gunakan ID yang benar
      displayId = "detailOrganizerPhone";
      inputId = "editPhone";
    } else if (field === "organizer") {
      displayId = "detailOrganizer";
      inputId = "editOrganizer";
    } else if (field === "pic") {
      displayId = "detailPic";
      inputId = "editPic";
    } else if (field === "participants") {
      displayId = "detailParticipants";
      inputId = "editParticipants";
    } else if (field === "notes") {
      displayId = "detailNotes";
      inputId = "editNotes";
    } else {
      displayId = `detail${capitalizeFirst(field)}`;
      inputId = `edit${capitalizeFirst(field)}`;
    }
  
    // Null check untuk semua element
    const displayEl = document.getElementById(displayId);
    const inputEl = document.getElementById(inputId);
  
    if (!displayEl) {
      console.warn(`⚠️ Display element dengan ID '${displayId}' tidak ditemukan`);
      currentEditMode = null;
      return;
    }
  
    if (!inputEl) {
      console.warn(`⚠️ Input element dengan ID '${inputId}' tidak ditemukan`);
      currentEditMode = null;
      return;
    }
  
    // Sembunyikan display, tampilkan input
    displayEl.classList.add("hidden");
    inputEl.classList.remove("hidden");
    inputEl.focus();
  
    // Tampilkan tombol simpan/batal
    document.getElementById("editActions").classList.remove("hidden");
    document.getElementById("normalActions").classList.add("hidden");
  };
  
  // ...existing code...
  
  window.cancelEdit = function () {
    if (!currentEditMode) return;
  
    // Special handling untuk berbagai field
    let displayId, inputId;
  
    if (currentEditMode === "room") {
      displayId = "detailRoom";
      inputId = "editRoomSelect";
    } else if (currentEditMode === "eventTitle") {
      displayId = "detailTitle";
      inputId = "editEventTitle";
    } else if (currentEditMode === "reminderDate") {
      // ✅ TAMBAH: Handle reminder date cancel
      const reminderDateDisplay = document.getElementById("reminderDateDisplay");
      const reminderDateInput = document.getElementById("detailReminderDate");
  
      if (reminderDateDisplay) reminderDateDisplay.classList.remove("hidden");
      if (reminderDateInput) reminderDateInput.classList.add("hidden");
  
      currentEditMode = null;
      const editActions = document.getElementById("editActions");
      const normalActions = document.getElementById("normalActions");
      if (editActions) editActions.classList.add("hidden");
      if (normalActions) normalActions.classList.remove("hidden");
      return;
    } else if (currentEditMode === "meetingLink") {
      const displayEl = document.getElementById("detailMeetingLinkContainer");
      const inputEl = document.getElementById("editMeetingLinkInputContainer");
      if (displayEl) displayEl.classList.remove("hidden");
      if (inputEl) inputEl.classList.add("hidden");
  
      currentEditMode = null;
      const editActions = document.getElementById("editActions");
      const normalActions = document.getElementById("normalActions");
      if (editActions) editActions.classList.add("hidden");
      if (normalActions) normalActions.classList.remove("hidden");
      return;
    } else if (
      currentEditMode === "startTime" ||
      currentEditMode === "endTime"
    ) {
      const timeSection = document.getElementById("timeSection");
      const editTimeButtons = document.getElementById("editTimeButtons");
      if (timeSection) timeSection.classList.remove("hidden");
      if (editTimeButtons) editTimeButtons.classList.add("hidden");
  
      currentEditMode = null;
      const editActions = document.getElementById("editActions");
      const normalActions = document.getElementById("normalActions");
      if (editActions) editActions.classList.add("hidden");
      if (normalActions) normalActions.classList.remove("hidden");
      return;
    } else {
      // ✅ PERBAIKI: Mapping display ID yang benar
      const displayIdMap = {
        eventTitle: "detailTitle",
        organizer: "detailOrganizer",
        phone: "detailOrganizerPhone", // ✅ Perbaiki ID untuk phone
        pic: "detailPic",
        participants: "detailParticipants",
        notes: "detailNotes",
      };
      
      displayId = displayIdMap[currentEditMode] || `detail${capitalizeFirst(currentEditMode)}`;
      inputId = `edit${capitalizeFirst(currentEditMode)}`;
    }
  
    // Null check untuk semua element
    const displayEl = document.getElementById(displayId);
    const inputEl = document.getElementById(inputId);
  
    if (displayEl) displayEl.classList.remove("hidden");
    if (inputEl) inputEl.classList.add("hidden");
  
    // Sembunyikan tombol edit
    const editActions = document.getElementById("editActions");
    const normalActions = document.getElementById("normalActions");
    if (editActions) editActions.classList.add("hidden");
    if (normalActions) normalActions.classList.remove("hidden");
  
    currentEditMode = null;
    editData = {};
  };
  
  // ...existing code...
  
  window.saveEdit = async function () {
    if (!currentEventId || !currentEditMode) return;
  
    let newValue;
  
    // ✅ TAMBAH: Handle reminder date
    if (currentEditMode === "reminderDate") {
      const inputEl = document.getElementById("detailReminderDate");
      newValue = inputEl.value;
  
      if (!newValue) {
        showToast("Tanggal tidak boleh kosong", "error");
        return;
      }
    } else if (currentEditMode === "room") {
      newValue = document.getElementById("editRoomSelect").value;
    } else if (currentEditMode === "eventTitle") {
      const inputEl = document.getElementById("editEventTitle");
      newValue = inputEl.value;
    } else if (currentEditMode === "meetingLink") {
      const inputEl = document.getElementById("editMeetingLinkInput");
      newValue = inputEl.value.trim();
    } else if (
      currentEditMode === "startTime" ||
      currentEditMode === "endTime"
    ) {
      const inputEl = document.getElementById(
        `edit${capitalizeFirst(currentEditMode)}`
      );
      const datetimeLocalValue = inputEl.value;
  
      if (datetimeLocalValue) {
        newValue = `${datetimeLocalValue}:00`;
      } else {
        showToast("Waktu tidak boleh kosong", "error");
        return;
      }
    } else if (currentEditMode === "participants") {
      const inputEl = document.getElementById("editParticipants");
      newValue = inputEl.value;
      
      if (!newValue) {
        showToast("Jumlah peserta tidak boleh kosong", "error");
        return;
      }
      
      const editRoomSelect = document.getElementById("editRoomSelect");
      const roomId = editRoomSelect?.value;
      const participants = parseInt(newValue) || 0;
      
      if (roomId && participants > 0) {
        const room = roomsCache.find(r => r.id == roomId);
        if (room && participants > room.capacity) {
          showToast(`Peserta melebihi kapasitas ruangan! Maks: ${room.capacity} orang`, "error");
          return;
        }
      }
    } else {
      const inputEl = document.getElementById(
        `edit${capitalizeFirst(currentEditMode)}`
      );
      newValue = inputEl.value;
    }
  
    if (!newValue && currentEditMode !== "meetingLink") {
      showToast("Data tidak boleh kosong", "error");
      return;
    }
    
    try {
      const updateData = {};
      
      // ✅ PERBAIKAN: Handle Start/End Time secara khusus (kirim keduanya)
      if (currentEditMode === "startTime" || currentEditMode === "endTime") {
          const startInput = document.getElementById("editStartTime");
          const endInput = document.getElementById("editEndTime");
          
          // Ambil nilai dari kedua input
          if (startInput && startInput.value) {
              updateData["start_time"] = `${startInput.value}:00`;
          }
          if (endInput && endInput.value) {
              updateData["end_time"] = `${endInput.value}:00`;
          }
          
          // Validasi sederhana: Start tidak boleh lebih besar dari End
          if (updateData["start_time"] && updateData["end_time"]) {
              if (new Date(updateData["start_time"]) >= new Date(updateData["end_time"])) {
                  throw new Error("Waktu selesai harus setelah waktu mulai");
              }
          }
      } else {
          // Logic existing untuk field lain
          const fieldMap = {
            eventTitle: "title",
            organizer: "organizer_name",
            phone: "organizer_phone",
            pic: "pic_name",
            participants: "participants_count",
            notes: "notes",
            room: "room_id",
            meetingLink: "meeting_link",
            reminderDate: "reminder_date",
          };
          const dbField = fieldMap[currentEditMode];
          if (dbField) {
             updateData[dbField] = newValue;
          }
      }
      
  
      const res = await fetch(`/${calendarName}/events/${currentEventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
  
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
  
      showToast("Data berhasil diperbarui!", "success");
  
      // UPDATE event di calendar
      const event = calendar.getEventById(currentEventId);
  
      if (event) {
        if (currentEditMode === "eventTitle") {
          event.setProp("title", newValue);
        } else if (currentEditMode === "reminderDate") {
          event.setStart(newValue);
          event.setEnd(newValue);
          
          const dateStr = new Date(newValue).toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          const reminderDateDisplay = document.getElementById("reminderDateDisplay");
          if (reminderDateDisplay) reminderDateDisplay.innerText = dateStr;
        } else if (currentEditMode === "organizer") {
          event.setExtendedProp("organizer_name", newValue);
        } else if (currentEditMode === "phone") {
          event.setExtendedProp("organizer_phone", newValue);
        } else if (currentEditMode === "pic") {
          event.setExtendedProp("pic_name", newValue);
        } else if (currentEditMode === "participants") {
          event.setExtendedProp("participants_count", newValue);
        } else if (currentEditMode === "notes") {
          event.setExtendedProp("notes", newValue);
        } else if (currentEditMode === "startTime") {
          event.setStart(newValue);
        } else if (currentEditMode === "endTime") {
          event.setEnd(newValue);
        } else if (currentEditMode === "meetingLink") {
          event.setExtendedProp("meeting_link", newValue);
        } else if (currentEditMode === "room") {
          const selectedRoom = roomsCache.find((r) => r.id == newValue);
          event.setExtendedProp("room_id", newValue);
          event.setExtendedProp("room_name", selectedRoom?.name || "-");
          event.setExtendedProp("room_color", selectedRoom?.color || "#60a5fa");
        }
      }
  
      // Update tampilan
      if (currentEditMode === "room") {
        const selectedRoom = roomsCache.find((r) => r.id == newValue);
        document.getElementById("detailRoom").innerText =
          selectedRoom?.name || "-";
      } else if (currentEditMode === "reminderDate") {
        cancelEdit();
      } else if (currentEditMode === "meetingLink") {
        openDrawer(event);
      } else if (currentEditMode === "eventTitle") {
        document.getElementById("detailTitle").innerText = newValue;
      } else if (
        currentEditMode === "startTime" ||
        currentEditMode === "endTime"
      ) {
        // ✅ PERBAIKI: Jangan buka drawer ulang, hanya update display
        const startDate = event.start instanceof Date ? event.start : new Date(event.start);
        const endDate = event.end instanceof Date ? event.end : new Date(event.end);
  
        const startTimeEl = document.getElementById("detailStartTime");
        const startDateEl = document.getElementById("detailStartDate");
        const endTimeEl = document.getElementById("detailEndTime");
        const endDateEl = document.getElementById("detailEndDate");
        const durationEl = document.getElementById("detailDuration");
  
        if (startTimeEl && startDateEl) {
          const timeStr = startDate.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          const dateStr = startDate.toLocaleDateString("id-ID", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          startTimeEl.innerText = timeStr;
          startDateEl.innerText = dateStr;
        }
  
        if (endTimeEl && endDateEl) {
          const timeStr = endDate.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          const dateStr = endDate.toLocaleDateString("id-ID", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          endTimeEl.innerText = timeStr;
          endDateEl.innerText = dateStr;
        }
  
        if (durationEl) {
          const durationMs = endDate - startDate;
          const hours = Math.floor(durationMs / (1000 * 60 * 60));
          const minutes = Math.floor(
            (durationMs % (1000 * 60 * 60)) / (1000 * 60)
          );
          const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
          durationEl.innerText = durationStr;
        }
      } else {
        // ✅ PERBAIKI: Mapping display ID yang benar
        const displayIdMap = {
          eventTitle: "detailTitle",
          organizer: "detailOrganizer",
          phone: "detailOrganizerPhone", // ✅ Perbaiki ID untuk phone
          pic: "detailPic",
          participants: "detailParticipants",
          notes: "detailNotes",
        };
        
        const displayId = displayIdMap[currentEditMode] || `detail${capitalizeFirst(currentEditMode)}`;
        const displayEl = document.getElementById(displayId);
        
        if (displayEl) {
          if (currentEditMode === "participants") {
            displayEl.innerText = newValue + " Orang";
          } else {
            displayEl.innerText = newValue;
          }
        }
      }
  
      // ✅ PERBAIKI: Jangan close edit mode untuk startTime/endTime
      if (currentEditMode !== "reminderDate" && currentEditMode !== "startTime" && currentEditMode !== "endTime") {
        cancelEdit();
      } else {
        // Untuk time edit, manual cancel
        const timeSection = document.getElementById("timeSection");
        const editTimeButtons = document.getElementById("editTimeButtons");
        if (timeSection) timeSection.classList.remove("hidden");
        if (editTimeButtons) editTimeButtons.classList.add("hidden");
        
        const editActions = document.getElementById("editActions");
        const normalActions = document.getElementById("normalActions");
        if (editActions) editActions.classList.add("hidden");
        if (normalActions) normalActions.classList.remove("hidden");
        
        currentEditMode = null;
      }
      
      calendar.refetchEvents();
    } catch (err) {
      showToast(err.message, "error");
    }
  };


  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }


  document.getElementById("btnDeleteEvent").addEventListener("click", async () => {
    if (!currentEventId) return;
  
    const event = calendar.getEventById(currentEventId);
    const isHoliday = event?.extendedProps?.isHoliday || false;
  
    const result = await Swal.fire({
      title: isHoliday ? "Hapus Hari Libur?" : "Hapus Jadwal?",
      text: isHoliday ? "Hari libur ini akan dihapus dari kalender." : "Data tidak bisa dikembalikan!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#3b82f6",
      confirmButtonText: "Ya, Hapus!",
      cancelButtonText: "Batal",
    });
  
    if (result.isConfirmed) {
      try {
        if (isHoliday) {
          // ✅ PERBAIKI: Gunakan function deleteHoliday
          await deleteHoliday(currentEventId);
        } else {
          // HAPUS EVENT BIASA
          const res = await fetch(`/${calendarName}/events/${currentEventId}`, {
            method: "DELETE",
          });
          if (res.ok) {
            Swal.fire("Terhapus!", "Jadwal telah dihapus.", "success");
            closeDrawer();
            calendar.refetchEvents();
          } else {
            Swal.fire("Gagal!", "Terjadi kesalahan.", "error");
          }
        }
      } catch (err) {
        console.error(err);
        showToast("Terjadi kesalahan sistem", "error");
      }
    }
  });
  
  let currentToast = null; // Track toast aktif

  function showToast(msg, type = "info") {
    // Hapus toast sebelumnya jika masih ada
    if (currentToast) {
      currentToast.hideToast();
      currentToast = null;
    }

    let bgColor, icon, textColor, borderColor;

    if (type === "error") {
      bgColor = "#fee2e2"; // Merah muda
      icon = "fa-circle-xmark"; // Icon X merah
      borderColor = "#fca5a5"; // Border merah
      textColor = "#991b1b"; // Teks merah gelap
    } else if (type === "success") {
      bgColor = "#dcfce7"; // Hijau muda
      icon = "fa-circle-check"; // Icon check hijau
      borderColor = "#86efac"; // Border hijau
      textColor = "#15803d"; // Teks hijau gelap
    } else {
      bgColor = "#dbeafe"; // Biru muda
      icon = "fa-circle-info"; // Icon info biru
      borderColor = "#7dd3fc"; // Border biru
      textColor = "#0c4a6e"; // Teks biru gelap
    }

    currentToast = Toastify({
      text: `<div style="display: flex; align-items: center; gap: 12px; width: 100%;">
      <i class="fas ${icon}" style="font-size: 20px; flex-shrink: 0; color: ${textColor};"></i>
      <span style="font-weight: 600; font-size: 14px; flex: 1; color: ${textColor};">${msg}</span>
      <button onclick="this.closest('.toastify').remove();" style="background: none; border: none; color: ${textColor}; cursor: pointer; font-size: 18px; padding: 0; margin: 0; display: flex; align-items: center;">
        <i class="fas fa-times"></i>
      </button>
    </div>`,
      duration: 4000,
      close: false,
      gravity: "top",
      position: "center",
      escapeMarkup: false, // ✅ PENTING: Allow HTML
      style: {
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: "12px",
        padding: "16px 20px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        color: textColor,
        minWidth: "350px", // ✅ Lebar minimum
        maxWidth: "500px", // ✅ Lebar maksimum
      },
      stopOnFocus: true,
      onClick: function () {},
    }).showToast();
  }

  function detectLinkType(url) {
    const urlLower = url.toLowerCase();

    const linkTypes = {
      zoom: {
        keywords: ["zoom.us", "zoom.com"],
        icon: "zoom-icon.png",
        label: "Zoom",
      },
      google_meet: {
        keywords: ["meet.google.com", "google.com/meet"],
        icon: "google-meet-icon.png",
        label: "Google Meet",
      },
      teams: {
        keywords: ["teams.microsoft.com", "teams.live.com"],
        icon: "teams-icon.png",
        label: "Microsoft Teams",
      },
      discord: {
        keywords: ["discord.com", "discord.gg"],
        icon: "discord-icon.png",
        label: "Discord",
      },
      tiktok: {
        keywords: ["tiktok.com", "vt.tiktok.com", "vm.tiktok.com"],
        icon: "tiktok-icon.png",
        label: "TikTok",
      },
      youtube: {
        keywords: ["youtube.com", "youtu.be"],
        icon: "youtube-icon.png",
        label: "YouTube",
      },
      instagram: {
        keywords: ["instagram.com", "instagr.am"],
        icon: "instagram-icon.png",
        label: "Instagram",
      },
      facebook: {
        keywords: ["facebook.com", "fb.com"],
        icon: "facebook-icon.png",
        label: "Facebook",
      },
      whatsapp: {
        keywords: ["whatsapp.com", "wa.me"],
        icon: "whatsapp-icon.png",
        label: "WhatsApp",
      },
      telegram: {
        keywords: ["telegram.org", "t.me"],
        icon: "telegram-icon.png",
        label: "Telegram",
      },
      drive: {
        keywords: ["drive.google.com"],
        icon: "google-drive-icon.png",
        label: "Google Drive",
      },
      dropbox: {
        keywords: ["dropbox.com"],
        icon: "dropbox-icon.png",
        label: "Dropbox",
      },
      github: {
        keywords: ["github.com"],
        icon: "github-icon.png",
        label: "GitHub",
      },
      figma: {
        keywords: ["figma.com"],
        icon: "figma-icon.png",
        label: "Figma",
      },
      slack: {
        keywords: ["slack.com"],
        icon: "slack-icon.png",
        label: "Slack",
      },
    };

    // Loop melalui setiap tipe link
    for (const [key, config] of Object.entries(linkTypes)) {
      for (const keyword of config.keywords) {
        if (urlLower.includes(keyword)) {
          return {
            type: key,
            icon: config.icon,
            label: config.label,
          };
        }
      }
    }

    // Default jika tidak terdeteksi
    return {
      type: "default",
      icon: "link-icon.png",
      label: "Link",
    };
  }

  // --- 5. ADD ROOM MODAL ---

  window.openAddRoomModal = function () {
    addRoomModal.classList.remove("hidden");
    const formModal = document.getElementById("addRoomFormModal");
    if (formModal) formModal.reset();
  };

  window.closeAddRoomModal = function () {
    addRoomModal.classList.add("hidden");
  };

  // ADD PROPER NULL CHECK untuk form
  const addRoomFormModal = document.getElementById("addRoomFormModal");
  if (addRoomFormModal) {
    addRoomFormModal.addEventListener("submit", async function (e) {
      e.preventDefault();
      const formData = new FormData(this);
      const data = Object.fromEntries(formData.entries());

      try {
        const res = await fetch(`/${calendarName}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (res.ok) {
          showToast("Ruangan berhasil ditambahkan", "success");
          closeAddRoomModal();
          loadRooms();
          calendar.refetchEvents();
        } else {
          showToast("Gagal menambah ruangan", "error");
        }
      } catch (err) {
        console.error(err);
        showToast("Terjadi kesalahan", "error");
      }
    });
  }


  // --- 7. APPLY FILTER ---
  window.applyFilter = function (roomId) {
    activeRoomFilter = roomId;
    calendar.refetchEvents();
  };

  async function loadHolidaysByYear(year) {
  try {
    const response = await fetch(`/api/holidays/${year}`);
    const result = await response.json();

    if (!result.is_success || !result.data) {
      console.warn(`⚠️ No holidays data for ${year}`);
      return [];
    }

    const holidayEvents = result.data.map((holiday) => ({
      title: `${holiday.name}`,
      start: holiday.date,
      allDay: true,
      backgroundColor: "#dc2626",
      borderColor: "#dc2626",
      textColor: "#fff",
      editable: false,
      extendedProps: {
        isHoliday: true,
        keterangan: holiday.name,
        type: holiday.type,
        is_joint_holiday: holiday.is_joint_holiday,
        is_observance: holiday.is_observance,
      },
    }));

    return holidayEvents;
  } catch (err) {
    console.error(`❌ Error loading holidays for ${year}:`, err);
    return [];
  }
}

async function loadAllHolidays() {
  try {
    const currentYear = new Date().getFullYear();
    
    
    // Load untuk 3 tahun ke depan
    for (let year = currentYear; year <= currentYear + 2; year++) {
      // ✅ LOAD DARI DATABASE
      const dbRes = await fetch(`/${calendarName}/holidays-by-year/${year}`);
      const dbData = await dbRes.json();
      
      if (dbData.success && dbData.holidays && dbData.holidays.length > 0) {
        
        // Tambah ke calendar
        dbData.holidays.forEach(holiday => {
          calendar.addEvent({
            id: `holiday-${year}-${holiday.id}`, // ✅ UNIQUE ID
            title: holiday.title,
            start: holiday.start_time,
            allDay: true,
            backgroundColor: "#dc2626",
            borderColor: "#dc2626",
            textColor: "#fff",
            editable: false,
            extendedProps: {
              isHoliday: true,
              keterangan: holiday.notes || holiday.title,
            },
          });
        });
      }
    }
    
  } catch (err) {
    console.error("❌ Error loading all holidays:", err);
  }
}


  async function loadHolidays() {
    try {
      // Gunakan endpoint proxy dari backend
      const currentYear = new Date().getFullYear();
      const response = await fetch(`/api/holidays?year=${currentYear}`);
      const result = await response.json();

      if (!result.is_success || !result.data) {
        console.warn("Gagal load holidays dari API");
        return;
      }

      const holidayEvents = result.data.map((holiday) => ({
        title: `${holiday.name}`,
        start: holiday.date,
        allDay: true,
        backgroundColor: "#dc2626",
        borderColor: "#dc2626",
        textColor: "#fff",
        editable: false,
        extendedProps: {
          isHoliday: true,
          keterangan: holiday.name,
          type: holiday.type,
          is_joint_holiday: holiday.is_joint_holiday,
          is_observance: holiday.is_observance,
        },
      }));

      holidayEvents.forEach((event) => {
        calendar.addEvent(event);
      });

      console.log(
        `✅ ${result.data.length} hari libur Indonesia berhasil dimuat`
      );
    } catch (err) {
      console.error("Gagal load holidays:", err);
    }
  }

  
  window.openSettingsModal = async function () {
    document.getElementById("settingsModal").classList.remove("hidden");
  
    const settingsModal = document.getElementById("settingsModal");
    if (settingsModal) {
      settingsModal.classList.remove("hidden");
    }
  
    try {
      const res = await fetch(`/${calendarName}/settings`);
      const data = await res.json();
      document.getElementById("toggleDoubleBooking").checked =
        !!data.allow_double_booking;
    } catch (e) {}
  
    // ✅ TAMBAH: Setup PIN listeners di sini
    setTimeout(() => {
      checkPinStatus();
      setupPinEventListeners();
    }, 100);
  
    // ✅ GUNAKAN loadSettingsRoomList (bukan renderSettingsRoomList)
    await loadSettingsRoomList();
  };

  window.closeSettingsModal = function () {
    document.getElementById("settingsModal").classList.add("hidden");
    loadRooms();
    calendar.refetchEvents();
  };

window.deleteRoom = async function (id) {
  if (
    !confirm(
      "Yakin hapus ruangan ini? Data event di dalamnya juga akan terhapus!"
    )
  )
    return;

  try {
    const res = await fetch(`/${calendarName}/rooms/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      renderSettingsRoomList();
      loadRooms();
      showToast("Ruangan dihapus", "success");
    }
  } catch (err) {
    showToast("Gagal hapus", "error");
  }
};

// ===== LOAD ROOM LIST DI SETTINGS (DENGAN MOVE UP BUTTON) =====
async function loadSettingsRoomList() {
  try {
    const res = await fetch(`/${calendarName}/rooms`);
    const roomList = document.getElementById('settingsRoomList');
    
    if (!res.ok) {
      roomList.innerHTML = '<div class="text-center py-8 text-gray-400">Gagal memuat ruangan</div>';
      return;
    }
    
    const rooms = await res.json();

    if (!rooms || rooms.length === 0) {
      roomList.innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fas fa-inbox text-2xl mb-2 block"></i> Belum ada ruangan</div>';
      return;
    }

    roomList.innerHTML = `
      <div class="space-y-3">
        ${rooms.map((room, index) => `
          <div class="bg-white rounded-lg border-2 border-gray-200 hover:border-blue-300 hover:shadow-md transition p-3" data-room-id="${room.id}" data-room-color="${room.color}">
            <!-- ROW 1: Warna, Nama, Move Up Button -->
            <div class="flex items-center justify-between gap-3 mb-2">
              <div class="flex items-center gap-2 flex-1 min-w-0">
                <!-- Warna -->
                <div class="relative flex-shrink-0">
                  <div 
                    class="w-8 h-8 rounded-full border-2 border-gray-300 cursor-pointer hover:ring-2 hover:ring-offset-2 hover:ring-blue-400 transition edit-color-display"
                    style="background-color: ${room.color};"
                    title="Klik untuk ubah warna"
                    onclick="toggleColorPicker(${room.id})"
                  ></div>
                  
                  <!-- Hidden Color Input -->
                  <input 
                    type="color"
                    class="edit-color-input hidden"
                    data-room-id="${room.id}"
                    value="${room.color}"
                    onchange="applyColorChange(${room.id})"
                  >
                </div>
                
                <!-- Nama Ruangan -->
                <span class="text-sm font-semibold text-gray-900 room-name truncate">${room.name}</span>
              </div>
              
              <!-- Move Up Button -->
              <div class="flex-shrink-0">
                ${index === 0 
                  ? `<span class="text-gray-300 text-sm" title="Sudah di posisi teratas">
                       <i class="fas fa-arrow-up"></i>
                     </span>`
                  : `<button
                      onclick="moveRoomUp(${room.id})"
                      class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-1 rounded transition text-sm"
                      title="Naikkan urutan ruangan"
                    >
                      <i class="fas fa-arrow-up"></i>
                    </button>`
                }
              </div>
            </div>
            
            <!-- ROW 2: Kapasitas & Tombol Aksi -->
            <div class="flex items-center justify-between gap-2">
              <!-- Kapasitas -->
              <div class="flex items-center gap-2 text-xs text-gray-700">
                <i class="fas fa-users text-blue-500"></i>
                <span class="capacity-display font-bold">${room.capacity}</span>
                <span>orang</span>
              </div>
              
              <!-- Tombol Edit & Hapus (Mini) -->
              <div class="flex gap-1.5 room-actions">
                <button
                  onclick="editRoom(${room.id}, '${room.name.replace(/'/g, "\\'")}', ${room.capacity}, '${room.color}')"
                  class="text-green-600 hover:bg-green-50 p-1.5 rounded transition text-xs"
                  title="Edit ruangan"
                >
                  <i class="fas fa-edit"></i>
                </button>
                
                <button
                  onclick="deleteRoom(${room.id})"
                  class="text-red-600 hover:bg-red-50 p-1.5 rounded transition text-xs"
                  title="Hapus ruangan"
                >
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Error loading rooms:', err);
    showToast('Gagal memuat daftar ruangan', 'error');
  }
}

// ...existing code...

// ✅ PERBAIKI: editRoom - Dengan tampilan 2 baris
window.editRoom = function (roomId, roomName, roomCapacity, roomColor) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  
  if (!roomEl) {
    loadSettingsRoomList().then(() => {
      editRoom(roomId, roomName, roomCapacity, roomColor);
    });
    return;
  }
  
  // ✅ SIMPAN COLOR KE DATA ATTRIBUTE
  roomEl.setAttribute("data-edit-color", roomColor);
  
  const nameEl = roomEl.querySelector(".room-name");
  const capacityEl = roomEl.querySelector(".capacity-display");
  const actionEl = roomEl.querySelector(".room-actions");

  // MODE EDIT: Replace dengan input
  if (capacityEl) {
    capacityEl.innerHTML = `
      <input 
        type="number" 
        class="edit-capacity w-12 rounded border-2 border-blue-300 px-1 py-0.5 text-xs font-bold" 
        value="${roomCapacity}"
        placeholder="Kap"
        min="1"
      >
    `;
  }

  if (nameEl) {
    nameEl.innerHTML = `
      <input 
        type="text" 
        class="edit-name w-full rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold" 
        value="${roomName}"
        placeholder="Nama ruangan"
      >
    `;
  }

  if (actionEl) {
    actionEl.innerHTML = `
      <button onclick="saveRoomEdit(${roomId})" class="text-green-600 hover:bg-green-50 p-1.5 rounded transition text-xs" title="Simpan">
        <i class="fas fa-check-circle"></i>
      </button>
      <button onclick="cancelRoomEdit(${roomId}, '${roomName.replace(/'/g, "\\'")}', ${roomCapacity}, '${roomColor}')" class="text-gray-400 hover:bg-gray-100 p-1.5 rounded transition text-xs" title="Batal">
        <i class="fas fa-times-circle"></i>
      </button>
    `;
  }
};

// ✅ PERBAIKI: cancelRoomEdit
window.cancelRoomEdit = function (roomId, originalName, originalCapacity, originalColor) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  if (!roomEl) {
    loadSettingsRoomList();
    return;
  }

  const nameEl = roomEl.querySelector(".room-name");
  const capacityEl = roomEl.querySelector(".capacity-display");
  const actionEl = roomEl.querySelector(".room-actions");

  if (nameEl) nameEl.innerHTML = originalName;
  if (capacityEl) capacityEl.innerHTML = originalCapacity;

  if (actionEl) {
    actionEl.innerHTML = `
      <button
        onclick="editRoom(${roomId}, '${originalName.replace(/'/g, "\\'")}', ${originalCapacity}, '${originalColor}')"
        class="text-green-600 hover:bg-green-50 p-1.5 rounded transition text-xs"
        title="Edit ruangan"
      >
        <i class="fas fa-edit"></i>
      </button>
      
      <button
        onclick="deleteRoom(${roomId})"
        class="text-red-600 hover:bg-red-50 p-1.5 rounded transition text-xs"
        title="Hapus ruangan"
      >
        <i class="fas fa-trash-alt"></i>
      </button>
    `;
  }
  
  roomEl.removeAttribute("data-edit-color");
};

// ✅ PERBAIKI: editRoom - Dengan tampilan card yang lebih baik
window.editRoom = function (roomId, roomName, roomCapacity, roomColor) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  
  if (!roomEl) {
    loadSettingsRoomList().then(() => {
      editRoom(roomId, roomName, roomCapacity, roomColor);
    });
    return;
  }
  
  // ✅ SIMPAN COLOR KE DATA ATTRIBUTE
  roomEl.setAttribute("data-edit-color", roomColor);
  
  const nameEl = roomEl.querySelector(".room-name");
  const capacityEl = roomEl.querySelector(".capacity-display");
  const actionEl = roomEl.querySelector(".room-actions");

  // MODE EDIT: Replace dengan input
  if (capacityEl) {
    capacityEl.innerHTML = `
      <input 
        type="number" 
        class="edit-capacity w-20 rounded-lg border-2 border-blue-300 px-2 py-1 text-sm font-bold" 
        value="${roomCapacity}"
        placeholder="Kapasitas"
        min="1"
      >
    `;
  }

  if (nameEl) {
    nameEl.innerHTML = `
      <input 
        type="text" 
        class="edit-name w-full rounded-lg border-2 border-blue-300 px-2 py-1 text-sm font-bold" 
        value="${roomName}"
        placeholder="Nama ruangan"
      >
    `;
  }

  if (actionEl) {
    actionEl.innerHTML = `
      <button onclick="saveRoomEdit(${roomId})" class="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-2.5 rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
        <i class="fas fa-check-circle"></i> Simpan
      </button>
      <button onclick="cancelRoomEdit(${roomId}, '${roomName.replace(/'/g, "\\'")}', ${roomCapacity}, '${roomColor}')" class="flex-1 bg-gray-400 hover:bg-gray-500 text-white px-3 py-2.5 rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
        <i class="fas fa-times-circle"></i> Batal
      </button>
    `;
  }
};

// ✅ PERBAIKI: cancelRoomEdit
window.cancelRoomEdit = function (roomId, originalName, originalCapacity, originalColor) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  if (!roomEl) {
    loadSettingsRoomList();
    return;
  }

  const nameEl = roomEl.querySelector(".room-name");
  const capacityEl = roomEl.querySelector(".capacity-display");
  const actionEl = roomEl.querySelector(".room-actions");

  if (nameEl) nameEl.innerHTML = originalName;
  if (capacityEl) capacityEl.innerHTML = originalCapacity;

  if (actionEl) {
    actionEl.innerHTML = `
      <button
        onclick="editRoom(${roomId}, '${originalName.replace(/'/g, "\\'")}', ${originalCapacity}, '${originalColor}')"
        class="flex-1 text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 p-2.5 rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2"
        title="Edit ruangan"
      >
        <i class="fas fa-edit"></i> Edit
      </button>
      
      <button
        onclick="deleteRoom(${roomId})"
        class="flex-1 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 p-2.5 rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2"
        title="Hapus ruangan"
      >
        <i class="fas fa-trash-alt"></i> Hapus
      </button>
    `;
  }
  
  roomEl.removeAttribute("data-edit-color");
};

window.toggleColorPicker = function(roomId) {
  const input = document.querySelector(`.edit-color-input[data-room-id="${roomId}"]`);
  if (input) {
    input.click();
  }
};

window.applyColorChange = async function(roomId) {
  const input = document.querySelector(`.edit-color-input[data-room-id="${roomId}"]`);
  const newColor = input.value;
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);

  if (!newColor || !roomEl) return;

  try {
    const res = await fetch(`/${calendarName}/rooms/${roomId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: roomEl.querySelector(".room-name").innerText,
        capacity: parseInt(roomEl.querySelector(".capacity-display").innerText),
        color: newColor,
      }),
    });

    if (res.ok) {
      // Update display color
      const colorDisplay = roomEl.querySelector(".edit-color-display");
      if (colorDisplay) {
        colorDisplay.style.backgroundColor = newColor;
      }
      roomEl.setAttribute("data-room-color", newColor);
      
      showToast("Warna berhasil diubah!", "success");
      loadRooms();
      calendar.refetchEvents();
    } else {
      showToast("Gagal mengubah warna", "error");
    }
  } catch (err) {
    console.error("Error changing color:", err);
    showToast("Terjadi kesalahan", "error");
  }
};

// ✅ PERBAIKI: moveRoomUp - Ganti urutan, bukan ID
window.moveRoomUp = async function(roomId) {
  try {
    const res = await fetch(`/${calendarName}/rooms/${roomId}/move-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Urutan ruangan berhasil diubah!', 'success');
      loadSettingsRoomList(); // Reload list
      loadRooms(); // Update dropdown filter
      calendar.refetchEvents(); // Update events
    } else {
      showToast(data.error || 'Gagal mengubah urutan', 'error');
    }
  } catch (err) {
    console.error('Error moving room:', err);
    showToast('Terjadi kesalahan sistem', 'error');
  }
};

  // --- INLINE EDIT ROOM ---
window.editRoom = function (roomId, roomName, roomCapacity, roomColor) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  
  if (!roomEl) {
    loadSettingsRoomList().then(() => {
      editRoom(roomId, roomName, roomCapacity, roomColor);
    });
    return;
  }
  
  // ✅ SIMPAN COLOR KE DATA ATTRIBUTE
  roomEl.setAttribute("data-edit-color", roomColor);
  
  const nameEl = roomEl.querySelector(".room-name");
  const capacityEl = roomEl.querySelector(".capacity-display");
  const actionEl = roomEl.querySelector(".room-actions");

  // MODE EDIT: Replace dengan input
  if (capacityEl) {
    capacityEl.innerHTML = `
      <input 
        type="number" 
        class="edit-capacity w-16 rounded-lg border-2 border-blue-300 p-2 text-sm" 
        value="${roomCapacity}"
        placeholder="Kapasitas"
        min="1"
      >
    `;
  }

  nameEl.innerHTML = `
    <input 
      type="text" 
      class="edit-name w-full rounded-lg border-2 border-blue-300 p-2 text-sm" 
      value="${roomName}"
      placeholder="Nama ruangan"
    >
  `;

  actionEl.innerHTML = `
    <button onclick="saveRoomEdit(${roomId})" class="bg-green-50 text-green-600 hover:bg-green-100 px-2 py-1.5 rounded text-xs font-bold transition border border-green-200 flex items-center gap-1">
      <i class="fas fa-check-circle"></i> Simpan
    </button>
    <button onclick="cancelRoomEdit(${roomId}, '${roomName.replace(/'/g, "\\'")}', ${roomCapacity}, '${roomColor}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 rounded text-xs font-bold transition flex items-center gap-1">
      <i class="fas fa-times-circle"></i> Batal
    </button>
  `;
};

// ✅ PERBAIKI: saveRoomEdit - Ambil color dari data attribute
window.saveRoomEdit = async function (roomId) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  
  const newName = roomEl.querySelector(".edit-name").value.trim();
  const newCapacity = roomEl.querySelector(".edit-capacity").value.trim();
  const newColor = roomEl.getAttribute("data-edit-color") || "#60a5fa"; // ✅ Ambil dari attribute

  if (!newName) {
    showToast("Nama ruangan tidak boleh kosong", "error");
    return;
  }

  if (!newCapacity || parseInt(newCapacity) <= 0) {
    showToast("Kapasitas harus angka positif", "error");
    return;
  }

  try {
    const res = await fetch(`/${calendarName}/rooms/${roomId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        capacity: parseInt(newCapacity),
        color: newColor, // ✅ INCLUDE COLOR
      }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast("Ruangan berhasil diperbarui!", "success");
      loadSettingsRoomList();
      loadRooms();
      calendar.refetchEvents();
    } else {
      showToast(data.error || "Gagal mengubah ruangan", "error");
    }
  } catch (err) {
    console.error("Error saving room:", err);
    showToast("Terjadi kesalahan sistem", "error");
  }
};

// ✅ PERBAIKI: cancelRoomEdit
window.cancelRoomEdit = function (roomId, originalName, originalCapacity, originalColor) {
  const roomEl = document.querySelector(`[data-room-id="${roomId}"]`);
  if (!roomEl) {
    loadSettingsRoomList();
    return;
  }

  const nameEl = roomEl.querySelector(".room-name");
  const capacityEl = roomEl.querySelector(".capacity-display");
  const actionEl = roomEl.querySelector(".room-actions");

  if (nameEl) nameEl.innerHTML = originalName;
  if (capacityEl) capacityEl.innerHTML = originalCapacity;

  if (actionEl) {
    actionEl.innerHTML = `
      <button
        onclick="editRoom(${roomId}, '${originalName.replace(/'/g, "\\'")}', ${originalCapacity}, '${originalColor}')"
        class="text-green-500 hover:text-green-700 hover:bg-green-50 p-1.5 rounded transition"
        title="Edit ruangan"
      >
        <i class="fas fa-edit text-sm"></i>
      </button>
      
      <button
        onclick="deleteRoom(${roomId})"
        class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition"
        title="Hapus ruangan"
      >
        <i class="fas fa-trash-alt text-sm"></i>
      </button>
    `;
  }
  
  roomEl.removeAttribute("data-edit-color");
};

  window.openGuideModal = function () {
    document.getElementById("guideModal").classList.remove("hidden");
  };

  window.closeGuideModal = function () {
    document.getElementById("guideModal").classList.add("hidden");
  };

  // --- EVENT LISTENER UNTUK TOMBOL EDIT ---
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".btn-edit-field");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const field = btn.getAttribute("data-field");
      window.toggleEditMode(field);
    }
  });

  // --- TAMBAH EVENT MANUAL ---
  const addEventForm = document.getElementById("addEventForm");
    if (addEventForm) {
    const manualRoomSelect = addEventForm.querySelector('select[name="room_id"]');
    const manualParticipantsInput = addEventForm.querySelector('input[name="participants_count"]');
    
    if (manualRoomSelect && manualParticipantsInput) {
      function validateManualParticipants() {
        const roomId = manualRoomSelect.value;
        const participants = parseInt(manualParticipantsInput.value) || 0;
        
        if (!roomId || participants === 0) return;
        
        const room = roomsCache.find(r => r.id == roomId);
        if (room && participants > room.capacity) {
          manualParticipantsInput.style.borderColor = '#dc2626';
          manualParticipantsInput.style.backgroundColor = '#fee2e2';
          
          // Tampilkan warning
          let warningEl = manualParticipantsInput.parentElement.querySelector('.capacity-warning');
          if (!warningEl) {
            warningEl = document.createElement('p');
            warningEl.className = 'capacity-warning text-red-600 text-xs font-semibold mt-1';
            manualParticipantsInput.parentElement.appendChild(warningEl);
          }
          warningEl.textContent = `Melebihi kapasitas! Maks: ${room.capacity} orang`;
        } else {
          manualParticipantsInput.style.borderColor = '#e5e7eb';
          manualParticipantsInput.style.backgroundColor = '#f9fafb';
          
          const warningEl = manualParticipantsInput.parentElement.querySelector('.capacity-warning');
          if (warningEl) warningEl.remove();
        }
      }
      
      manualRoomSelect.addEventListener('change', validateManualParticipants);
      manualParticipantsInput.addEventListener('input', validateManualParticipants);
    }
  }

  
  const quickAddEventForm = document.getElementById("quickAddEventForm");
  if (quickAddEventForm) {
    const quickRoomSelect = quickAddEventForm.querySelector('select[name="quick_room_id"]');
    const quickParticipantsInput = quickAddEventForm.querySelector('input[name="quick_participants_count"]');
    
    if (quickRoomSelect && quickParticipantsInput) {
      function validateQuickParticipants() {
        const roomId = quickRoomSelect.value;
        const participants = parseInt(quickParticipantsInput.value) || 0;
        
        if (!roomId || participants === 0) return;
        
        const room = roomsCache.find(r => r.id == roomId);
        if (room && participants > room.capacity) {
          quickParticipantsInput.style.borderColor = '#dc2626';
          quickParticipantsInput.style.backgroundColor = '#fee2e2';
          
          // Tampilkan warning
          let warningEl = quickParticipantsInput.parentElement.querySelector('.capacity-warning');
          if (!warningEl) {
            warningEl = document.createElement('p');
            warningEl.className = 'capacity-warning text-red-600 text-xs font-semibold mt-1';
            quickParticipantsInput.parentElement.appendChild(warningEl);
          }
          warningEl.textContent = `⚠️ Melebihi kapasitas! Maks: ${room.capacity} orang`;
        } else {
          quickParticipantsInput.style.borderColor = '#e5e7eb';
          quickParticipantsInput.style.backgroundColor = '#f9fafb';
          
          const warningEl = quickParticipantsInput.parentElement.querySelector('.capacity-warning');
          if (warningEl) warningEl.remove();
        }
      }
      
      quickRoomSelect.addEventListener('change', validateQuickParticipants);
      quickParticipantsInput.addEventListener('input', validateQuickParticipants);
    }
  }
  window.openAddEventModal = function () {
    const modal = document.getElementById("addEventModal");
    if (!modal) {
      console.error("Modal addEventModal tidak ditemukan");
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    modal.classList.remove("hidden");

    // Reset form jika ada
    const form = document.getElementById("addEventForm");
    if (form) form.reset();

    // Set tanggal default ke hari ini
    const eventDateInput = document.querySelector(
      '#addEventModal input[name="event_date"]'
    );
    if (eventDateInput) eventDateInput.value = today;

    // Reload room options
    const roomSelect = document.querySelector(
      '#addEventModal select[name="room_id"]'
    );
    if (roomSelect && roomsCache.length > 0) {
      roomSelect.innerHTML = '<option value="">-- Pilih Ruangan --</option>';
      roomsCache.forEach((room) => {
        roomSelect.innerHTML += `<option value="${room.id}">${room.name} (Kap: ${room.capacity})</option>`;
      });
    }
  };

  window.closeAddEventModal = function () {
    const modal = document.getElementById("addEventModal");
    if (modal) modal.classList.add("hidden");
  };

  // Event listener hanya jika form ada - ADD PROPER NULL CHECK
  const addEventFormElement = document.getElementById("addEventForm");
  if (addEventFormElement) {
    addEventFormElement.addEventListener("submit", async function (e) {
      e.preventDefault();

      const eventDate = document.querySelector(
        '#addEventModal input[name="event_date"]'
      ).value;
      const startTime = document.querySelector(
        '#addEventModal input[name="start_time_only"]'
      ).value;
      const endTime = document.querySelector(
        '#addEventModal input[name="end_time_only"]'
      ).value;
      const title = document.querySelector(
        '#addEventModal input[name="title"]'
      ).value;
      const roomId = document.querySelector(
        '#addEventModal select[name="room_id"]'
      ).value;
      const participantsCount = parseInt(document.querySelector(
        '#addEventModal input[name="participants_count"]'
      )?.value) || 0;

      // Validasi dasar
      if (!eventDate || !startTime || !endTime || !title || !roomId) {
        showToast("Mohon isi semua field yang diperlukan", "error");
        return;
      }

      // ✅ PERBAIKI: Validasi kapasitas SEBELUM format datetime
      if (participantsCount > 0) {
        const room = roomsCache.find(r => r.id == roomId);
        if (room && participantsCount > room.capacity) {
          showToast(`❌ Jumlah peserta melebihi kapasitas ruangan! Maks: ${room.capacity} orang`, "error");
          return;
        }
      }

      // Format ke datetime
      const startDateTime = `${eventDate}T${startTime}:00`;
      const endDateTime = `${eventDate}T${endTime}:00`;

      // Cek validasi waktu
      if (new Date(startDateTime) >= new Date(endDateTime)) {
        showToast("Waktu selesai harus setelah waktu mulai", "error");
        return;
      }

      const formData = new FormData(this);
      formData.set("start_time", startDateTime);
      formData.set("end_time", endDateTime);
      formData.delete("event_date");
      formData.delete("start_time_only");
      formData.delete("end_time_only");

      const submitBtn = document.querySelector(
        '#addEventModal button[type="submit"]'
      );
      const originalText = submitBtn.innerText;
      submitBtn.innerText = '<i class="fas fa-spinner fa-spin"></i> Membuat...';
      submitBtn.disabled = true;

      try {
        const res = await fetch(`/${calendarName}/events`, {
          method: "POST",
          body: formData,
        });

        const result = await res.json();

        if (res.ok) {
          showToast("Event berhasil dibuat!", "success");
          closeAddEventModal();
          calendar.refetchEvents();
          if (addEventFormElement) addEventFormElement.reset();
        } else {
          showToast(result.message || "Gagal membuat event", "error");
        }
      } catch (err) {
        showToast("Terjadi kesalahan sistem", "error");
        console.error(err);
      } finally {
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
      }
    });
  }
});

function truncateText(text, maxLength = 50) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }
  return text;
}


    function renderUpcomingEvents() {
  const listContainer = document.getElementById('upcomingEventsList');
  
  if (!calendar || !upcomingEventsData || upcomingEventsData.length === 0) {
    listContainer.innerHTML = `
      <div class="text-center py-12 text-gray-400">
        <i class="fas fa-inbox text-4xl mb-3 block opacity-30"></i>
        <p class="text-sm">Tidak ada acara</p>
      </div>
    `;
    return;
  }

  // ✅ PERBAIKI: Filter events berdasarkan pilihan (TANPA filter waktu)
  const now = new Date();
  let filteredEvents = [];

  upcomingEventsData.forEach(event => {
    const eventStart = new Date(event.start);

    // ✅ UBAH: Hanya tampilkan event BIASA (bukan holiday/reminder)
    const isHoliday = event.extendedProps?.isHoliday;
    const isReminder = event.extendedProps?.isReminder;
    if (isHoliday || isReminder) return;

    let shouldInclude = false;

    if (currentEventFilter === 'today') {
      // Tampilkan event HARI INI saja (terlepas jam sudah lewat atau belum)
      const isToday = eventStart.toDateString() === now.toDateString();
      shouldInclude = isToday;
    } else if (currentEventFilter === 'week') {
      // Tampilkan event MINGGU INI (7 hari ke depan dari hari ini)
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      shouldInclude = eventStart <= weekFromNow && eventStart >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (currentEventFilter === 'month') {
      // Tampilkan event BULAN INI (30 hari ke depan dari hari ini)
      const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      shouldInclude = eventStart <= monthFromNow && eventStart >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (currentEventFilter === 'year') {
      // Tampilkan event TAHUN INI (365 hari ke depan dari hari ini)
      const yearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      shouldInclude = eventStart <= yearFromNow && eventStart >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (currentEventFilter === 'all') {
      // Tampilkan SEMUA event
      shouldInclude = true;
    }

    if (shouldInclude) {
      filteredEvents.push(event);
    }
  });

  // ✅ PERBAIKI: Sort by start time (terbaru dulu untuk 'today', terjauh dulu untuk filter lain)
  if (currentEventFilter === 'today') {
    // Untuk hari ini: sort by waktu mulai (pagi ke malam)
    filteredEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  } else {
    // Untuk filter lain: sort by tanggal terbaru
    filteredEvents.sort((a, b) => new Date(b.start) - new Date(a.start));
  }

  if (filteredEvents.length === 0) {
    listContainer.innerHTML = `
      <div class="text-center py-12 text-gray-400">
        <i class="fas fa-inbox text-4xl mb-3 block opacity-30"></i>
        <p class="text-sm">Tidak ada acara</p>
      </div>
    `;
    return;
  }

  // ✅ RENDER EVENTS
  listContainer.innerHTML = filteredEvents.map(event => {
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);
    
    // Format waktu START - END
    const startTimeStr = startDate.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const endTimeStr = endDate.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const timeRangeStr = `${startTimeStr} - ${endTimeStr}`;

    // Format tanggal
    const dateStr = startDate.toLocaleDateString('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });

    // Warna berdasarkan ruangan
    let dotColor = '#60a5fa'; // Default blue
    if (event.extendedProps?.room_color) {
      dotColor = event.extendedProps.room_color;
    }

    // ✅ HIGHLIGHT jika event sudah lewat (jam-nya)
    const isPast = endDate < now;
    const opacityClass = isPast ? 'opacity-50' : 'opacity-100';

    // ✅ TAMBAH: Truncate judul event (max 40 char)
    const originalTitle = event.title;
    const truncatedTitle = truncateText(originalTitle, 40);

    return `
      <div 
        class="event-card-new cursor-pointer ${opacityClass} transition"
        onclick="handleEventCardClick('${event.id}')"
        title="${isPast ? 'Event sudah berlalu - ' : ''}${originalTitle}"
      >
        <!-- Dot Indicator -->
        <div class="flex items-start gap-3">
          <div 
            class="w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${isPast ? 'opacity-50' : ''}"
            style="background-color: ${dotColor};"
          ></div>
          
          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="event-card-time" style="color: ${dotColor}; ${isPast ? 'opacity: 0.6;' : ''}">
              <i class="fas fa-clock"></i>
              ${timeRangeStr}
              ${isPast ? '<span class="ml-2 text-xs">(Sudah lewat)</span>' : ''}
            </div>
            <!-- ✅ PERBAIKI: Tampilkan truncated title dengan ellipsis -->
            <div class="event-card-title" title="${originalTitle}">
              ${truncatedTitle}
            </div>
            ${event.extendedProps?.room_name ? `
              <div class="event-card-room" title="${event.extendedProps.room_name}">
                <i class="fas fa-door-open"></i>
                ${truncateText(event.extendedProps.room_name, 35)}
              </div>
            ` : ''}
            <div style="font-size: 0.65rem; color: #9ca3af; margin-top: 4px;">
              ${dateStr}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
    
    // Filter upcoming events
    window.filterUpcomingEvents = function(filterType) {
  currentEventFilter = filterType;
  
  // Update active button
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-filter') === filterType) {
      btn.classList.add('active');
    }
  });

  renderUpcomingEvents();
};

    
    // Handle event card click
    function handleEventCardClick(eventId) {
      const event = calendar.getEventById(eventId);
      if (event) {
        openDrawer(event);
      }
    }
    
    // Update upcoming events ketika calendar events berubah
function updateUpcomingEvents() {
  if (!calendar) {
    console.warn('⚠️ Calendar belum siap');
    upcomingEventsData = [];
    renderUpcomingEvents();
    return;
  }

  try {
    // ✅ PERBAIKI: Ambil SEMUA event tanpa filter waktu
    const allEvents = calendar.getEvents();

    // Sort by start time (terbaru dulu)
    allEvents.sort((a, b) => new Date(b.start) - new Date(a.start));

    // Map ke data sidebar
    upcomingEventsData = allEvents.map(event => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      extendedProps: event.extendedProps
    }));

    renderUpcomingEvents();
  } catch (err) {
    console.error('❌ Error updating upcoming events:', err);
    upcomingEventsData = [];
    renderUpcomingEvents();
  }
}

// ✅ TAMBAH: Debounce function biar tidak memanggil terlalu sering

function debouncedUpdateUpcomingEvents() {
  clearTimeout(updateUpcomingEventsTimeout);
  updateUpcomingEventsTimeout = setTimeout(() => {
    updateUpcomingEvents();
  }, 500);
}

