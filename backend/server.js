import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import authRouter from './routes/auth.js';
import videosRouter from './routes/videos.js';
import streamsRouter from './routes/streams.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const app = express();

// Ensure upload directory exists
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport Google OAuth
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await prisma.user.upsert({
      where: { googleId: profile.id },
      update: {
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value,
      },
      create: {
        googleId: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value,
      },
    });
    done(null, user);
  } catch (err) {
    done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Routes
app.use('/auth', authRouter);
app.use('/api/videos', videosRouter);
app.use('/api/streams', streamsRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
