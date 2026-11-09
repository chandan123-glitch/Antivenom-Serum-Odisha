import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const COOKIE = 'asv_admin';
// Used so that unknown usernames cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function ensureAdmin(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (n === 0) {
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(
      config.adminUser, bcrypt.hashSync(config.adminPassword, 12)
    );
    console.log(`Created admin user "${config.adminUser}".`);
    if (!config.prod) console.log('  (dev default password in use, set ADMIN_PASSWORD to change it)');
  }
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.cookieSecure,
  path: '/',
  maxAge: config.sessionHours * 3600 * 1000,
});

export function verifyLogin(db, username, password) {
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username ?? ''));
  const ok = bcrypt.compareSync(String(password ?? ''), row ? row.password_hash : DUMMY_HASH);
  return row && ok ? row : null;
}

export function startSession(res, admin) {
  const token = jwt.sign({ sub: admin.id, u: admin.username }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
  });
  res.cookie(COOKIE, token, cookieOpts());
}

export function endSession(res) {
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
}

export function requireAdmin(db) {
  return (req, res, next) => {
    try {
      const token = req.cookies?.[COOKIE];
      if (!token) return res.status(401).json({ error: 'Sign in required.' });
      const p = jwt.verify(token, config.jwtSecret);
      const admin = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(p.sub);
      if (!admin) return res.status(401).json({ error: 'Sign in required.' });
      req.admin = admin;
      next();
    } catch {
      res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    }
  };
}
