import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAdmin } from '../admin.jsx';

export default function AdminLogin() {
  const { user, login } = useAdmin();
  const nav = useNavigate();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/admin" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await login(f.username.trim(), f.password); nav('/admin'); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="page narrow">
      <h1 className="h1-sm">Admin sign in</h1>
      <p className="muted">For State and district officers who upload serum stock reports.</p>
      <form className="panel stack" onSubmit={submit}>
        <label className="field"><span>Username</span><input required autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
        <label className="field"><span>Password</span><input required type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {err && <p className="notice notice-error" role="alert">{err}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
