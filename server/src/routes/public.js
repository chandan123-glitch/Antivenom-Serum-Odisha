import { Router } from 'express';
import ExcelJS from 'exceljs';
import { config } from '../config.js';

export function publicRoutes(db) {
  const r = Router();

  r.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  r.get('/meta', (_req, res) => res.json({ lowStock: config.lowStock }));

  // Every district with a summary of its current report (or null if none uploaded yet)
  r.get('/districts', (_req, res) => {
    const rows = db.prepare(`
      SELECT d.id, d.name, d.slug,
             r.id AS report_id, r.report_date, r.uploaded_at, r.letter_no, r.facility_count, r.total_vials,
             (SELECT COUNT(*) FROM facilities f WHERE f.report_id = r.id
                AND f.available = 1 AND f.mo_available = 1 AND f.service_24x7 = 1) AS ready,
             (SELECT COUNT(*) FROM facilities f WHERE f.report_id = r.id AND f.available = 0) AS out_of_stock,
             (SELECT COUNT(*) FROM facilities f WHERE f.report_id = r.id AND f.available IS NULL) AS unknown_stock,
             (SELECT COUNT(*) FROM facilities f WHERE f.report_id = r.id AND f.quantity IS NOT NULL) AS counted
      FROM districts d
      LEFT JOIN reports r ON r.district_id = d.id AND r.is_current = 1
      ORDER BY d.name`).all();
    res.json(rows.map((x) => ({
      id: x.id, name: x.name, slug: x.slug,
      report: x.report_id == null ? null : {
        id: x.report_id, reportDate: x.report_date, uploadedAt: x.uploaded_at, letterNo: x.letter_no,
        facilityCount: x.facility_count, totalVials: x.total_vials, ready: x.ready, outOfStock: x.out_of_stock, unknownStock: x.unknown_stock, counted: x.counted,
      },
    })));
  });

  // All facilities from each district's current report
  r.get('/facilities', (req, res) => {
    const slug = req.query.district ? String(req.query.district) : null;
    const rows = db.prepare(`
      SELECT f.id, d.slug AS district, d.name AS district_name, f.block, f.type, f.name, f.address, f.hours_note,
             f.lat, f.lng, f.quantity, f.available, f.mo_available, f.service_24x7, f.last_admin_date, r.report_date
      FROM facilities f
      JOIN reports r ON r.id = f.report_id AND r.is_current = 1
      JOIN districts d ON d.id = r.district_id
      ${slug ? 'WHERE d.slug = ?' : ''}
      ORDER BY d.name, f.block, f.name`).all(...(slug ? [slug] : []));
    res.json(rows.map((f) => ({
      id: f.id, district: f.district, districtName: f.district_name, block: f.block, type: f.type,
      name: f.name, address: f.address, lat: f.lat, lng: f.lng, quantity: f.quantity,
      available: f.available == null ? null : !!f.available,
      mo: f.mo_available == null ? null : !!f.mo_available,
      s24: f.service_24x7 == null ? null : !!f.service_24x7,
      hours: f.hours_note, lastAdmin: f.last_admin_date, asOn: f.report_date,
    })));
  });

  r.get('/template.xlsx', async (_req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.columns = [
      { header: 'SL', key: 'a', width: 6 }, { header: 'Name of the PHCs/CHCs/Sub Division Hospital', key: 'b', width: 34 },
      { header: 'Location (Address with GPS Coordinates)', key: 'c', width: 40 },
      { header: 'Is anti-venom available (Yes/No) (quantity (nos) available)', key: 'd', width: 30 },
      { header: 'Is trained Doctors available for administration of anti-venom (Yes/No)', key: 'e', width: 30 },
      { header: 'Working hour available for the services in 24 hrs', key: 'f', width: 26 },
      { header: 'Date (when last administration made)', key: 'g', width: 24 },
    ];
    ws.addRow([1, 'Example CHC', 'Example, Block, 19.828162, 82.469699', 'Yes (120)', 'Yes', 'Yes', '06-05-2026']);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'top' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="asv-district-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  });

  return r;
}
