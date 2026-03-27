#!/bin/bash
set -e

# Stream247 — deploy script for Ubuntu 22.04/24.04 VPS
# Usage: bash deploy.sh

APP_DIR="/opt/stream247"
APP_USER="stream247"
VOLUME_MOUNT="/mnt/videos"

echo "=== Stream247 Deploy ==="

# 1. System packages
echo "→ Installing packages..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null
sudo apt-get install -y nodejs postgresql ffmpeg nginx certbot python3-certbot-nginx > /dev/null
echo "   Node $(node -v), FFmpeg $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3), PostgreSQL OK"

# 2. PostgreSQL setup
echo "→ Setting up PostgreSQL..."
DB_PASS=$(openssl rand -hex 16)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='streamuser'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER streamuser WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='stream_saas'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE stream_saas OWNER streamuser;"
echo "   DB_PASS=$DB_PASS  ← save this!"

# 3. App user
echo "→ Creating app user..."
id -u $APP_USER &>/dev/null || sudo useradd -m -s /bin/bash $APP_USER

# 4. Volume directory
echo "→ Setting up video storage..."
sudo mkdir -p $VOLUME_MOUNT
sudo chown $APP_USER:$APP_USER $VOLUME_MOUNT

# 5. App directory
echo "→ Setting up app directory..."
sudo mkdir -p $APP_DIR
sudo chown $APP_USER:$APP_USER $APP_DIR

# 6. Copy app files
echo "→ Copying app files..."
sudo cp -r . $APP_DIR/
sudo chown -R $APP_USER:$APP_USER $APP_DIR

# 7. Install deps & build
echo "→ Installing dependencies..."
sudo -u $APP_USER bash -c "cd $APP_DIR/backend && npm install --production"
sudo -u $APP_USER bash -c "cd $APP_DIR/frontend && npm install && npm run build"

# 8. Generate secrets
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# 9. Create .env
echo "→ Creating .env..."
cat > /tmp/stream247.env << EOF
DATABASE_URL="postgresql://streamuser:${DB_PASS}@localhost:5432/stream_saas"
SESSION_SECRET="${SESSION_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"

GOOGLE_CLIENT_ID="REPLACE_ME"
GOOGLE_CLIENT_SECRET="REPLACE_ME"
GOOGLE_CALLBACK_URL="https://YOURDOMAIN.com/auth/google/callback"

FRONTEND_URL="https://YOURDOMAIN.com"
PORT=3000

UPLOAD_DIR="${VOLUME_MOUNT}"
MAX_FILE_SIZE_MB=2048
NODE_ENV=production
EOF
sudo cp /tmp/stream247.env $APP_DIR/backend/.env
sudo chown $APP_USER:$APP_USER $APP_DIR/backend/.env
sudo chmod 600 $APP_DIR/backend/.env

# 10. Prisma migrate
echo "→ Running DB migrations..."
sudo -u $APP_USER bash -c "cd $APP_DIR/backend && npx prisma migrate deploy"

# 11. Systemd service
echo "→ Creating systemd service..."
sudo tee /etc/systemd/system/stream247.service > /dev/null << EOF
[Unit]
Description=Stream247 Backend
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
EnvironmentFile=$APP_DIR/backend/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable stream247
sudo systemctl start stream247
echo "   Service started"

# 12. Nginx config
echo "→ Configuring Nginx..."
sudo tee /etc/nginx/sites-available/stream247 > /dev/null << 'EOF'
server {
    listen 80;
    server_name YOURDOMAIN.com;

    # Frontend (built static files)
    root /opt/stream247/frontend/dist;
    index index.html;

    # Backend API proxy
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Large file uploads
        client_max_body_size 2048m;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /auth/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/stream247 /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== DONE ==="
echo ""
echo "Next steps:"
echo "1. Edit $APP_DIR/backend/.env — fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOURDOMAIN.com"
echo "2. sudo sed -i 's/YOURDOMAIN.com/youractual.domain/g' /etc/nginx/sites-available/stream247"
echo "3. sudo nginx -s reload"
echo "4. sudo certbot --nginx -d youractual.domain   ← free HTTPS"
echo "5. sudo systemctl restart stream247"
echo ""
echo "Logs:   sudo journalctl -u stream247 -f"
echo "Status: sudo systemctl status stream247"
