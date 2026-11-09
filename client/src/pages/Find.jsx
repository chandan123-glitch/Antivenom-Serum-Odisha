import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../data.jsx';
import FacilityCard from '../components/FacilityCard.jsx';
import { distanceKm, isReady, stockRank } from '../lib.js';

export default function Find() {
  const { facilities, districts, low } = useData();
  const [params] = useSearchParams();
  const [pos, setPos] = useState(null);
  const [geo, setGeo] = useState({ busy: false, error: null });
  const [district, setDistrict] = useState('');
  const [readyOnly, setReadyOnly] = useState(true);
  const [limit, setLimit] = useState(10);

  function locate() {
    if (!navigator.geolocation) return setGeo({ busy: false, error: 'This browser cannot share your location. Choose a district instead.' });
    setGeo({ busy: true, error: null });
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeo({ busy: false, error: null }); },
      (e) => setGeo({ busy: false, error: e.code === 1 ? 'Location access was blocked. Allow it in your browser settings, or choose a district.' : 'Could not get your location. Choose a district instead.' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }
  useEffect(() => { if (params.get('locate')) locate(); }, []); // eslint-disable-line

  const results = useMemo(() => {
    let list = facilities.filter((f) => (!district || f.district === district) && (!readyOnly || isReady(f)));
    if (pos) {
      list = list.filter((f) => f.lat != null)
        .map((f) => ({ f, km: distanceKm(pos, f) }))
        .sort((a, b) => a.km - b.km);
    } else {
      list = list.map((f) => ({ f, km: null })).sort((a, b) => stockRank(b.f) - stockRank(a.f));
    }
    return list;
  }, [facilities, pos, district, readyOnly]);

  return (
    <div className="page narrow">
      <h1 className="h1-sm">Find serum near you</h1>
      <div className="panel">
        <div className="row">
          <button className="btn btn-primary" onClick={locate} disabled={geo.busy}>
            {geo.busy ? 'Finding you…' : pos ? 'Update my location' : 'Use my location'}
          </button>
          <label className="select-wrap">
            <span className="sr">District</span>
            <select value={district} onChange={(e) => { setDistrict(e.target.value); setLimit(10); }}>
              <option value="">All reporting districts</option>
              {districts.filter((d) => d.report).map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} />
            Only facilities with serum, a trained doctor and 24x7 service
          </label>
        </div>
        {geo.error && <p className="notice notice-error" role="alert">{geo.error}</p>}
        {pos && <p className="muted small">Sorted by distance in a straight line from you. Road distance will be longer.</p>}
        {!pos && <p className="muted small">Share your location to sort by distance. Without it, facilities are listed by stock.</p>}
      </div>

      {results.length === 0 ? (
        <div className="empty">
          <h2>No matching facilities</h2>
          <p>{facilities.length === 0 ? 'No district has submitted a report yet.' : 'Turn off the filter above to see every facility, including those that did not report a doctor or 24x7 service.'}</p>
        </div>
      ) : (
        <>
          <p className="muted" aria-live="polite">{results.length} facilit{results.length === 1 ? 'y' : 'ies'}</p>
          <ul className="flist">
            {results.slice(0, limit).map(({ f, km }) => <FacilityCard key={f.id} f={f} km={km} low={low} />)}
          </ul>
          {results.length > limit && <button className="btn" onClick={() => setLimit(limit + 10)}>Show 10 more</button>}
        </>
      )}
    </div>
  );
}
