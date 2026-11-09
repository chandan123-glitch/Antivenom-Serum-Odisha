import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { audit, tx } from '../db.js';
import { parseWorkbook } from '../parse.js';
import { requireAdmin, verifyLogin, startSession, endSession } from '../auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxLetterBytes, files: 2, fields: 10 },
}).fields([{ name: 'file', maxCount: 1 }, { name: 'letter', maxCount: 1 }]);

const isXlsx = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b; // "PK" zip header
const isPdf = (b) => b.length > 4 && b.subarray(0, 5).toString() === '%PDF-';
const ymd = /^\d{4}-\d{2}-\d{2}$/;

function readUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : 'Upload failed. Check the files and try again.';
    res.status(400).json({ error: msg });
  });
}

export function adminRoutes(db) {
  const r = Router();
  const auth = requireAdmin(db);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  // ---- auth ----
  r.post('/auth/login', loginLimiter, (req, res) => {
    const admin = verifyLogin(db, req.body?.username, req.body?.password);
    if (!admin) {
      audit(db, String(req.body?.username ?? '?').slice(0, 50), 'login_failed', req.ip);
      return res.status(401).json({ error: 'Username or password is incorrect.' });
    }
    startSession(res, admin);
    audit(db, admin.username, 'login', req.ip);
    res.json({ username: admin.username });
  });
  r.post('/auth/logout', (_req, res) => { endSession(res); res.json({ ok: true }); });
  r.get('/auth/me', auth, (req, res) => res.json({ username: req.admin.username }));
  r.post('/auth/change-password', auth, loginLimiter, (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
    if (!bcrypt.compareSync(String(currentPassword ?? ''), row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 10) {
      return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    }
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), req.admin.id);
    audit(db, req.admin.username, 'password_changed');
    res.json({ ok: true });
  });

  // ---- reports ----
  const getDistrict = (slug) => db.prepare('SELECT * FROM districts WHERE slug = ?').get(String(slug ?? ''));

  function validateUpload(req) {
    const file = req.files?.file?.[0];
    const letter = req.files?.letter?.[0];
    const district = getDistrict(req.body?.district);
    if (!district) return { status: 400, error: 'Choose a district.' };
    if (!file) return { status: 400, error: 'Attach the Excel (.xlsx) file.' };
    if (file.size > config.maxExcelBytes) return { status: 400, error: 'The Excel file is larger than 5 MB.' };
    if (!isXlsx(file.buffer)) return { status: 400, error: 'The data file must be an .xlsx workbook.' };
    if (letter && !isPdf(letter.buffer)) return { status: 400, error: 'The covering letter must be a PDF.' };
    const reportDate = String(req.body?.reportDate || new Date().toISOString().slice(0, 10));
    if (!ymd.test(reportDate) || Number.isNaN(Date.parse(reportDate))) return { status: 400, error: 'Enter a valid "stock as on" date.' };
    let mapping = null;
    if (req.body?.mapping) {
      try { mapping = JSON.parse(req.body.mapping); } catch { return { status: 400, error: 'Column mapping is not valid.' }; }
      if (typeof mapping !== 'object' || Array.isArray(mapping)) return { status: 400, error: 'Column mapping is not valid.' };
    }
    const parseOpts = {
      asOn: reportDate, mapping,
      sheet: req.body?.sheet ? String(req.body.sheet).slice(0, 100) : undefined,
      headerRow: req.body?.headerRow ? Number(req.body.headerRow) : undefined,
    };
    return { district, file, letter, reportDate, parseOpts };
  }

  // Dry run: parse and validate only, store nothing
  r.post('/admin/reports/preview', auth, readUpload, async (req, res) => {
    const v = validateUpload(req);
    if (v.error) return res.status(v.status).json({ error: v.error });
    const result = await parseWorkbook(v.file.buffer, v.parseOpts);
    res.json({ district: v.district.name, ...result });
  });

  r.post('/admin/reports', auth, readUpload, async (req, res) => {
    const v = validateUpload(req);
    if (v.error) return res.status(v.status).json({ error: v.error });
    const result = await parseWorkbook(v.file.buffer, v.parseOpts);
    if (!result.ok) return res.status(422).json({ error: 'The sheet has errors. Fix them and upload again.', ...result });

    const dir = path.join(config.dataDir, 'uploads');
    const sourceFile = `${crypto.randomUUID()}.xlsx`;
    const letterFile = v.letter ? `${crypto.randomUUID()}.pdf` : null;
    fs.writeFileSync(path.join(dir, sourceFile), v.file.buffer);
    if (letterFile) fs.writeFileSync(path.join(dir, letterFile), v.letter.buffer);

    try {
      const id = tx(db, () => {
        db.prepare('UPDATE reports SET is_current = 0 WHERE district_id = ? AND is_current = 1').run(v.district.id);
        const ins = db.prepare(`INSERT INTO reports
          (district_id, is_current, report_date, letter_no, notes, source_name, source_file, letter_name, letter_file,
           facility_count, total_vials, warning_count, uploaded_by)
          VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          v.district.id, v.reportDate, String(req.body?.letterNo || '').slice(0, 80) || null,
          String(req.body?.notes || '').slice(0, 500) || null,
          v.file.originalname.slice(0, 200), sourceFile, v.letter?.originalname.slice(0, 200) ?? null, letterFile,
          result.stats.facilities, result.stats.totalVials, result.warnings.length, req.admin.username);
        const reportId = Number(ins.lastInsertRowid);
        const insF = db.prepare(`INSERT INTO facilities
          (report_id, district_id, sl_no, block, type, name, address, lat, lng, quantity, available, mo_available,
           service_24x7, hours_note, last_admin_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const b = (x) => (x == null ? null : x ? 1 : 0);
        for (const f of result.rows) {
          insF.run(reportId, v.district.id, f.slNo, f.block, f.type, f.name, f.address, f.lat, f.lng, f.quantity,
            b(f.available), b(f.mo), b(f.s24), f.hours, f.lastAdmin);
        }
        audit(db, req.admin.username, 'report_uploaded', `${v.district.name}: report ${reportId}, ${result.stats.facilities} facilities`);
        return reportId;
      });
      res.status(201).json({ id, district: v.district.name, stats: result.stats, warnings: result.warnings.length });
    } catch (e) {
      fs.rmSync(path.join(dir, sourceFile), { force: true });
      if (letterFile) fs.rmSync(path.join(dir, letterFile), { force: true });
      console.error('Upload failed', e);
      res.status(500).json({ error: 'Could not save the report. Nothing was changed.' });
    }
  });

  r.get('/admin/reports', auth, (req, res) => {
    const slug = req.query.district ? String(req.query.district) : null;
    const rows = db.prepare(`
      SELECT r.*, d.name AS district_name, d.slug FROM reports r JOIN districts d ON d.id = r.district_id
      ${slug ? 'WHERE d.slug = ?' : ''} ORDER BY r.uploaded_at DESC, r.id DESC LIMIT 300`).all(...(slug ? [slug] : []));
    res.json(rows.map((x) => ({
      id: x.id, district: x.district_name, slug: x.slug, current: !!x.is_current, reportDate: x.report_date,
      letterNo: x.letter_no, notes: x.notes, sourceName: x.source_name, hasLetter: !!x.letter_file,
      facilityCount: x.facility_count, totalVials: x.total_vials, warnings: x.warning_count,
      uploadedBy: x.uploaded_by, uploadedAt: x.uploaded_at,
    })));
  });

  r.post('/admin/reports/:id/restore', auth, (req, res) => {
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
    if (!rep) return res.status(404).json({ error: 'Report not found.' });
    tx(db, () => {
      db.prepare('UPDATE reports SET is_current = 0 WHERE district_id = ? AND is_current = 1').run(rep.district_id);
      db.prepare('UPDATE reports SET is_current = 1 WHERE id = ?').run(rep.id);
      audit(db, req.admin.username, 'report_restored', `report ${rep.id}`);
    });
    res.json({ ok: true });
  });

  r.delete('/admin/reports/:id', auth, (req, res) => {
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
    if (!rep) return res.status(404).json({ error: 'Report not found.' });
    tx(db, () => {
      db.prepare('DELETE FROM reports WHERE id = ?').run(rep.id);
      if (rep.is_current) {
        // fall back to the previous upload for that district, if any
        const prev = db.prepare('SELECT id FROM reports WHERE district_id = ? ORDER BY uploaded_at DESC, id DESC LIMIT 1').get(rep.district_id);
        if (prev) db.prepare('UPDATE reports SET is_current = 1 WHERE id = ?').run(prev.id);
      }
      audit(db, req.admin.username, 'report_deleted', `report ${rep.id}`);
    });
    for (const f of [rep.source_file, rep.letter_file]) {
      if (f) fs.rmSync(path.join(config.dataDir, 'uploads', f), { force: true });
    }
    res.json({ ok: true });
  });

  const sendFile = (col, nameCol, type) => (req, res) => {
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
    if (!rep || !rep[col]) return res.status(404).json({ error: 'File not found.' });
    const p = path.join(config.dataDir, 'uploads', path.basename(rep[col]));
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found.' });
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rep[nameCol] || rep[col])}"`);
    fs.createReadStream(p).pipe(res);
  };
  r.get('/admin/reports/:id/source', auth, sendFile('source_file', 'source_name', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  r.get('/admin/reports/:id/letter', auth, sendFile('letter_file', 'letter_name', 'application/pdf'));

  r.get('/admin/audit', auth, (_req, res) => {
    res.json(db.prepare('SELECT at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 100').all());
  });

  return r;
}
