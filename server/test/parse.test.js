import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/parse.js';

async function book(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('different header wording and column order are recognised', async () => {
  const buf = await book({ Data: [
    ['Sl.', 'Hospital', 'Subdivision/Block', 'Qty of ASV', 'Doctor posted?', 'Round the clock', 'Remarks', 'Coordinates', 'Category', 'Last used'],
    [1, 'Titlagarh CHC', 'Titlagarh', 40, 'Yes', 'No', 'ok', '20.29, 83.13', 'CHC', '12/03/2026'],
    [2, 'Muribahal PHC', 'Muribahal', 12, 'No', 'No', '', '20.35, 83.05', 'PHC', '01-Feb-2026'],
  ] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.rows[0].name, 'Titlagarh CHC');
  assert.equal(r.rows[0].quantity, 40);
  assert.equal(r.rows[0].lastAdmin, '2026-03-12');
  assert.equal(r.rows[1].lastAdmin, '2026-02-01');
  assert.equal(r.rows[1].mo, false);
});

test('title rows above the header and unrelated extra columns are skipped', async () => {
  const buf = await book({ S: [
    ['ASV stock report, Puri district'], [],
    ['Facility', 'Block', 'ASV vials', 'MBBS', '24x7', 'Phone'],
    ['Puri DHH', 'Puri', 100, 'Yes', 'Yes', '9999'],
  ] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.inspect.headerRow, 3);
  assert.equal(r.rows.length, 1);
});

test('columns are inferred from the data when headers are meaningless', async () => {
  const buf = await book({ S: [
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    ['Hospital X', 'Block1', 25, 'Yes', 'No', '19.5, 85.1', '10-10-2025'],
    ['Hospital Y', 'Block2', 0, 'No', 'No', '19.6, 85.2', '11-10-2025'],
    ['Hospital Z', 'Block2', 8, 'Yes', 'Yes', '19.7, 85.3', ''],
  ] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.inspect.mapping.name, 1);
  assert.equal(r.inspect.mapping.quantity, 3);
  assert.equal(r.inspect.mapping.location, 6);
  assert.equal(r.inspect.mapping.lastAdmin, 7);
  assert.equal(r.inspect.mapping.mo, 4);
  assert.equal(r.inspect.mapping.s24, 5);
  assert.equal(r.stats.totalVials, 33);
});

test('admin-supplied mapping overrides detection', async () => {
  const buf = await book({ S: [
    ['A', 'B', 'C', 'D', 'E'],
    ['Hospital X', 'Block1', 25, 'Yes', 'No'],
    ['Hospital Y', 'Block2', 0, 'No', 'No'],
  ] });
  const r = await parseWorkbook(buf, { mapping: { name: 1, block: 2, quantity: 3, mo: 4, s24: 5 } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.stats.totalVials, 25);
  assert.equal(r.stats.outOfStock, 1);
  assert.ok(r.warnings.some((w) => /location/i.test(w.message)));
});

test('picks the right sheet and rejects duplicate column choices', async () => {
  const buf = await book({
    Cover: [['Note'], ['Read me']],
    Stock: [['Facility', 'Block', 'Quantity', 'MO MBBS', '24x7'], ['F', 'B', 5, 'Yes', 'Yes']],
  });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true);
  assert.equal(r.inspect.sheet, 'Stock');
  const d = await parseWorkbook(buf, { sheet: 'Stock', mapping: { name: 1, block: 1, quantity: 3, mo: 4, s24: 5 } });
  assert.equal(d.ok, false);
  assert.match(d.errors[0].message, /same Excel column/);
});

// The format issued by the Government of Odisha (7 columns, a 1..7 numbering row, no Block/Type column)
const GOVT_HEAD = ['SL', 'Name of the PHCs/CHCs/ Sub Division Hospital', 'Location (Address with GPS Coordinates)',
  'Is anti-venom available(Yes/No) (quantity (nos) available)',
  'Is trained Doctors available for administration of anti-venom (Yes/No)',
  'Working hour available for the services in 24 hrs', 'Date(when last administration made)'];

test('government format: numbering row, combined Yes/quantity, address with GPS, working hours text', async () => {
  const buf = await book({ Sheet1: [
    ['ASV availability, Koraput district'],
    GOVT_HEAD,
    [1, 2, 3, 4, 5, 6, 7],
    [1, 'Koraput DHH', 'Koraput town, Lat 18.8135 Long 82.7123', 'Yes (150)', 'Yes', '24 hrs', '12/10/2026'],
    [2, 'Semiliguda CHC', '18.7120, 82.8530', '40', 'Yes', 'No', '01-09-2026, 20-09-2026'],
    [3, 'Pottangi PHC(N)', 'Pottangi', 'Yes', 'No', '9 AM to 5 PM', ''],
    [4, 'Kundra PHC', '', 'NIL', '', '', 'Nil'],
    [5, 'Jeypore SDH', '19°00\'30"N 82°33\'10"E', 'Available', 'Trained doctor available', 'Round the clock', 'not given'],
    ['', 'Total', '', 190, '', '', ''],
  ] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.inspect.headerRow, 2);
  assert.equal(r.rows.length, 5); // numbering and total rows skipped
  const [dhh, chc, phc, kundra, sdh] = r.rows;
  assert.deepEqual([dhh.quantity, dhh.available, dhh.mo, dhh.s24, dhh.lat], [150, true, true, true, 18.8135]);
  assert.equal(dhh.address, 'Koraput town, Lat 18.8135 Long 82.7123');
  assert.equal(chc.quantity, 40);
  assert.equal(chc.lastAdmin, '2026-09-20');           // latest of two dates
  assert.equal(chc.lat, 18.712);
  assert.equal(chc.address, null);                      // coordinates only
  assert.deepEqual([phc.quantity, phc.available, phc.mo, phc.s24, phc.hours], [null, true, false, false, '9 AM to 5 PM']);
  assert.deepEqual([kundra.quantity, kundra.available, kundra.mo, kundra.s24], [0, false, null, null]);
  assert.ok(Math.abs(sdh.lat - 19.0083) < 0.001 && Math.abs(sdh.lng - 82.5528) < 0.001); // DMS
  assert.equal(sdh.mo, true);
  assert.deepEqual(r.rows.map((x) => x.type), ['DHH', 'CHC', 'PHC(N)', 'PHC', 'SDH']); // inferred from names
  assert.equal(r.stats.ready, 2); // dhh and sdh
  assert.equal(r.stats.unknownStock, 0);
  assert.equal(r.stats.completeness.doctor, 4);
});

test('a district that leaves out most columns still uploads cleanly', async () => {
  const buf = await book({ S: [
    ['Name of facility', 'Is anti-venom available(Yes/No)'],
    ['Alpha CHC', 'Yes'], ['Beta PHC', 'No'], ['Gamma PHC', 'maybe'], ['Delta PHC', ''],
  ] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.rows.map((x) => x.available), [true, false, null, null]);
  assert.ok(r.rows.every((x) => x.mo === null && x.s24 === null && x.lat === null));
  assert.equal(r.stats.ready, 0);
  assert.ok(r.warnings.some((w) => /doctor/i.test(w.message)));
  assert.ok(r.warnings.some((w) => /maybe/.test(w.message)));
});

test('junk values become warnings, never errors', async () => {
  const buf = await book({ S: [
    ['Facility', 'Block', 'ASV vials', 'Doctor', '24x7', 'Location', 'Last given'],
    ['A', 'B1', 'many', 'maybe', 'sometimes', '99.9, 10.1', '31-02-2026'],
    ['B', 'B1', 5, 'Yes', 'Yes', '19.5, 85.1', '01-01-2099'],
  ] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.rows[0].quantity, null);
  assert.equal(r.rows[0].lat, null);
  assert.equal(r.rows[0].lastAdmin, null);
  assert.equal(r.rows[1].lastAdmin, null); // future date ignored
  assert.ok(r.warnings.length >= 4);
});

test('only a sheet with no facilities at all is rejected', async () => {
  const buf = await book({ S: [['Facility', 'Block', 'Quantity'], [], ['', '', '']] });
  const r = await parseWorkbook(buf);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /No facilities/);
});
