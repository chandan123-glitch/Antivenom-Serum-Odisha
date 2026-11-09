import { Link } from 'react-router-dom';
import { useData } from '../data.jsx';
import { ago, daysSince, fmtDate, fmtDateTime } from '../lib.js';

export default function AdminOverview() {
  const { districts } = useData();
  const reported = districts.filter((d) => d.report).length;
  const pct = Math.round((reported / districts.length) * 100);
  return (
    <>
      <div className="progress">
        <p><strong>{reported} of {districts.length}</strong> districts have submitted a report.</p>
        <div className="bar" role="progressbar" aria-valuenow={reported} aria-valuemin="0" aria-valuemax={districts.length} aria-label="Districts reported"><span style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="tablewrap always">
        <table className="ftable">
          <thead><tr><th>District</th><th>Status</th><th>Stock as on</th><th>Facilities</th><th>Vials</th><th>Not reported</th><th>Uploaded</th><th><span className="sr">Action</span></th></tr></thead>
          <tbody>
            {districts.map((d) => {
              const r = d.report;
              const stale = r && daysSince(r.reportDate) > 30;
              return (
                <tr key={d.slug}>
                  <td><strong>{d.name}</strong></td>
                  <td>{!r ? <span className="tag tag-no">Pending</span> : stale ? <span className="tag tag-warn">Out of date</span> : <span className="tag tag-yes">Reported</span>}</td>
                  <td>{r ? <>{fmtDate(r.reportDate)} <span className="muted small">({ago(r.reportDate)})</span></> : '–'}</td>
                  <td>{r ? r.facilityCount : '–'}</td>
                  <td>{r ? r.totalVials.toLocaleString('en-IN') : '–'}</td>
                  <td>{r ? (r.unknownStock ? <span className="tag tag-warn">{r.unknownStock} facilities</span> : <span className="muted">None</span>) : '–'}</td>
                  <td>{r ? fmtDateTime(r.uploadedAt) : '–'}</td>
                  <td><Link className="btn btn-small" to={`/admin/upload?district=${d.slug}`}>{r ? 'Update' : 'Upload'}</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
