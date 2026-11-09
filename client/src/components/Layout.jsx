import { NavLink, Outlet, Link } from 'react-router-dom';
import { useData } from '../data.jsx';

export default function Layout() {
  const { status, error, reload } = useData();
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="emergency" role="note">
        <strong>Snakebite is an emergency.</strong> Call <a href="tel:108">108</a>, keep the person calm and the bitten limb still, and go to the nearest hospital. Do not cut, suck or tie the bite.
      </div>
      <header className="top">
        <Link to="/" className="brand" aria-label="ASV Odisha home">
          <svg viewBox="0 0 20 34" width="16" height="27" aria-hidden="true">
            <rect x="5" y="1" width="10" height="5" rx="1.2" fill="currentColor" />
            <rect x="3" y="6" width="14" height="26" rx="4" fill="var(--amber)" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>ASV Odisha</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to="/find">Find nearby</NavLink>
          <Link to="/#districts">Districts</Link>
          <NavLink to="/admin" className="admin-link">Admin</NavLink>
        </nav>
      </header>
      <main id="main">
        {status === 'error' ? (
          <div className="page"><div className="notice notice-error">
            <p><strong>Could not load availability data.</strong> {error}</p>
            <button className="btn" onClick={reload}>Try again</button>
          </div></div>
        ) : status === 'loading' ? (
          <div className="page"><p className="muted" role="status">Loading availability…</p></div>
        ) : <Outlet />}
      </main>
      <footer className="foot">
        <p>Stock figures come from district reports submitted by each Collectorate and may have changed since. Where you can, phone the facility before you travel.</p>
      </footer>
    </>
  );
}
