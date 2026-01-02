const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ PERBAIKAN: Buat folder uploads & documentations jika belum ada
const uploadDir = path.join(__dirname, '../../public/uploads');
const docDir = path.join(uploadDir, 'documentations');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(docDir)) {
    fs.mkdirSync(docDir, { recursive: true });
}

// ✅ PERBAIKAN: Storage dengan folder dinamis
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Jika dari dokumentasi event, simpan di folder terpisah
        const dest = req.body.isDocs || req.path.includes('documentations') 
            ? docDir 
            : uploadDir;
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        // Nama file: timestamp-random-namaasli
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        const originalName = path.basename(file.originalname, path.extname(file.originalname))
            .replace(/[^a-z0-9]/gi, '-')
            .toLowerCase();
        
        cb(null, `${timestamp}-${random}-${originalName}${path.extname(file.originalname)}`);
    }
});

// ✅ PERBAIKAN: Filter untuk gambar & video
const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        // Gambar
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        // Video
        'video/mp4',
        'video/webm',
        'video/quicktime', // MOV
        'video/x-msvideo', // AVI
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Format file tidak didukung: ${file.mimetype}`), false);
    }
};

// ✅ PERBAIKAN: Upload untuk poster/single file (2MB)
const uploadPoster = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Hanya gambar untuk poster
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan untuk poster!'), false);
        }
    },
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// ✅ PERBAIKAN: Upload untuk dokumentasi/multiple file (50MB)
const uploadDocumentation = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ✅ PERBAIKAN: Export kedua config
module.exports = uploadPoster; // Default untuk backward compatibility
module.exports.uploadPoster = uploadPoster;
module.exports.uploadDocumentation = uploadDocumentation;