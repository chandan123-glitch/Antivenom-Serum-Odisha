import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../data.jsx';
import { ago, daysSince, fmtDate } from '../lib.js';

export default function Home() {
  const { districts, facilities } = useData();
  const nav = useNavigate();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === '#districts') document.getElementById('districts')?.scrollIntoView();
  }, [hash]);

  const t = useMemo(() => {
    const reported = districts.filter((d) => d.report);
    return {
      reported: reported.length,
      vials: reported.reduce((n, d) => n + d.report.totalVials, 0),
      facilities: reported.reduce((n, d) => n + d.report.facilityCount, 0),
      ready: reported.reduce((n, d) => n + d.report.ready, 0),
    };
  }, [districts]);

  return (
    <>
      <section className="hero">
        <div className="page hero-grid">
          <div>
            <h1>Find a hospital in Odisha that has anti-snake venom serum.</h1>
            <p className="lede">
              Every district reports its serum stock, whether a doctor is on duty and whether the
              facility treats snakebite round the clock. Search by your location or by district.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-big" to="/find?locate=1">Find the nearest facility</Link>
              <label className="select-wrap">
                <span className="sr">Choose a district</span>
                <select defaultValue="" onChange={(e) => e.target.value && nav(`/district/${e.target.value}`)}>
                  <option value="" disabled>Or choose a district</option>
                  {districts.map((d) => <option key={d.slug} value={d.slug}>{d.name}{d.report ? '' : ' (no report yet)'}</option>)}
                </select>
              </label>
            </div>
          </div>
          <dl className="ledger" aria-label="State summary">
            <div><dt>Ready to treat now</dt><dd>{t.ready}<small>facilities with serum, a trained doctor and 24x7 service</small></dd></div>
            <div><dt>Vials counted</dt><dd>{t.vials.toLocaleString('en-IN')}<small>across {t.facilities} facilities</small></dd></div>
            <div><dt>Districts reporting</dt><dd>{t.reported}<span className="of"> of 30</span><small>others are yet to submit</small></dd></div>
          </dl>
        </div>
      </section>

      <section id="districts" className="page">
        <h2>Districts</h2>
        <p className="muted">{facilities.length === 0 ? 'No district has submitted a report yet.' : 'Select a district to see every facility and its stock. Anything a district did not report is marked as such.'}</p>
        <ul className="dgrid">
          {districts.map((d) => {
            const r = d.report;
            const stale = r && daysSince(r.reportDate) > 30;
            return (
              <li key={d.slug}>
                <Link to={`/district/${d.slug}`} className={`dtile ${r ? '' : 'dtile-empty'}`}>
                  <span className="dname">{d.name}</span>
                  {r ? (
                    <>
                      <span className="dnum">{r.counted ? r.totalVials.toLocaleString('en-IN') : '–'}<small> {!r.counted ? 'count not given' : r.counted === r.facilityCount ? 'vials' : 'vials counted'}</small></span>
                      <span className="dmeta">{r.ready} of {r.facilityCount} ready</span>
                      {r.unknownStock > 0 && <span className="dmeta">{r.unknownStock} not reported</span>}
                      <span className={`dmeta ${stale ? 'warn' : ''}`}>As on {fmtDate(r.reportDate)}{stale ? ` (${ago(r.reportDate)})` : ''}</span>
                    </>
                  ) : <span className="dmeta">No report yet</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="muted small">"Ready" means the facility has serum in stock, a trained doctor, and 24x7 service for snakebite cases. Facilities with missing information are never counted as ready.</p>
      </section>
    </>
  );
}
