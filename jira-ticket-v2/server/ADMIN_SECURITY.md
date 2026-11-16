# 🔐 Admin Security System

## Overview
Sistem keamanan admin yang telah diimplementasi untuk melindungi halaman administrasi dari akses yang tidak sah.

## 🔑 Kredensial Admin
- **Username**: `admin`
- **Password**: `admin123`

> ⚠️ **PENTING**: Untuk production, ganti password default dan simpan kredensial di environment variables!

## 🛡️ Fitur Keamanan

### 1. **Authentication System**
- Login dengan username/password
- Session token yang aman (32-byte random hex)
- Token expiration (24 jam)
- Automatic logout saat token expired

### 2. **Protected Endpoints**
Semua endpoint admin dilindungi dengan middleware autentikasi:
- `GET /api/admin/countries` - Lihat daftar negara
- `POST /api/admin/countries` - Tambah negara baru
- `DELETE /api/admin/countries/:id` - Hapus negara

### 3. **Session Management**
- Token disimpan di localStorage browser
- Server-side session validation
- Automatic cleanup expired sessions

### 4. **Access Control**
- Halaman admin hanya bisa diakses setelah login
- Redirect otomatis ke halaman login jika tidak terautentikasi
- Logout otomatis saat token invalid

## 📁 File yang Dibuat/Dimodifikasi

### File Baru:
- `public/admin-login.html` - Halaman login admin
- `ADMIN_SECURITY.md` - Dokumentasi keamanan

### File yang Dimodifikasi:
- `server/server.js` - Menambahkan sistem autentikasi
- `public/admin.html` - Menambahkan proteksi akses
- `public/index.html` - Update link admin ke login
- `public/about.html` - Update link admin ke login
- `public/contact.html` - Update link admin ke login
- `public/report.html` - Update link admin ke login
- `public/stats.html` - Update link admin ke login

## 🚀 Cara Menggunakan

### 1. **Akses Admin Panel**
1. Klik menu "Admin" di navbar
2. Akan diarahkan ke halaman login
3. Masukkan kredensial admin
4. Setelah login berhasil, akan diarahkan ke admin panel

### 2. **Kelola Countries**
- Tambah negara baru dengan nama dan kode negara
- Hapus negara yang tidak diperlukan
- Data tersimpan di database MySQL

### 3. **Logout**
- Klik tombol "Logout" di admin panel
- Session akan dihapus dan diarahkan ke halaman login

## 🔧 Konfigurasi untuk Production

### 1. **Environment Variables**
```bash
# .env
ADMIN_USERNAME=your_admin_username
ADMIN_PASSWORD=your_secure_password
SESSION_SECRET=your_session_secret_key
```

### 2. **Database Session Store**
Ganti in-memory session store dengan database:
```javascript
// Gunakan Redis atau MySQL untuk session storage
const Redis = require('redis');
const client = Redis.createClient();
```

### 3. **Password Hashing**
Gunakan bcrypt untuk hash password:
```javascript
const bcrypt = require('bcrypt');
const hashedPassword = await bcrypt.hash(password, 10);
```

### 4. **HTTPS**
Pastikan menggunakan HTTPS untuk production:
```javascript
app.use(helmet()); // Security headers
```

## 🛠️ API Endpoints

### Authentication
- `POST /api/admin/login` - Login admin
- `GET /api/admin/verify` - Verify token
- `POST /api/admin/logout` - Logout admin

### Countries Management (Protected)
- `GET /api/admin/countries` - Get all countries
- `POST /api/admin/countries` - Add new country
- `DELETE /api/admin/countries/:id` - Delete country

## 🔍 Testing

### 1. **Test Login**
```bash
curl -X POST http://localhost:4000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 2. **Test Protected Endpoint**
```bash
curl -X GET http://localhost:4000/api/admin/countries \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## ⚠️ Security Considerations

1. **Password Policy**: Implementasi password yang kuat
2. **Rate Limiting**: Batasi jumlah percobaan login
3. **Audit Logging**: Log semua aktivitas admin
4. **CSRF Protection**: Implementasi CSRF tokens
5. **Input Validation**: Validasi semua input user
6. **SQL Injection**: Gunakan prepared statements (sudah diimplementasi)

## 📝 Notes

- Sistem ini menggunakan session-based authentication
- Token disimpan di localStorage (bisa diubah ke httpOnly cookies)
- Session expired setelah 24 jam
- Semua endpoint admin memerlukan valid token
- Redirect otomatis ke login jika tidak terautentikasi





