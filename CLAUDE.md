# Stream247 — Project Context for Claude

## What is this
SaaS для 24/7 YouTube стрімінгу. Юзер завантажує відео, створює стрім слот з YouTube Stream Key, додає відео в плейліст і запускає стрім. FFmpeg стрімить без перекодування 24/7.

## Stack
- **Backend:** Node.js + Express (ES modules), port 3000
- **Database:** PostgreSQL + Prisma ORM
- **Frontend:** React + Vite, збирається в `frontend/dist/`
- **UI:** Tailwind CSS + власні shadcn-style компоненти (`frontend/src/components/ui/`)
- **Streaming:** FFmpeg `-c:v copy` (no transcode), RTMP → YouTube
- **Auth:** Google OAuth 2.0 (passport.js + express-session)
- **Upload:** multer (backend) + react-dropzone (frontend)
- **Drag&drop:** @dnd-kit/core + @dnd-kit/sortable
- **Icons:** lucide-react

## Production
- Server: DigitalOcean Droplet, Ubuntu 24.04, IP: `209.38.226.188`
- Domain: `stream247.webhop.me`
- App dir: `/opt/stream247/`
- Env file: `/opt/stream247/backend/.env`
- Systemd: `stream247.service`
- DB: PostgreSQL, db=`stream_saas`, user=`streamuser`

## Deploy workflow
```bash
# Локально — запушити зміни:
git add -A && git commit -m "..." && git push

# На сервері — задеплоїти:
cd /opt/stream247 && git pull && cd frontend && npm run build && systemctl reload nginx

# Якщо змінювався backend:
systemctl restart stream247

# Логи:
journalctl -u stream247 -f
```

## Project structure
```
/backend
  server.js               — Express app, passport, session
  /routes
    auth.js               — /auth/google, /auth/me, /auth/logout
    videos.js             — upload, list, delete + ffprobe duration
    streams.js            — CRUD + start/stop + playlist
  /services
    ffmpeg.js             — менеджер FFmpeg процесів (Map streamId→state)
    encryption.js         — AES-256-GCM для stream key
  /middleware
    auth.js               — requireAuth middleware
  /prisma
    schema.prisma

/frontend/src
  App.jsx                 — router + AuthProvider
  /pages
    Login.jsx             — Google OAuth кнопка
    Dashboard.jsx         — головна сторінка, polling кожні 5s
  /components
    Layout.jsx            — header з theme toggle + logout
    StreamSlot.jsx        — картка стріму (start/stop/delete/expand)
    PlaylistEditor.jsx    — dnd-kit drag&drop плейліст
    VideoLibrary.jsx      — upload зона + список відео
    NewStreamDialog.jsx   — модалка створення стріму
    /ui
      button.jsx, input.jsx, dialog.jsx, badge.jsx
  /hooks
    useAuth.jsx           — AuthContext (user, logout)
    useTheme.js           — light/dark toggle (localStorage)
  /lib
    api.js                — всі axios виклики до backend
    utils.js              — cn(), formatBytes(), formatDuration()
```

## Key implementation details
- Stream keys шифруються AES-256-GCM перед збереженням в БД
- FFmpeg процеси зберігаються в Map в пам'яті (втрачаються при рестарті сервера — стріми зупиняються)
- При завершенні FFmpeg автоматично запускається наступне відео
- Shuffle перемішує плейліст на кожен новий цикл
- Юзер бачить тільки свої відео та стріми (ізоляція по userId)
- Rate limit на upload: 20 запитів / 15 хв

## What's NOT done yet (potential next steps)
- HTTPS / SSL (потрібен домен з certbot)
- Volume для відео (зараз `/opt/stream247/uploads/`)
- Stream status persistence після рестарту сервера
- Редагування існуючого stream key
- Перегляд логів стріму в UI
