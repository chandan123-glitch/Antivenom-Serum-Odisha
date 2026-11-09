// Stock level of a facility. Values the district did not report stay "unknown", never guessed.
export function stockLevel(f, low) {
  if (f.available === false || f.quantity === 0) return 'out';
  if (f.quantity != null) return f.quantity < low ? 'low' : 'ok';
  return f.available === true ? 'yes' : 'unknown';
}
export const LEVEL_LABEL = { out: 'Out of stock', low: 'Low stock', ok: 'In stock', yes: 'Count not given', unknown: 'Not reported' };
export const isReady = (f) => (f.available === true || f.quantity > 0) && f.mo === true && f.s24 === true;
// Sort key: most vials first, then "available, count not given", then out of stock, then not reported.
export const stockRank = (f) => (f.quantity != null ? f.quantity : f.available === true ? 0.5 : f.available === false ? 0 : -1);

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Guess the district from a file name such as "nawarangpur.xlsx" (tolerates spelling slips). */
export function guessDistrict(filename, districts) {
  const tokens = filename.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/).filter((t) => t.length >= 4);
  let best = null;
  for (const d of districts) for (const t of tokens) {
    const dist = lev(t, d.slug);
    if (dist <= Math.max(1, Math.floor(d.slug.length / 5)) && (!best || dist < best.dist)) best = { slug: d.slug, dist };
  }
  return best?.slug ?? null;
}

export function parseYmd(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function fmtDate(s) {
  const d = parseYmd(s);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}
export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function daysSince(s) {
  const d = parseYmd(s);
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((t - d) / 86400000);
}
export function ago(s) {
  const n = daysSince(s);
  if (n == null) return '';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 60) return `${n} days ago`;
  return `${Math.round(n / 30)} months ago`;
}
export function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const mapsLink = (f) =>
  `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}`;

export function toCsv(rows) {
  const head = ['District', 'Block', 'Type', 'Facility', 'Latitude', 'Longitude', 'ASV vials', 'MO (MBBS)', '24x7 service', 'Last administered', 'Stock as on'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const yn = (v) => (v == null ? 'Not reported' : v ? 'Yes' : 'No');
  const lines = rows.map((f) => [f.districtName, f.block, f.type, f.name, f.lat, f.lng, f.quantity ?? (f.available == null ? 'Not reported' : f.available ? 'Yes' : 'No'), yn(f.mo), f.s24 == null ? 'Not reported' : f.s24 ? 'Yes' : f.hours ? `No (${f.hours})` : 'No', f.lastAdmin, f.asOn].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\r\n');
}
export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
