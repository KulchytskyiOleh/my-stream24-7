import { Router } from 'express';
import passport from 'passport';

const router = Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed` }),
  (req, res) => {
    res.redirect(process.env.FRONTEND_URL);
  }
);

router.get('/me', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ user: null });
  const { id, email, name, avatar } = req.user;
  res.json({ user: { id, email, name, avatar } });
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});

export default router;
