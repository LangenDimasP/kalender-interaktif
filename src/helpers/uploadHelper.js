const multer = require('multer');
const path = require('path');
const ImageKit = require("imagekit");

// 1. Setup ImageKit
const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

// 2. Setup Multer (GANTI DARI DISK KE MEMORY)
// File akan disimpan di RAM (buffer) sebelum dikirim ke ImageKit
const storage = multer.memoryStorage();

// 3. Filter File (Tetap sama seperti sebelumnya)
const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', // Gambar
        'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', // Video
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Format file tidak didukung: ${file.mimetype}`), false);
    }
};

// 4. Konfigurasi Upload Poster (Single, Max 5MB)
const uploadPoster = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan untuk poster!'), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // Naikkan ke 5MB untuk aman
});

// 5. Konfigurasi Upload Dokumentasi (Multiple, Max 50MB)
const uploadDocumentation = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// 6. Helper Function: Upload ke ImageKit
// Panggil fungsi ini di Controller Anda setelah upload.single/array
const uploadToImageKit = async (file, folderName = '/agenda-cerdas') => {
    try {
        // Generate nama file unik agar tidak tertimpa
        const timestamp = Date.now();
        const originalName = path.basename(file.originalname, path.extname(file.originalname))
            .replace(/[^a-z0-9]/gi, '-')
            .toLowerCase();
        const fileName = `${timestamp}-${originalName}`;

        const result = await imagekit.upload({
            file: file.buffer, // Ambil dari RAM
            fileName: fileName,
            folder: folderName // Folder di ImageKit
        });
        
        return result; // Mengembalikan object { url, fileId, ... }
    } catch (error) {
        throw error;
    }
};

// Export
module.exports = {
    uploadPoster,
    uploadDocumentation,
    uploadToImageKit,
    imagekit // Export instance jika butuh delete file nanti
};