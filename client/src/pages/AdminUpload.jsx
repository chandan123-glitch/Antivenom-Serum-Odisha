import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useData } from '../data.jsx';
import { useAdmin } from '../admin.jsx';
import { fmtDate, guessDistrict } from '../lib.js';

const today = () => new Date().toISOString().slice(0, 10);

function Issues({ title, items, kind }) {
  if (!items.length) return null;
  return (
    <details className={`issues issues-${kind}`} open={kind === 'error'}>
      <summary>{title} ({items.length})</summary>
      <table className="ftable compact">
        <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
        <tbody>{items.map((e, i) => <tr key={i}><td>{e.row ?? '–'}</td><td>{e.field || '–'}</td><td>{e.message}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

const GAPS = [
  ['stock', 'Serum availability'], ['doctor', 'Trained doctor'], ['hours', 'Working hours'],
  ['location', 'Location'], ['lastAdmin', 'Date last given'],
];
/** How much of the sheet the district actually filled in. */
function Completeness({ c }) {
  return (
    <div>
      <h3>What this district reported</h3>
      <ul className="completeness">
        {GAPS.map(([k, label]) => (
          <li key={k}>
            <span>{label}</span>
            <div className="bar" aria-hidden="true"><span style={{ width: `${c.total ? (c[k] / c.total) * 100 : 0}%` }} /></div>
            <span className="n">{c[k]} of {c.total}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Anything not reported is published as "Not reported". It is never shown as No or zero.</p>
    </div>
  );
}

/** Lets the admin say which Excel column holds each field, whatever the sheet calls it. */
function Mapping({ inspect, map, setMap, sheet, setSheet, headerRow, setHeaderRow, dirty, busy, onRecheck, open }) {
  const matched = inspect.fields.filter((f) => map[f.key]).length;
  const setField = (key, v) => setMap((m) => { const n = { ...m }; if (v) n[key] = Number(v); else delete n[key]; return n; });
  const resetAuto = (fn) => { fn(); setMap(null); };
  return (
    <details className="panel mapping" open={open}>
      <summary><strong>Match your columns</strong> <span className="muted">({matched} of {inspect.fields.length} matched)</span></summary>
      <p className="muted small">Your sheet can use any column names. Check each match below and change any that are wrong.</p>
      <div className="row">
        {inspect.sheets.length > 1 && (
          <label className="field grow"><span>Sheet</span>
            <select value={sheet} onChange={(e) => resetAuto(() => { setSheet(e.target.value); setHeaderRow(''); })}>
              {inspect.sheets.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}
        <label className="field hdr"><span>Header row number</span>
          <input type="number" min="1" max="50" value={headerRow} onChange={(e) => resetAuto(() => setHeaderRow(e.target.value))} />
        </label>
      </div>
      <div className="mapgrid">
        {inspect.fields.map((f) => {
          const missing = f.required && !map[f.key];
          return (
            <label key={f.key} className="field">
              <span>{f.label}{f.required ? ' *' : ''}</span>
              <select value={map[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)} aria-invalid={missing}
                className={missing ? 'invalid' : ''}>
                <option value="">{f.required ? 'Choose a column' : 'Not in my sheet'}</option>
                {inspect.headers.map((h) => <option key={h.index} value={h.index}>{h.letter}: {h.label}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      {inspect.sample.length > 0 && (
        <details className="sample">
          <summary>First rows of your sheet</summary>
          <div className="tablewrap always">
            <table className="ftable compact">
              <thead><tr>{inspect.headers.map((h) => <th key={h.index}>{h.letter}: {h.label}</th>)}</tr></thead>
              <tbody>{inspect.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      <button type="button" className={`btn ${dirty ? 'btn-primary' : ''}`} onClick={onRecheck} disabled={busy}>Check again with these columns</button>
    </details>
  );
}

export default function AdminUpload() {
  const { districts, reload } = useData();
  const { expire } = useAdmin();
  const [params] = useSearchParams();
  const [district, setDistrict] = useState(params.get('district') || '');
  const [reportDate, setReportDate] = useState(today());
  const [letterNo, setLetterNo] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [letter, setLetter] = useState(null);
  const [map, setMap] = useState(null);        // field -> Excel column number (null = detect automatically)
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState('');
  const [checkedKey, setCheckedKey] = useState('');
  const [check, setCheck] = useState(null);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [guessed, setGuessed] = useState(false);

  const current = districts.find((d) => d.slug === district)?.report;
  const key = JSON.stringify([map, sheet, headerRow]);
  const dirty = !!check && key !== checkedKey;
  const reset = () => { setCheck(null); setDone(null); setErr(null); };
  const resetFile = () => { reset(); setMap(null); setSheet(''); setHeaderRow(''); setCheckedKey(''); };

  const build = (opts) => {
    const f = new FormData();
    f.append('district', district); f.append('reportDate', reportDate);
    f.append('letterNo', letterNo); f.append('notes', notes);
    f.append('file', file); if (letter) f.append('letter', letter);
    const m = opts.map, s = opts.sheet, h = opts.headerRow;
    if (m) f.append('mapping', JSON.stringify(m));
    if (s) f.append('sheet', s);
    if (h) f.append('headerRow', String(h));
    return f;
  };
  const adopt = (res, used) => {
    const i = res.inspect;
    if (!i) return;
    const next = { map: i.mapping, sheet: i.sheet, headerRow: String(i.headerRow) };
    setMap(next.map); setSheet(next.sheet); setHeaderRow(next.headerRow);
    setCheckedKey(JSON.stringify([next.map, next.sheet, next.headerRow]));
  };
  const fail = (e) => {
    if (e.status === 401) return expire();
    if (e.status === 422 && e.body?.errors) { setCheck({ ...e.body, ok: false }); adopt(e.body); setErr(null); }
    else setErr(e.message);
  };

  async function runCheck(opts) {
    setBusy(true); setDone(null); setErr(null);
    try { const res = await api('/admin/reports/preview', { method: 'POST', form: build(opts) }); setCheck(res); adopt(res); }
    catch (x) { fail(x); } finally { setBusy(false); }
  }
  const validate = (e) => { e.preventDefault(); setCheck(null); runCheck({ map, sheet, headerRow }); };
  async function publish() {
    setBusy(true); setErr(null);
    try { setDone(await api('/admin/reports', { method: 'POST', form: build({ map, sheet, headerRow }) })); setCheck(null); await reload(); }
    catch (x) { fail(x); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="panel stack">
        <h2>Published: {done.district}</h2>
        <p>{done.stats.facilities} facilities and {done.stats.totalVials.toLocaleString('en-IN')} vials are now live on the public site.</p>
        <div className="row">
          <Link className="btn btn-primary" to={`/district/${district}`}>View public page</Link>
          <button className="btn" onClick={() => { setFile(null); setLetter(null); setDistrict(''); setLetterNo(''); setNotes(''); resetFile(); }}>Upload another district</button>
        </div>
      </div>
    );
  }

  const needsMapping = check && (check.needsMapping || !check.ok);
  return (
    <div className="two-col">
      <form className="panel stack" onSubmit={validate}>
        <h2>Upload a district report</h2>
        <label className="field"><span>District</span>
          <select required value={district} onChange={(e) => { setDistrict(e.target.value); setGuessed(false); reset(); }}>
            <option value="" disabled>Choose a district</option>
            {districts.map((d) => <option key={d.slug} value={d.slug}>{d.name}{d.report ? '' : ' (pending)'}</option>)}
          </select>
        </label>
        {guessed && <p className="hint">Picked from the file name. Change it if that is wrong.</p>}
        {current && <p className="notice notice-warn">{districts.find((d) => d.slug === district).name} already has a report as on {fmtDate(current.reportDate)}. Publishing replaces it on the public site. The old one stays in History.</p>}
        <label className="field"><span>Stock as on</span><input required type="date" max={today()} value={reportDate} onChange={(e) => { setReportDate(e.target.value); reset(); }} /></label>
        <label className="field"><span>Excel file (.xlsx), any layout</span><input required type="file" accept=".xlsx" onChange={(e) => {
          const f = e.target.files[0] || null;
          setFile(f); resetFile();
          if (f && !district) { const g = guessDistrict(f.name, districts); if (g) { setDistrict(g); setGuessed(true); } }
        }} /></label>
        <label className="field"><span>Collectorate letter (PDF, optional)</span><input type="file" accept="application/pdf,.pdf" onChange={(e) => { setLetter(e.target.files[0] || null); reset(); }} /></label>
        <label className="field"><span>Letter number (optional)</span><input maxLength="80" value={letterNo} onChange={(e) => setLetterNo(e.target.value)} /></label>
        <label className="field"><span>Notes (optional)</span><textarea rows="2" maxLength="500" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <p className="notice notice-error" role="alert">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !district || !file}>{busy && !check ? 'Checking…' : 'Check file'}</button>
        <p className="muted small">Nothing goes live until you publish. <a href="/api/template.xlsx">Download the Excel template</a> (optional).</p>
      </form>

      <div className="stack" aria-live="polite">
        {check?.inspect && map && (
          <Mapping inspect={check.inspect} map={map} setMap={setMap} sheet={sheet} setSheet={setSheet} headerRow={headerRow} setHeaderRow={setHeaderRow}
            dirty={dirty} busy={busy} open={needsMapping || dirty} onRecheck={() => runCheck({ map, sheet, headerRow })} />
        )}
        {check && (
          <div className="panel stack">
            {check.ok ? <h2>Ready to publish</h2> : <h2>This file cannot be published yet</h2>}
            {check.ok && check.warnings.length > 0 && <p className="muted">{check.warnings.length} note{check.warnings.length === 1 ? '' : 's'} below. They do not stop publishing. Gaps are shown to the public as "Not reported".</p>}
            {dirty && <p className="notice notice-warn">You changed the column matches. Check again to update these results.</p>}
            {check.stats && (
              <dl className="mini">
                <div><dt>Facilities</dt><dd>{check.stats.facilities}</dd></div>
                <div><dt>Vials counted</dt><dd>{check.stats.totalVials.toLocaleString('en-IN')}</dd></div>
                <div><dt>Ready</dt><dd>{check.stats.ready}</dd></div>
                {check.stats.unknownStock > 0 && <div><dt>Serum not reported</dt><dd>{check.stats.unknownStock}</dd></div>}
              </dl>
            )}
            {check.stats?.completeness && <Completeness c={check.stats.completeness} />}
            <Issues title="Problems" items={check.errors} kind="error" />
            <Issues title="Notes. You can still publish" items={check.warnings} kind="warn" />
            {check.ok && <button className="btn btn-primary" onClick={publish} disabled={busy || dirty}>{busy ? 'Publishing…' : `Publish ${check.district} report`}</button>}
            {!check.ok && !check.inspect && <p className="muted small">Correct the sheet, then choose the file and check it again.</p>}
          </div>
        )}
        {!check && <div className="panel"><h2>NOTE:</h2>
          <p className="muted">Use the Government of Odisha format</p>
          <p className="muted">⚠️ ADMIN ALERT :

Before uploading any document to the Anti-Venom Serum Management System, please ensure that the document is accurate, complete, legible and relevant to the selected district, block, Gram Panchayat or health facility.

Important Instructions:

Verify that the document corresponds to the correct district and reporting period.

Ensure that all information and figures mentioned in the document are accurate and up to date.

Upload only valid documents in the prescribed file format (PDF, JPG or PNG).

Ensure that the uploaded document is properly scanned and clearly readable.

Avoid uploading duplicate, incomplete or incorrect documents.

Verify the document before submitting, as it may become part of the official monitoring and reporting records.

Note: The Admin is responsible for verifying the authenticity and accuracy of uploaded documents. Any incorrect or misleading information must be rectified immediately.

Please review carefully before proceeding with the upload.</p></div>}
      </div>
    </div>
  );
}
