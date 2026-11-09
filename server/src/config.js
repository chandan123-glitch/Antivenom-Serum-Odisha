import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.env.NODE_ENV === 'production';

export const config = {
  prod,
  port: Number(process.env.PORT) || 4000,
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  clientDist: process.env.CLIENT_DIST || path.resolve(root, '..', 'client', 'dist'),
  jwtSecret: process.env.JWT_SECRET || (prod ? null : 'dev-only-secret-change-me'),
  adminUser: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || (prod ? null : 'Admin@12345'),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : prod,
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionHours: Number(process.env.SESSION_HOURS) || 8,
  // Stock bands: 0 = out of stock, below lowStock = low, otherwise adequate
  lowStock: Number(process.env.LOW_STOCK_THRESHOLD) || 20,
  maxExcelBytes: 5 * 1024 * 1024,
  maxLetterBytes: 10 * 1024 * 1024,
};

if (prod && (!config.jwtSecret || config.jwtSecret.length < 32 || !config.adminPassword)) {
  throw new Error(
    'Production requires JWT_SECRET (32+ chars) and ADMIN_PASSWORD environment variables.'
  );
}
