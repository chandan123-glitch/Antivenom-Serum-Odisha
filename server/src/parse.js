import ExcelJS from 'exceljs';

/**
 * Reads a district ASV stock sheet. Designed so that an upload is never refused because a
 * district left out columns or filled them in loosely:
 *
 *  - Any column names, any order, title rows, numbering rows ("1 2 3 ... 7"), repeated headers
 *    and total rows are handled.
 *  - Only the facility name is essential. Everything else that is missing, blank or unreadable is
 *    recorded as "not reported" (null) and listed as a warning, never as an error.
 *  - Errors are reserved for an unreadable file, or a sheet with no facilities at all.
 */

const MAX_ROWS = 1000;
const MAX_COLS = 60;
const HEADER_SCAN = 15;
const BOUNDS = { latMin: 17.7, latMax: 22.7, lngMin: 81.3, lngMax: 87.6 }; // Odisha
const OUTLIER_KM = 90;
const KNOWN_TYPES = ['DHH', 'SDH', 'CHC', 'PHC(N)', 'PHC', 'UPHC', 'OH', 'MCH', 'AH'];

export const FIELDS = [
  { key: 'name', label: 'Facility name', required: true },
  { key: 'quantity', label: 'ASV available (Yes/No) or vial count' },
  { key: 'avail', label: 'ASV available (Yes/No), if in its own column' },
  { key: 'mo', label: 'Trained doctor / MBBS available' },
  { key: 's24', label: '24x7 service or working hours' },
  { key: 'location', label: 'Location (address and/or GPS)' },
  { key: 'lastAdmin', label: 'Date serum last given' },
  { key: 'block', label: 'Block' },
  { key: 'type', label: 'Facility type (CHC, PHC...)' },
  { key: 'slNo', label: 'Serial number' },
];
const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

// Header wording rules, in priority order: the first rule a header matches wins.
const NAME_RULES = [
  ['location', (h) => /location|gps|latlong|latlng|coordinate|latitude|address/.test(h)],
  ['s24', (h) => /24x7|247|24hr|24hour|24by7|roundtheclock|workinghour|workinghr|servicehour|hoursofservice/.test(h)],
  ['mo', (h) => /mbbs|medicalofficer|doctor|trainedstaff/.test(h) || /^mo\d*$/.test(h)],
  ['lastAdmin', (h) => /lastadmin|lastgiven|lastused|lastissued|lastdate|whenlast|datewhen/.test(h)],
  ['quantity', (h) => /quantity|qty|vial|noofasv|asvstock|^stock|availablestock|^asv$/.test(h)],
  ['avail', (h) => /(antivenom|antivenin|asv|avs|serum|snake).*avail|avail.*(antivenom|antivenin|asv|avs|serum)|^available$/.test(h)],
  ['type', (h) => h === 'type' || /typeof|facilitytype|category|level/.test(h)],
  ['block', (h) => /block|ulb|taluk|tehsil/.test(h)],
  ['name', (h) => h === 'name' || /^name|facility|hospital|institution|centre|center|phc|chc/.test(h)],
  ['slNo', (h) => /^(sino|slno|srno|sl|sno|si|serial|serialno|sr)$/.test(h)],
];

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  return v;
}

// ---------- value interpreters (all lenient: they return null for "can't tell") ----------

const NEGATIVE = /\b(no|nil|not|none|absent|unavailable|na|n\/a)\b|^[-–—x✗]$/;
const POSITIVE = /\b(yes|y|available|present|posted|trained|ok|true)\b|^[✓✔]$/;

/** Yes/No (also "Available", "Not available", "Nil", a head-count...) -> true / false / null. */
function parseYN(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v > 0;
  const s = clean(v).toLowerCase();
  if (!s) return null;
  if (NEGATIVE.test(s)) return false;
  if (POSITIVE.test(s)) return true;
  if (/^\d+$/.test(s)) return Number(s) > 0;
  return null;
}

/** "Yes (20)", "20", "20 vials", "Yes", "NIL", "No" -> { quantity?, available? } | { empty } | { bad } */
function parseStock(v) {
  if (v == null || clean(v) === '') return { empty: true };
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 && v <= 100000 ? { quantity: v, available: v > 0 } : { bad: true };
  }
  const low = clean(v).toLowerCase();
  const num = low.match(/(\d[\d,]*)/);
  if (num) {
    const q = Number(num[1].replace(/,/g, ''));
    return q <= 100000 ? { quantity: q, available: q > 0 } : { bad: true };
  }
  if (NEGATIVE.test(low)) return { quantity: 0, available: false };
  if (POSITIVE.test(low)) return { available: true };
  return { bad: true };
}

/** "24 hrs", "24x7", "Yes", "No", "9 AM to 5 PM" -> { s24, note } */
function parseHours(v) {
  if (v == null || clean(v) === '') return {};
  if (typeof v === 'number') return v >= 24 ? { s24: true } : { s24: false, note: `${v} hrs` };
  const s = clean(v), low = s.toLowerCase();
  if (/\b(no|not|nil|none)\b/.test(low)) return { s24: false };
  if (/24\s*(x|\*|by|\/)\s*7|24\s*h|round\s*the\s*clock|all\s*time|full\s*day|always|^24$/.test(low)) return { s24: true };
  if (/^(yes|y|available)\b/.test(low)) return { s24: true };
  return { s24: false, note: s.slice(0, 60) };
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function validYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const ymdOf = (y, m, d) => (validYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : undefined);
const yr = (y) => (Number(y) < 100 ? Number(y) + 2000 : Number(y));

function parseDateOne(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 60000) { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = clean(v).replace(/[‐-―−]/g, '-');
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return ymdOf(yr(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ymdOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ ,.-]+([A-Za-z]{3,9})[ ,.-]+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymdOf(yr(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  return undefined;
}

/** A date, or several dates in one cell (the latest wins). Returns { date } | { none } | { bad }. */
function parseDate(v) {
  if (v == null || clean(v) === '') return { none: true };
  const one = parseDateOne(v);
  if (one) return { date: one };
  const s = clean(v).replace(/[‐-―−]/g, '-');
  if (/^(nil|na|n\/a|none|never|no|not\b.*|[-–—])$/i.test(s)) return { none: true };
  const found = [...s.matchAll(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g)].map((m) => parseDateOne(m[0])).filter(Boolean);
  if (found.length) return { date: found.sort().at(-1) };
  return { bad: true };
}

function normType(v) {
  const t = clean(v).toUpperCase().replace(/\s+/g, '');
  return t === 'PHC(N)' || t === 'PHCN' ? 'PHC(N)' : t;
}
function inferType(name) {
  const n = name.toLowerCase();
  if (/\bdhh\b|district\s*head\s*quarter|district\s*hospital/.test(n)) return 'DHH';
  if (/\bsdh\b|sub[\s-]*divisional?\s*hospital|sub\s*division/.test(n)) return 'SDH';
  if (/\buphc\b|urban/.test(n)) return 'UPHC';
  if (/\bchc\b|community\s*health/.test(n)) return 'CHC';
  if (/\bphc\s*\(?\s*n\s*\)?|\bphcn\b/.test(n)) return 'PHC(N)';
  if (/\bphc\b|primary\s*health/.test(n)) return 'PHC';
  if (/\bmch\b|medical\s*college/.test(n)) return 'MCH';
  return '';
}

const inLat = (x) => x >= BOUNDS.latMin && x <= BOUNDS.latMax;
const inLng = (x) => x >= BOUNDS.lngMin && x <= BOUNDS.lngMax;

/** Pull coordinates out of free text such as "Near bus stand, 19.2286 N, 82.5667 E" or DMS. */
function parseLocation(v) {
  const text = clean(v);
  if (!text) return { empty: true };
  let nums = [...text.matchAll(/-?\d{1,3}\.\d+/g)].map((m) => Number(m[0]));
  if (nums.length < 2) {
    nums = [...text.matchAll(/(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)?\s*(?:["”″]|''|’’)?\s*([NSEWnsew])?/g)]
      .map((m) => { const x = Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600; return /[SWsw]/.test(m[4] || '') ? -x : x; });
  }
  const lat = nums.find(inLat);
  const lng = nums.find(inLng);
  const words = text.replace(/\b(lat(itude)?|long(itude)?|lng|gps|coordinates?|location|n|e)\b/gi, ' ').replace(/[^A-Za-z]+/g, ' ').trim();
  const address = words.replace(/\s/g, '').length >= 4 ? text.slice(0, 300) : null;
  if (lat != null && lng != null) return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, address };
  return { address, outside: nums.length >= 2, none: nums.length < 2 };
}

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const colLetter = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// ---------- reading & detection ----------

function readGrid(ws) {
  const maxR = Math.min(ws.rowCount, MAX_ROWS + HEADER_SCAN + 50);
  const maxC = Math.min(ws.columnCount || 0, MAX_COLS);
  const grid = [];
  for (let r = 1; r <= maxR; r++) {
    const row = ws.getRow(r);
    const arr = [];
    for (let c = 1; c <= maxC; c++) arr.push(cellValue(row.getCell(c).value));
    grid.push(arr);
  }
  return grid;
}

const looksLikeData = (row) => row.filter((v) => typeof v === 'number' || v instanceof Date).length >= 2;

function isNumberingRow(cells) {
  const vals = cells.map(clean).filter(Boolean);
  if (vals.length < 3 || !vals.every((x) => /^\d+$/.test(x))) return false;
  const n = vals.map(Number);
  return n.every((x, i) => x === n[0] + i); // 1 2 3 4 5 6 7
}

function matchHeaders(row) {
  const mapping = {};
  row.forEach((v, i) => {
    const h = norm(v);
    if (!h) return;
    for (const [key, test] of NAME_RULES) {
      if (!(key in mapping) && test(h)) { mapping[key] = i + 1; break; }
    }
  });
  if (mapping.avail && !mapping.quantity) { mapping.quantity = mapping.avail; delete mapping.avail; }
  return mapping;
}

/** Fill in fields the header wording did not reveal by looking at the data itself. */
function sniff(mapping, grid, headerIdx) {
  const used = new Set(Object.values(mapping));
  const data = grid.slice(headerIdx + 1, headerIdx + 201).filter((r) => !isNumberingRow(r));
  const ncols = Math.max(0, ...grid.slice(0, HEADER_SCAN + 5).map((r) => r.length));
  const cols = [];
  for (let c = 1; c <= ncols; c++) {
    if (used.has(c)) continue;
    const vals = data.map((r) => r[c - 1]).filter((v) => clean(v) !== '');
    if (vals.length >= 2) cols.push({ c, vals });
  }
  const frac = (vals, fn) => vals.filter(fn).length / vals.length;
  const take = (key, pred) => {
    if (key in mapping) return;
    const hit = cols.find((x) => !used.has(x.c) && pred(x.vals));
    if (hit) { mapping[key] = hit.c; used.add(hit.c); }
  };
  const isInt = (x) => (typeof x === 'number' ? Number.isInteger(x) : /^\d+$/.test(clean(x)));
  const isYN = (x) => typeof x !== 'number' && parseYN(x) !== null;
  take('location', (v) => frac(v, (x) => typeof x !== 'number' && !parseLocation(x).none) >= 0.6);
  take('lastAdmin', (v) => frac(v, (x) => (x instanceof Date || typeof x === 'string') && parseDate(x).date) >= 0.7);
  take('type', (v) => frac(v, (x) => KNOWN_TYPES.includes(normType(x))) >= 0.8);
  take('mo', (v) => frac(v, isYN) >= 0.9);
  take('s24', (v) => frac(v, isYN) >= 0.9);
  take('slNo', (v) => v.every((x, i) => Number(x) === i + 1));
  take('quantity', (v) => frac(v, isInt) >= 0.9);
  // facility name: mostly distinct, non-numeric text
  take('name', (v) => frac(v, (x) => typeof x === 'string' && !/^\d+$/.test(clean(x))) >= 0.9 && new Set(v.map(clean)).size / v.length >= 0.8);
}

function detect(grid, fixedHeaderIdx) {
  let idx = 0, mapping = {};
  if (fixedHeaderIdx != null) {
    idx = fixedHeaderIdx;
    mapping = matchHeaders(grid[idx] || []);
  } else {
    let best = -1;
    for (let i = 0; i < Math.min(HEADER_SCAN, grid.length); i++) {
      if (looksLikeData(grid[i])) continue;
      const m = matchHeaders(grid[i]);
      const score = Object.keys(m).length;
      if (score > best) { best = score; idx = i; mapping = m; }
    }
    if (best < 3) { // no recognisable header wording: use the first row with several filled cells
      const first = grid.findIndex((r) => !looksLikeData(r) && r.filter((v) => clean(v) !== '').length >= 3);
      idx = Math.max(first, 0);
      mapping = matchHeaders(grid[idx] || []);
    }
  }
  sniff(mapping, grid, idx);
  return { headerIdx: idx, mapping };
}

function buildInspect(sheetNames, sheetName, grid, headerIdx, mapping) {
  const ncols = Math.max(0, ...grid.slice(0, HEADER_SCAN + 5).map((r) => r.length));
  const head = grid[headerIdx] || [];
  const headers = [];
  for (let c = 1; c <= ncols; c++) headers.push({ index: c, letter: colLetter(c), label: clean(head[c - 1]).slice(0, 60) || '(empty)' });
  const sample = grid.slice(headerIdx + 1).filter((r) => !isNumberingRow(r)).slice(0, 3).map((r) =>
    headers.map((h) => { const v = r[h.index - 1]; return v instanceof Date ? parseDateOne(v) : clean(v).slice(0, 60); }));
  return { sheets: sheetNames, sheet: sheetName, headerRow: headerIdx + 1, headers, sample, mapping, fields: FIELDS };
}

function cleanMapping(m, ncols) {
  const out = {};
  for (const f of FIELDS) {
    const v = Number(m?.[f.key]);
    if (Number.isInteger(v) && v >= 1 && v <= ncols) out[f.key] = v;
  }
  return out;
}

const rowsText = (rows) => rows.slice(0, 8).join(', ') + (rows.length > 8 ? ` and ${rows.length - 8} more` : '');

// ---------- main entry ----------

export async function parseWorkbook(buffer, { asOn, mapping: userMapping, sheet: sheetOpt, headerRow: headerOpt } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (message) => ({ ok: false, errors: [{ row: null, message }], warnings, rows: [], stats: null });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return fail('The file could not be read as an .xlsx workbook. Save it as Excel Workbook (.xlsx) and try again.');
  }
  const sheets = wb.worksheets.filter((w) => w.rowCount > 0);
  if (sheets.length === 0) return fail('The workbook has no data.');
  const sheetNames = sheets.map((w) => w.name);

  // choose the sheet: the one asked for, otherwise the one where most columns are recognised
  let ws = sheets.find((w) => w.name === sheetOpt);
  let grid;
  const fixedIdx = Number.isInteger(headerOpt) && headerOpt >= 1 ? headerOpt - 1 : null;
  if (ws) grid = readGrid(ws);
  else {
    let bestScore = -1;
    for (const w of sheets) {
      const g = readGrid(w);
      const score = Object.keys(detect(g, fixedIdx).mapping).length;
      if (score > bestScore) { bestScore = score; ws = w; grid = g; }
    }
  }
  const det = detect(grid, fixedIdx);
  const headerIdx = det.headerIdx;
  const ncols = Math.max(0, ...grid.slice(0, HEADER_SCAN + 5).map((r) => r.length));
  const mapping = userMapping && Object.keys(userMapping).length ? cleanMapping(userMapping, ncols) : det.mapping;
  const inspect = buildInspect(sheetNames, ws.name, grid, headerIdx, mapping);
  const stop = (message) => ({ ok: false, needsMapping: true, errors: [{ row: null, message }], warnings, rows: [], stats: null, inspect });

  if (!mapping.name) return stop('Could not tell which column holds the facility names. Choose it below.');
  const dupes = Object.entries(mapping).filter(([, c], i, a) => a.findIndex(([, c2]) => c2 === c) !== i).map(([k]) => FIELD_LABEL[k]);
  if (dupes.length) return stop(`The same Excel column is chosen for more than one field (${dupes.join(', ')}). Each field needs its own column.`);

  // Columns the district left out entirely: allowed, but say what it means.
  const hasStock = mapping.quantity || mapping.avail;
  if (!hasStock) warnings.push({ row: null, field: 'ASV availability', message: 'No column for ASV availability or vial count. Every facility will show as "Not reported" for serum.' });
  if (!mapping.mo) warnings.push({ row: null, field: 'Doctor', message: 'No column for trained doctor availability. It will show as "Not reported".' });
  if (!mapping.s24) warnings.push({ row: null, field: 'Working hours', message: 'No column for 24x7 service or working hours. It will show as "Not reported".' });
  if (!mapping.location) warnings.push({ row: null, field: 'Location', message: 'No location column. Facilities cannot be sorted by distance and have no Directions link.' });

  const today = new Date().toISOString().slice(0, 10);
  const limitDate = asOn && asOn > today ? asOn : today;
  const rows = [];
  const agg = { noName: [], noStock: [], noMo: [], noHours: [], noLoc: [] };
  const rowWarn = (row, field, message) => warnings.push({ row, field, message });
  let seenRows = 0;

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = i + 1;
    const cells = grid[i];
    const get = (k) => (mapping[k] ? cells[mapping[k] - 1] : null);
    const mappedCols = Object.values(mapping);
    if (mappedCols.every((c) => clean(cells[c - 1]) === '')) continue;           // blank row
    if (isNumberingRow(cells)) continue;                                           // the "1 2 3 ... 7" row
    const headNorm = grid[headerIdx].map(norm);
    const repeats = mappedCols.filter((c) => headNorm[c - 1] && norm(cells[c - 1]) === headNorm[c - 1]).length;
    if (repeats >= Math.min(3, mappedCols.length)) continue;                       // repeated header (e.g. new page)
    const nameRaw = clean(get('name'));
    if (/^(grand\s*)?(sub[\s-]*)?total\b/i.test(nameRaw) || (!nameRaw && cells.some((c) => /^(grand\s*)?total\b/i.test(clean(c))))) continue; // total row
    if (++seenRows > MAX_ROWS) { errors.push({ row: r, message: `Too many rows (limit ${MAX_ROWS}).` }); break; }

    // a row with no name and no ASV information is just noise
    const hasInfo = ['quantity', 'avail', 'mo', 's24', 'location', 'lastAdmin'].some((k) => clean(get(k)) !== '');
    if (!nameRaw && !hasInfo) { seenRows--; continue; }
    const name = nameRaw || `Facility (row ${r})`;
    if (!nameRaw) agg.noName.push(r);

    const block = mapping.block ? clean(get('block')) : '';
    const typeCell = mapping.type ? normType(get('type')) : '';
    const type = typeCell || inferType(name);
    if (typeCell && !KNOWN_TYPES.includes(typeCell)) rowWarn(r, FIELD_LABEL.type, `Unrecognised facility type "${typeCell}". Kept as written.`);

    // ASV: yes/no and/or number of vials
    let quantity = null, available = null;
    if (mapping.quantity) {
      const ps = parseStock(get('quantity'));
      if (ps.bad) rowWarn(r, FIELD_LABEL.quantity, `"${clean(get('quantity'))}" is not a vial count or Yes/No. Recorded as not reported.`);
      else if (!ps.empty) { quantity = ps.quantity ?? null; available = ps.available ?? null; }
    }
    if (mapping.avail) {
      const yn = parseYN(get('avail'));
      if (available == null && yn != null) available = yn;
      if (quantity == null && yn === false) quantity = 0;
    }
    if (hasStock && available == null && quantity == null) agg.noStock.push(r);

    // trained doctor
    let mo = null;
    if (mapping.mo) {
      mo = parseYN(get('mo'));
      if (mo === null) {
        if (clean(get('mo')) !== '') rowWarn(r, FIELD_LABEL.mo, `"${clean(get('mo'))}" is not Yes or No. Recorded as not reported.`);
        agg.noMo.push(r);
      }
    }

    // 24x7 / working hours
    let s24 = null, hours = null;
    if (mapping.s24) {
      const h = parseHours(get('s24'));
      s24 = h.s24 ?? null; hours = h.note ?? null;
      if (s24 === null) agg.noHours.push(r);
    }

    // location: coordinates and/or address in one cell
    let lat = null, lng = null, address = null;
    if (mapping.location) {
      const loc = parseLocation(get('location'));
      if (loc.empty) agg.noLoc.push(r);
      else {
        address = loc.address ?? null;
        if (loc.lat != null) ({ lat, lng } = loc);
        else if (loc.outside) rowWarn(r, FIELD_LABEL.location, 'Coordinates are outside Odisha, so they were ignored. Latitude and longitude may be wrong.');
        else agg.noLoc.push(r);
      }
    }

    // last administered date
    let lastAdmin = null;
    if (mapping.lastAdmin) {
      const d = parseDate(get('lastAdmin'));
      if (d.bad) rowWarn(r, FIELD_LABEL.lastAdmin, `"${clean(get('lastAdmin'))}" is not a date. Left blank.`);
      else if (d.date && d.date > limitDate) rowWarn(r, FIELD_LABEL.lastAdmin, `${d.date} is in the future. Left blank.`);
      else if (d.date) lastAdmin = d.date;
    }

    const slRaw = get('slNo');
    rows.push({
      rowNumber: r, slNo: /^\d+$/.test(clean(slRaw)) ? Number(clean(slRaw)) : null,
      block, type, name, address, lat, lng, quantity, available, mo, s24, hours, lastAdmin,
    });
  }

  if (rows.length === 0 && errors.length === 0) errors.push({ row: null, message: 'No facilities were found below the header row. Check the sheet and the header row number.' });

  const summarise = (rowsArr, field, message) => { if (rowsArr.length) warnings.push({ row: rowsText(rowsArr), field, message: `${rowsArr.length} facilit${rowsArr.length === 1 ? 'y' : 'ies'}: ${message}` }); };
  summarise(agg.noName, 'Facility name', 'no name given. Shown as "Facility (row N)".');
  summarise(agg.noStock, 'ASV availability', 'serum availability blank. Shown as "Not reported".');
  summarise(agg.noMo, 'Doctor', 'doctor availability blank. Shown as "Not reported".');
  summarise(agg.noHours, 'Working hours', 'working hours blank. Shown as "Not reported".');
  summarise(agg.noLoc, 'Location', 'no usable coordinates. Not included in distance search.');

  // cross-row checks (warnings only)
  const seen = new Map(), coords = new Map();
  for (const f of rows) {
    const key = `${f.block}|${f.type}|${f.name}`.toLowerCase();
    if (seen.has(key)) rowWarn(f.rowNumber, FIELD_LABEL.name, `Same block, type and name as row ${seen.get(key)}. Both are kept.`);
    else seen.set(key, f.rowNumber);
    if (f.lat != null) {
      const ck = `${f.lat},${f.lng}`;
      if (coords.has(ck)) rowWarn(f.rowNumber, FIELD_LABEL.location, `Same coordinates as row ${coords.get(ck)}. One of them may be wrong.`);
      else coords.set(ck, f.rowNumber);
    }
  }
  const located = rows.filter((f) => f.lat != null);
  if (located.length >= 5) {
    const centre = { lat: median(located.map((f) => f.lat)), lng: median(located.map((f) => f.lng)) };
    for (const f of located) {
      const km = haversineKm(centre, f);
      if (km > OUTLIER_KM) rowWarn(f.rowNumber, FIELD_LABEL.location, `About ${Math.round(km)} km from the rest of the district. Check the coordinates or the district selected.`);
    }
  }

  const known = rows.filter((f) => f.quantity != null);
  const n = rows.length;
  const stats = {
    facilities: n,
    blocks: new Set(rows.map((f) => f.block).filter(Boolean)).size,
    totalVials: known.reduce((s, f) => s + f.quantity, 0),
    outOfStock: rows.filter((f) => f.available === false || f.quantity === 0).length,
    unknownStock: rows.filter((f) => f.available == null && f.quantity == null).length,
    ready: rows.filter((f) => (f.available === true || f.quantity > 0) && f.mo === true && f.s24 === true).length,
    completeness: {
      stock: rows.filter((f) => f.available != null || f.quantity != null).length,
      doctor: rows.filter((f) => f.mo != null).length,
      hours: rows.filter((f) => f.s24 != null).length,
      location: rows.filter((f) => f.lat != null).length,
      lastAdmin: rows.filter((f) => f.lastAdmin != null).length,
      total: n,
    },
  };
  return { ok: errors.length === 0, errors, warnings, rows, stats, inspect };
}
