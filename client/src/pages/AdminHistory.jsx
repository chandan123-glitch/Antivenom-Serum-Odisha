import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../data.jsx';
import { useAdmin } from '../admin.jsx';
import { fmtDate, fmtDateTime } from '../lib.js';

export default function AdminHistory() {
  const { reload } = useData();
  const { expire } = useAdmin();
  const [reports, setReports] = useState(null);
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([api('/admin/reports'), api('/admin/audit')]);
      setReports(r); setAudit(a); setErr(null);
    } catch (e) { e.status === 401 ? expire() : setErr(e.message); }
  }, [expire]);
  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    try { await fn(); await Promise.all([load(), reload()]); }
    catch (e) { e.status === 401 ? expire() : setErr(e.message); }
  }

  if (!reports) return <p className="muted" role="status">{err || 'Loading…'}</p>;
  return (
    <>
      {err && <p className="notice notice-error" role="alert">{err}</p>}
      <h2>Uploaded reports</h2>
      {reports.length === 0 ? <div className="empty"><p>No reports uploaded yet.</p></div> : (
        <div className="tablewrap always">
          <table className="ftable">
            <thead><tr><th>District</th><th>Stock as on</th><th>Facilities</th><th>Vials</th><th>Uploaded</th><th>Files</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.district}</strong></td>
                  <td>{fmtDate(r.reportDate)}</td>
                  <td>{r.facilityCount}</td>
                  <td>{r.totalVials.toLocaleString('en-IN')}</td>
                  <td>{fmtDateTime(r.uploadedAt)}<br /><span className="muted small">by {r.uploadedBy}</span></td>
                  <td className="files"><a href={`/api/admin/reports/${r.id}/source`}>Excel</a>{r.hasLetter && <> · <a href={`/api/admin/reports/${r.id}/letter`}>Letter</a></>}</td>
                  <td>{r.current ? <span className="tag tag-yes">Live</span> : <span className="tag">Replaced</span>}</td>
                  <td className="actions">
                    {!r.current && <button className="btn btn-small" onClick={() => act(() => api(`/admin/reports/${r.id}/restore`, { method: 'POST' }))}>Make live</button>}
                    <button className="btn btn-small btn-danger" onClick={() => { if (confirm(`Delete the ${r.district} report from ${fmtDate(r.reportDate)}? This cannot be undone.${r.current ? ' The previous upload, if any, becomes live.' : ''}`)) act(() => api(`/admin/reports/${r.id}`, { method: 'DELETE' })); }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Activity log</h2>
      <div className="tablewrap always">
        <table className="ftable compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
          <tbody>{audit.map((a, i) => <tr key={i}><td>{fmtDateTime(a.at)}</td><td>{a.actor}</td><td>{a.action.replace(/_/g, ' ')}</td><td>{a.detail}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
