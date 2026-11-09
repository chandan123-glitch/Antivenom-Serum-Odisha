import { useState } from 'react';
import { api } from '../api.js';

export default function AdminAccount() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try { await api('/auth/change-password', { method: 'POST', json: f }); setMsg({ ok: true, text: 'Password changed.' }); setF({ currentPassword: '', newPassword: '' }); }
    catch (x) { setMsg({ ok: false, text: x.message }); }
  }
  return (
    <form className="panel stack narrow-form" onSubmit={submit}>
      <h2>Change password</h2>
      <label className="field"><span>Current password</span><input required type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></label>
      <label className="field"><span>New password (10 or more characters)</span><input required minLength="10" type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></label>
      {msg && <p className={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`} role="status">{msg.text}</p>}
      <button className="btn btn-primary">Change password</button>
    </form>
  );
}
