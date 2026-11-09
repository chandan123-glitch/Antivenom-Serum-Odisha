import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAdmin = () => useContext(Ctx);

export function AdminProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const check = useCallback(() => api('/auth/me').then((u) => setUser(u.username), () => setUser(null)), []);
  useEffect(() => {
    // Only ask the server about a session when an admin page is opened
    if (window.location.pathname.startsWith('/admin')) check(); else setUser(null);
  }, [check]);
  const login = async (username, password) => { const u = await api('/auth/login', { method: 'POST', json: { username, password } }); setUser(u.username); };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); };
  return <Ctx.Provider value={{ user, login, logout, expire: () => setUser(null) }}>{children}</Ctx.Provider>;
}

export function AdminShell() {
  const { user, logout } = useAdmin();
  const nav = useNavigate();
  if (user === undefined) return <div className="page"><p className="muted" role="status">Checking sign-in…</p></div>;
  if (user === null) return <Navigate to="/admin/login" replace />;
  return (
    <div className="page">
      <div className="adminbar">
        <h1 className="h1-sm">Admin</h1>
        <nav aria-label="Admin" className="subnav">
          <NavLink to="/admin" end>Overview</NavLink>
          <NavLink to="/admin/upload">Upload report</NavLink>
          <NavLink to="/admin/history">History</NavLink>
          <NavLink to="/admin/account">Account</NavLink>
        </nav>
        <span className="who">{user} <button className="linkbtn" onClick={async () => { await logout(); nav('/admin/login'); }}>Sign out</button></span>
      </div>
      <Outlet />
    </div>
  );
}
