import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asv-test-'));
process.env.ADMIN_PASSWORD = 'Test@12345678';

const { openDb } = await import('../src/db.js');
const { ensureAdmin } = await import('../src/auth.js');
const { createApp } = await import('../src/app.js');

let server, base, cookie;
const sample = fs.readFileSync(new URL('../samples/nabarangpur.xlsx', import.meta.url));

before(async () => {
  const db = openDb();
  ensureAdmin(db);
  server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const form = (fields, files) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [k, [buf, name]] of Object.entries(files)) f.append(k, new Blob([buf]), name);
  return f;
};
const authed = (init = {}) => ({ ...init, headers: { ...(init.headers || {}), cookie } });

test('lists all 30 districts, none reported yet', async () => {
  const d = await (await fetch(`${base}/districts`)).json();
  assert.equal(d.length, 30);
  assert.ok(d.every((x) => x.report === null));
});

test('admin routes reject anonymous users', async () => {
  assert.equal((await fetch(`${base}/admin/reports`)).status, 401);
  const r = await fetch(`${base}/admin/reports`, { method: 'POST', body: form({ district: 'nabarangpur' }, { file: [sample, 'a.xlsx'] }) });
  assert.equal(r.status, 401);
});

test('login rejects bad password and accepts good one', async () => {
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Test@12345678' }) });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/i);
});

test('preview validates without saving', async () => {
  const r = await fetch(`${base}/admin/reports/preview`, authed({ method: 'POST', body: form({ district: 'nabarangpur' }, { file: [sample, 'n.xlsx'] }) }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.stats.facilities, 54);
  const d = await (await fetch(`${base}/districts`)).json();
  assert.ok(d.every((x) => x.report === null));
});

test('upload publishes a district report', async () => {
  const letter = fs.readFileSync(new URL('../samples/nabarangpur-letter.pdf', import.meta.url));
  const r = await fetch(`${base}/admin/reports`, authed({ method: 'POST', body: form({ district: 'nabarangpur', reportDate: '2026-08-04', letterNo: '12356' }, { file: [sample, 'n.xlsx'], letter: [letter, 'l.pdf'] }) }));
  assert.equal(r.status, 201);
  const d = (await (await fetch(`${base}/districts`)).json()).find((x) => x.slug === 'nabarangpur');
  assert.equal(d.report.facilityCount, 54);
  assert.equal(d.report.totalVials, 3634);
  assert.equal(d.report.ready, 19);
  const f = await (await fetch(`${base}/facilities?district=nabarangpur`)).json();
  assert.equal(f.length, 54);
  assert.equal(f[0].asOn, '2026-08-04');
});

test('re-upload supersedes, restore and delete work', async () => {
  const up = await fetch(`${base}/admin/reports`, authed({ method: 'POST', body: form({ district: 'nabarangpur' }, { file: [sample, 'n2.xlsx'] }) }));
  assert.equal(up.status, 201);
  let list = await (await fetch(`${base}/admin/reports`, authed())).json();
  assert.equal(list.filter((x) => x.district === 'Nabarangpur').length, 2);
  assert.equal(list.filter((x) => x.current).length, 1);
  const old = list.find((x) => !x.current);
  await fetch(`${base}/admin/reports/${old.id}/restore`, authed({ method: 'POST' }));
  list = await (await fetch(`${base}/admin/reports`, authed())).json();
  assert.equal(list.find((x) => x.id === old.id).current, true);
  await fetch(`${base}/admin/reports/${old.id}`, authed({ method: 'DELETE' }));
  list = await (await fetch(`${base}/admin/reports`, authed())).json();
  list = list.filter((x) => x.district === 'Nabarangpur');
  assert.equal(list.length, 1);
  assert.equal(list[0].current, true); // fell back to the remaining one
});

test('rejects a file that is not an xlsx', async () => {
  const r = await fetch(`${base}/admin/reports`, authed({ method: 'POST', body: form({ district: 'puri' }, { file: [Buffer.from('hello'), 'x.xlsx'] }) }));
  assert.equal(r.status, 400);
});

test('an incomplete, untidy sheet still publishes, with gaps stored as not reported', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(['SL', 'Name of the PHCs/CHCs/ Sub Division Hospital', 'Is anti-venom available(Yes/No) (quantity (nos) available)', 'Working hour available for the services in 24 hrs']);
  ws.addRow([1, 2, 3, 4]);
  ws.addRow([1, 'Puri DHH', 'Yes (80)', '24 hrs']);
  ws.addRow([2, 'Satyabadi CHC', 'many', '']);
  ws.addRow([3, 'Kakatpur PHC', 'No', '9-5']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  let r = await fetch(`${base}/admin/reports`, authed({ method: 'POST', body: form({ district: 'puri' }, { file: [buf, 'puri.xlsx'] }) }));
  assert.equal(r.status, 201, await r.clone().text());
  const d = (await (await fetch(`${base}/districts`)).json()).find((x) => x.slug === 'puri');
  assert.equal(d.report.facilityCount, 3);
  assert.equal(d.report.totalVials, 80);
  assert.equal(d.report.unknownStock, 1);
  assert.equal(d.report.outOfStock, 1);
  const f = await (await fetch(`${base}/facilities?district=puri`)).json();
  const sat = f.find((x) => x.name === 'Satyabadi CHC');
  assert.equal(sat.quantity, null);
  assert.equal(sat.available, null);
  assert.equal(sat.mo, null);
  assert.equal(sat.s24, null);
  assert.equal(f.find((x) => x.name === 'Kakatpur PHC').hours, '9-5');
});

test('a sheet with no facilities is rejected with a clear message', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('S').addRow(['Name', 'Count']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await fetch(`${base}/admin/reports/preview`, authed({ method: 'POST', body: form({ district: 'goa' }, { file: [buf, 'x.xlsx'] }) }));
  assert.equal(r.status, 400);
  const r2 = await fetch(`${base}/admin/reports/preview`, authed({ method: 'POST', body: form({ district: 'puri' }, { file: [buf, 'x.xlsx'] }) }));
  const j = await r2.json();
  assert.equal(j.ok, false);
  assert.match(j.errors[0].message, /No facilities/);
});

test('template downloads', async () => {
  const r = await fetch(`${base}/template.xlsx`);
  assert.equal(r.status, 200);
  assert.ok((await r.arrayBuffer()).byteLength > 1000);
});
