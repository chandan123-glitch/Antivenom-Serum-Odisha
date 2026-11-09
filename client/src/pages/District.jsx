import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../data.jsx';
import Stock from '../components/Stock.jsx';
import FacilityCard, { Tags } from '../components/FacilityCard.jsx';
import { ago, daysSince, download, fmtDate, isReady, mapsLink, stockLevel, stockRank, toCsv } from '../lib.js';

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  stock: (a, b) => stockRank(b) - stockRank(a),
  stockAsc: (a, b) => stockRank(a) - stockRank(b),
  recent: (a, b) => (b.lastAdmin || '').localeCompare(a.lastAdmin || ''),
};

const matchStock = (lvl, want) => (want === 'has' ? ['ok', 'low', 'yes'].includes(lvl) : lvl === want);

export default function District() {
  const { slug } = useParams();
  const { districts, facilities, low } = useData();
  const d = districts.find((x) => x.slug === slug);
  const all = useMemo(() => facilities.filter((f) => f.district === slug), [facilities, slug]);

  const [q, setQ] = useState('');
  const [block, setBlock] = useState('');
  const [type, setType] = useState('');
  const [stock, setStock] = useState('');
  const [onlyReady, setOnlyReady] = useState(false);
  const [sort, setSort] = useState('stock');

  if (!d) return <div className="page"><div className="empty"><h1>District not found</h1><p><Link to="/#districts">See all districts</Link></p></div></div>;

  if (!d.report) {
    return (
      <div className="page narrow">
        <h1>{d.name}</h1>
        <div className="empty">
          <h2>No report from {d.name} yet</h2>
          <p>The district has not submitted its serum stock. Try a neighbouring district, or <Link to="/find">search across the state</Link>.</p>
        </div>
      </div>
    );
  }

  const blocks = [...new Set(all.map((f) => f.block))].filter(Boolean).sort();
  const gaps = { serum: all.filter((f) => f.available == null && f.quantity == null).length, doctor: all.filter((f) => f.mo == null).length, hours: all.filter((f) => f.s24 == null).length };
  const anyGap = gaps.serum + gaps.doctor + gaps.hours > 0;
  const types = [...new Set(all.map((f) => f.type))].filter(Boolean).sort();
  const rows = all
    .filter((f) => (!block || f.block === block) && (!type || f.type === type) && (!stock || matchStock(stockLevel(f, low), stock)) && (!onlyReady || isReady(f)) &&
      (!q || `${f.name} ${f.block}`.toLowerCase().includes(q.toLowerCase())))
    .sort(SORTS[sort]);
  const r = d.report;
  const stale = daysSince(r.reportDate) > 30;
  const filtered = q || block || type || stock || onlyReady;

  return (
    <div className="page">
      <p className="crumb"><Link to="/#districts">All districts</Link></p>
      <header className="dhead">
        <div>
          <h1>{d.name}</h1>
          <p className={`muted ${stale ? 'warn' : ''}`}>
            Stock as on {fmtDate(r.reportDate)} ({ago(r.reportDate)}){r.letterNo ? ` · Collectorate letter ${r.letterNo}` : ''}
          </p>
          {stale && <p className="notice notice-warn">This report is over 30 days old. Stock may have changed.</p>}
          {anyGap && <p className="muted small">Not reported by the district: {[gaps.serum && `serum for ${gaps.serum}`, gaps.doctor && `doctor for ${gaps.doctor}`, gaps.hours && `working hours for ${gaps.hours}`].filter(Boolean).join(', ')} of {all.length} facilities.</p>}
        </div>
        <dl className="mini">
          <div><dt>{r.counted === r.facilityCount ? 'Vials' : 'Vials counted'}</dt><dd>{r.counted ? r.totalVials.toLocaleString('en-IN') : '–'}</dd></div>
          <div><dt>Facilities</dt><dd>{r.facilityCount}</dd></div>
          <div><dt>Ready</dt><dd>{r.ready}</dd></div>
          <div><dt>Out of stock</dt><dd className={r.outOfStock ? 'warn' : ''}>{r.outOfStock}</dd></div>
          {r.unknownStock > 0 && <div><dt>Not reported</dt><dd>{r.unknownStock}</dd></div>}
        </dl>
      </header>

      <div className="filters" role="search">
        <label><span>Search</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Facility or block" /></label>
        {blocks.length > 0 && <label><span>Block</span><select value={block} onChange={(e) => setBlock(e.target.value)}><option value="">All blocks</option>{blocks.map((b) => <option key={b}>{b}</option>)}</select></label>}
        {types.length > 0 && <label><span>Type</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{types.map((b) => <option key={b}>{b}</option>)}</select></label>}
        <label><span>Stock</span><select value={stock} onChange={(e) => setStock(e.target.value)}><option value="">Any</option><option value="has">Has serum</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="unknown">Not reported</option></select></label>
        <label><span>Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="stock">Most vials</option><option value="stockAsc">Fewest vials</option><option value="name">Name</option><option value="recent">Last given, newest</option></select></label>
        <label className="check"><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} />Ready only</label>
      </div>

      <div className="listbar">
        <p className="muted" aria-live="polite">{rows.length} of {all.length} facilities</p>
        <button className="btn btn-small" onClick={() => download(`asv-${slug}-${r.reportDate}.csv`, toCsv(rows))}>Download CSV</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty"><h2>No facilities match</h2><p>Change or clear the filters.</p>{filtered && <button className="btn" onClick={() => { setQ(''); setBlock(''); setType(''); setStock(''); setOnlyReady(false); }}>Clear filters</button>}</div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="ftable">
              <thead><tr><th>Facility</th>{blocks.length > 0 && <th>Block</th>}<th>Serum</th><th>Doctor and hours</th><th>Last given</th><th><span className="sr">Directions</span></th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className={isReady(f) ? 'is-ready' : ''}>
                    <td><strong>{f.name}</strong> {f.type && <span className="ftype">{f.type}</span>}{f.address && <div className="muted small addr">{f.address}</div>}</td>
                    {blocks.length > 0 && <td>{f.block}</td>}
                    <td><Stock f={f} low={low} /></td>
                    <td><Tags f={f} /></td>
                    <td>{f.lastAdmin ? fmtDate(f.lastAdmin) : <span className="muted">Not recorded</span>}</td>
                    <td>{f.lat != null && <a className="btn btn-small" href={mapsLink(f)} target="_blank" rel="noreferrer">Directions</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flist cards-only">
            {rows.map((f) => <FacilityCard key={f.id} f={f} low={low} showDistrict={false} />)}
          </ul>
        </>
      )}
    </div>
  );
}
