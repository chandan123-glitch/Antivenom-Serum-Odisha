import Stock from './Stock.jsx';
import { fmtDate, isReady, mapsLink } from '../lib.js';

export function Tags({ f }) {
  const doc = f.mo == null ? ['tag-unk', 'Doctor not reported'] : f.mo ? ['tag-yes', 'Trained doctor'] : ['tag-no', 'No trained doctor'];
  const hrs = f.s24 == null ? ['tag-unk', 'Hours not reported'] : f.s24 ? ['tag-yes', '24x7'] : ['tag-no', f.hours ? `Hours: ${f.hours}` : 'Not 24x7'];
  return (
    <span className="tags">
      <span className={`tag ${doc[0]}`}>{doc[1]}</span>
      <span className={`tag ${hrs[0]}`}>{hrs[1]}</span>
    </span>
  );
}

export default function FacilityCard({ f, low, km, showDistrict = true }) {
  const ready = isReady(f);
  const where = [f.block ? `${f.block} block` : '', showDistrict ? f.districtName : ''].filter(Boolean).join(', ');
  return (
    <li className={`fcard ${ready ? 'is-ready' : ''}`}>
      <Stock f={f} low={low} />
      <div className="fcard-main">
        <h3>{f.name} {f.type && <span className="ftype">{f.type}</span>}</h3>
        {where && <p className="muted">{where}</p>}
        {f.address && <p className="muted small">{f.address}</p>}
        <Tags f={f} />
        {ready && <p className="ready-note">Has serum, a trained doctor and 24x7 service</p>}
        <p className="muted small">Serum last given {f.lastAdmin ? fmtDate(f.lastAdmin) : 'not recorded'} · stock as on {fmtDate(f.asOn)}</p>
      </div>
      <div className="fcard-side">
        {km != null && <strong className="dist">{km < 10 ? km.toFixed(1) : Math.round(km)} km</strong>}
        {f.lat != null && <a className="btn btn-small" href={mapsLink(f)} target="_blank" rel="noreferrer">Directions</a>}
      </div>
    </li>
  );
}
