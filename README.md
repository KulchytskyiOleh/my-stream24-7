# Stream247

**UA:** SaaS для 24/7 YouTube стрімінгу. Завантажуй відео, створюй стрім слот з YouTube Stream Key, додавай відео в плейліст і запускай стрім. FFmpeg стрімить без перекодування 24/7.

**EN:** SaaS for 24/7 YouTube streaming. Upload videos, create a stream slot with your YouTube Stream Key, add videos to a playlist, and start streaming. FFmpeg streams without re-encoding 24/7.

---

## Stack

- **Backend:** Node.js 22 + Express (ES modules)
- **Database:** PostgreSQL + Prisma ORM
- **Frontend:** React + Vite + Tailwind CSS
- **Streaming:** FFmpeg `-c:v copy` (no re-encoding), RTMP → YouTube
- **Auth:** Google OAuth 2.0

---

## Варіант 1: Домашній сервер за CGNAT / Option 1: Home Server behind CGNAT

**UA:** Якщо провайдер використовує CGNAT і port forwarding не працює — використовуй Tailscale Funnel для отримання постійного публічного HTTPS URL безкоштовно.

**EN:** If your ISP uses CGNAT and port forwarding doesn't work — use Tailscale Funnel to get a permanent public HTTPS URL for free.

### 1. Залежності / Dependencies

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL, FFmpeg, Nginx
sudo apt install -y postgresql ffmpeg nginx
```

### 2. Клонування / Clone

```bash
sudo git clone https://github.com/YOUR_USERNAME/stream-saas.git /opt/stream247
sudo chown -R $USER:$USER /opt/stream247
cd /opt/stream247/backend && npm install
cd /opt/stream247/frontend && npm install && npm run build
```

### 3. База даних / Database

```bash
sudo -u postgres psql -c "CREATE USER streamuser WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "CREATE DATABASE stream_saas OWNER streamuser;"
cd /opt/stream247/backend && npx prisma migrate deploy
```

### 4. Tailscale Funnel — публічний URL / Public URL

```bash
# Встановити / Install
curl -fsSL https://tailscale.com/install.sh | sh

# Авторизуватись (відкрити посилання в браузері) / Authorize (open link in browser)
sudo tailscale up

# Запустити у фоні / Start in background
sudo tailscale funnel --bg 8080
```

Отримаєш постійний URL: `https://YOUR-NAME.ts.net`  
You will get a permanent URL: `https://YOUR-NAME.ts.net`

### 5. .env

```bash
nano /opt/stream247/backend/.env
```

```env
DATABASE_URL=postgresql://streamuser:yourpassword@localhost:5432/stream_saas
SESSION_SECRET=your_random_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ENCRYPTION_KEY=your_32_char_hex_key
NODE_ENV=production
PORT=3000
UPLOAD_DIR=./uploads
FRONTEND_URL=https://YOUR-NAME.ts.net
GOOGLE_CALLBACK_URL=https://YOUR-NAME.ts.net/auth/google/callback
```

### 6. Nginx

```bash
sudo nano /etc/nginx/sites-available/stream247
```

```nginx
server {
    listen 8080;
    server_name YOUR-NAME.ts.net;

    root /opt/stream247/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    location /auth {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    client_max_body_size 2048M;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/stream247 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Google OAuth

У / In [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth Client:

- **Authorized JavaScript origins:** `https://YOUR-NAME.ts.net`
- **Authorized redirect URIs:** `https://YOUR-NAME.ts.net/auth/google/callback`

### 8. systemd

```bash
sudo nano /etc/systemd/system/stream247.service
```

```ini
[Unit]
Description=Stream247 Node.js Server
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/opt/stream247/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/stream247/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable stream247
sudo systemctl start stream247
```

### 9. Права на uploads / Uploads permissions

```bash
sudo chown -R YOUR_USERNAME:YOUR_USERNAME /opt/stream247/uploads/
```

---

## Варіант 2: VPS (DigitalOcean, Hetzner, Vultr тощо) / Option 2: VPS

**UA:** На VPS є публічний IP — port forwarding не потрібен. Використовуй Nginx + Certbot для HTTPS.

**EN:** VPS has a public IP — no port forwarding needed. Use Nginx + Certbot for HTTPS.

### 1. Залежності / Dependencies

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql ffmpeg nginx certbot python3-certbot-nginx
```

### 2. Клонування та збірка / Clone and build

```bash
sudo git clone https://github.com/YOUR_USERNAME/stream-saas.git /opt/stream247
sudo chown -R $USER:$USER /opt/stream247
cd /opt/stream247/backend && npm install
cd /opt/stream247/frontend && npm install && npm run build
```

### 3. База даних / Database

```bash
sudo -u postgres psql -c "CREATE USER streamuser WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "CREATE DATABASE stream_saas OWNER streamuser;"
cd /opt/stream247/backend && npx prisma migrate deploy
```

### 4. .env

```env
DATABASE_URL=postgresql://streamuser:yourpassword@localhost:5432/stream_saas
SESSION_SECRET=your_random_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ENCRYPTION_KEY=your_32_char_hex_key
NODE_ENV=production
PORT=3000
UPLOAD_DIR=./uploads
FRONTEND_URL=https://yourdomain.com
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback
```

### 5. Nginx + HTTPS (Certbot)

```bash
sudo nano /etc/nginx/sites-available/stream247
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    root /opt/stream247/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    location /auth {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    client_max_body_size 2048M;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/stream247 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS сертифікат / HTTPS certificate
sudo certbot --nginx -d yourdomain.com
```

### 6. Google OAuth

У / In [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth Client:

- **Authorized JavaScript origins:** `https://yourdomain.com`
- **Authorized redirect URIs:** `https://yourdomain.com/auth/google/callback`

### 7. systemd

```bash
sudo nano /etc/systemd/system/stream247.service
```

```ini
[Unit]
Description=Stream247 Node.js Server
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/opt/stream247/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/stream247/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable stream247
sudo systemctl start stream247
```

### 8. Права на uploads / Uploads permissions

```bash
sudo chown -R YOUR_USERNAME:YOUR_USERNAME /opt/stream247/uploads/
```

---

## Deploy workflow

```bash
# Локально / Locally
git add -A && git commit -m "..." && git push

# На сервері / On server
cd /opt/stream247 && sudo git pull
cd frontend && npm run build
sudo systemctl restart stream247
```

## Логи / Logs

```bash
journalctl -u stream247 -f
```
