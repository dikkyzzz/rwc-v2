# 🚀 Panduan Deployment - Jira Issue Tracker Dashboard

Panduan lengkap untuk men-deploy aplikasi ini ke VM Ubuntu Server 22.04 LTS.

---

## 📋 Prasyarat

- VM dengan Ubuntu Server 22.04 LTS
- Akses SSH ke server
- Akses root/sudo
- Koneksi internet

---

## 🔧 Langkah 1: Update Sistem

```bash
# Login ke server via SSH
ssh username@IP_SERVER

# Update dan upgrade sistem
sudo apt update && sudo apt upgrade -y

# Install tools dasar
sudo apt install -y curl wget git build-essential
```

---

## 🟢 Langkah 2: Install Node.js 18 LTS

```bash
# Install Node.js via NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verifikasi instalasi
node -v    # Harus menampilkan v18.x.x
npm -v     # Harus menampilkan versi npm
```

---

## 🌐 Langkah 3: Install Google Chrome (untuk Puppeteer)

```bash
# Download dan install Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb

# Fix dependencies jika ada error
sudo apt --fix-broken install -y

# Verifikasi instalasi
google-chrome --version

# Hapus file installer
rm google-chrome-stable_current_amd64.deb
```

---

## 📂 Langkah 4: Upload/Clone Aplikasi

### Opsi A: Clone dari Git (jika sudah ada repository)
```bash
# Buat direktori aplikasi
sudo mkdir -p /var/www/jira-dashboard
cd /var/www/jira-dashboard

# Clone repository (ganti URL dengan repo Anda)
sudo git clone https://github.com/USERNAME/REPO_NAME.git .
```

### Opsi B: Upload Manual via SCP
```bash
# Dari komputer lokal (Windows PowerShell/CMD):
scp -r D:\1EXMINE\jira\* username@IP_SERVER:/var/www/jira-dashboard/

# Atau gunakan FileZilla/WinSCP untuk upload folder
```

### Set Permission
```bash
# Ubah ownership ke user saat ini
sudo chown -R $USER:$USER /var/www/jira-dashboard

# Set permission
chmod -R 755 /var/www/jira-dashboard
```

---

## 📦 Langkah 5: Install Dependencies Aplikasi

```bash
cd /var/www/jira-dashboard

# Install dependencies
npm install

# Install Puppeteer Chrome
npx puppeteer browsers install chrome
```

---

## ⚙️ Langkah 6: Konfigurasi Environment

```bash
# Buat file .env jika belum ada
nano /var/www/jira-dashboard/.env
```

Isi file `.env`:
```env
# Server Configuration
PORT=7000
NODE_ENV=production

# Jira API Configuration (Personal Access Token dari menu profil Jira)
JIRA_BASE_URL=https://jira.wmo.int
JIRA_API_TOKEN=your_personal_access_token
# Opsional, hanya untuk Jira Cloud (Basic auth email:token)
JIRA_EMAIL=

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password

# JWT Secret (generate random string)
JWT_SECRET=your_random_jwt_secret_key_here
```

Simpan dengan `Ctrl+X`, lalu `Y`, lalu `Enter`.

---

## 🔄 Langkah 7: Install PM2 (Process Manager)

```bash
# Install PM2 secara global
sudo npm install -g pm2

# Masuk ke direktori aplikasi
cd /var/www/jira-dashboard

# Jalankan aplikasi dengan PM2
pm2 start server/server.js --name "jira-dashboard"

# Lihat status
pm2 status

# Lihat logs
pm2 logs jira-dashboard

# Simpan konfigurasi PM2 agar auto-start saat reboot
pm2 startup
pm2 save
```

---

## 🌐 Langkah 8: Install & Konfigurasi Nginx (Reverse Proxy)

```bash
# Install Nginx
sudo apt install -y nginx

# Buat konfigurasi site
sudo nano /etc/nginx/sites-available/jira-dashboard
```

Isi konfigurasi Nginx:
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;  # Ganti dengan domain atau IP server

    # Lokasi untuk file static (opsional, untuk performa)
    location /static/ {
        alias /var/www/jira-dashboard/public/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Proxy ke aplikasi Node.js
    location / {
        proxy_pass http://localhost:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout untuk operasi yang lama (generate report)
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Maksimum upload size (untuk file)
    client_max_body_size 50M;
}
```

Simpan dengan `Ctrl+X`, lalu `Y`, lalu `Enter`.

```bash
# Aktifkan site
sudo ln -s /etc/nginx/sites-available/jira-dashboard /etc/nginx/sites-enabled/

# Hapus default site (opsional)
sudo rm /etc/nginx/sites-enabled/default

# Test konfigurasi Nginx
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 🔒 Langkah 9: (Opsional) Setup SSL dengan Let's Encrypt

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Dapatkan sertifikat SSL (ganti dengan domain Anda)
sudo certbot --nginx -d your-domain.com

# Sertifikat akan auto-renew, tapi bisa test dengan:
sudo certbot renew --dry-run
```

---

## 🔥 Langkah 10: Konfigurasi Firewall

```bash
# Aktifkan UFW
sudo ufw enable

# Izinkan SSH
sudo ufw allow 22

# Izinkan HTTP dan HTTPS
sudo ufw allow 80
sudo ufw allow 443

# Cek status
sudo ufw status
```

---

## ✅ Verifikasi Deployment

```bash
# Cek status PM2
pm2 status

# Cek status Nginx
sudo systemctl status nginx

# Cek apakah port 7000 listening
sudo ss -tlnp | grep 7000

# Test akses lokal
curl http://localhost:7000
```

Buka browser dan akses:
- `http://IP_SERVER` (tanpa SSL)
- `https://your-domain.com` (dengan SSL)

---

## 🛠️ Perintah Berguna

### PM2 Commands
```bash
pm2 status              # Lihat status semua aplikasi
pm2 logs jira-dashboard # Lihat logs
pm2 restart jira-dashboard  # Restart aplikasi
pm2 stop jira-dashboard     # Stop aplikasi
pm2 delete jira-dashboard   # Hapus dari PM2
```

### Nginx Commands
```bash
sudo systemctl status nginx   # Cek status
sudo systemctl restart nginx  # Restart
sudo systemctl reload nginx   # Reload config tanpa downtime
sudo nginx -t                 # Test konfigurasi
```

### Logs
```bash
# Log aplikasi
pm2 logs jira-dashboard

# Log Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 🔄 Update Aplikasi

```bash
cd /var/www/jira-dashboard

# Jika pakai Git
git pull origin main

# Install dependencies baru (jika ada)
npm install

# Restart aplikasi
pm2 restart jira-dashboard
```

---

## 🆘 Troubleshooting

### Puppeteer/Chrome Error
```bash
# Install dependencies Chrome yang mungkin kurang
sudo apt install -y libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxi6 libxtst6 libnss3 libcups2 libxss1 libxrandr2 \
    libasound2 libpangocairo-1.0-0 libatk1.0-0 libatk-bridge2.0-0 \
    libgtk-3-0
```

### Permission Error pada File
```bash
sudo chown -R $USER:$USER /var/www/jira-dashboard
chmod -R 755 /var/www/jira-dashboard
```

### Port Sudah Digunakan
```bash
# Cari proses yang menggunakan port
sudo lsof -i :7000

# Kill proses jika perlu
sudo kill -9 PID_NUMBER
```

---

## 📞 Kontak Support

Jika ada masalah, hubungi:
- Email: dikky.nayosa@bmkg.go.id
- Dokumentasi: Lihat file README.md

---

**Terakhir diupdate:** Januari 2026
