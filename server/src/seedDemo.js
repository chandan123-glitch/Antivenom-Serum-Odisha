// Loads the sample Nabarangpur sheet so the site has data to show.
// Usage: npm run seed:demo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb, tx, audit } from './db.js';
import { parseWorkbook } from './parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb();
const district = db.prepare("SELECT * FROM districts WHERE slug = 'nabarangpur'").get();
const buf = fs.readFileSync(path.join(here, '..', 'samples', 'nabarangpur.xlsx'));
const letter = path.join(here, '..', 'samples', 'nabarangpur-letter.pdf');
const result = await parseWorkbook(buf);
if (!result.ok) { console.error(result.errors); process.exit(1); }

const sourceFile = 'demo-nabarangpur.xlsx', letterFile = 'demo-nabarangpur-letter.pdf';
fs.copyFileSync(path.join(here, '..', 'samples', 'nabarangpur.xlsx'), path.join(config.dataDir, 'uploads', sourceFile));
fs.copyFileSync(letter, path.join(config.dataDir, 'uploads', letterFile));
tx(db, () => {
  db.prepare('UPDATE reports SET is_current = 0 WHERE district_id = ?').run(district.id);
  const id = Number(db.prepare(`INSERT INTO reports (district_id, is_current, report_date, letter_no, source_name, source_file,
      letter_name, letter_file, facility_count, total_vials, warning_count, uploaded_by)
      VALUES (?, 1, '2026-08-04', '12356/EMG', 'nabarangpur.xlsx', ?, 'nabarangpur-letter.pdf', ?, ?, ?, ?, 'seed')`)
    .run(district.id, sourceFile, letterFile, result.stats.facilities, result.stats.totalVials, result.warnings.length).lastInsertRowid);
  const ins = db.prepare(`INSERT INTO facilities (report_id, district_id, sl_no, block, type, name, address, lat, lng, quantity,
      available, mo_available, service_24x7, hours_note, last_admin_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const b = (x) => (x == null ? null : x ? 1 : 0);
  for (const f of result.rows) ins.run(id, district.id, f.slNo, f.block, f.type, f.name, f.address, f.lat, f.lng, f.quantity, b(f.available), b(f.mo), b(f.s24), f.hours, f.lastAdmin);
  audit(db, 'seed', 'demo_loaded', 'Nabarangpur sample');
});
console.log(`Loaded Nabarangpur: ${result.stats.facilities} facilities, ${result.stats.totalVials} vials.`);
