import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { DataProvider } from './data.jsx';
import { AdminProvider, AdminShell } from './admin.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Find from './pages/Find.jsx';
import District from './pages/District.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminOverview from './pages/AdminOverview.jsx';
import AdminUpload from './pages/AdminUpload.jsx';
import AdminHistory from './pages/AdminHistory.jsx';
import AdminAccount from './pages/AdminAccount.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <DataProvider>
        <AdminProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="find" element={<Find />} />
              <Route path="district/:slug" element={<District />} />
              <Route path="admin/login" element={<AdminLogin />} />
              <Route path="admin" element={<AdminShell />}>
                <Route index element={<AdminOverview />} />
                <Route path="upload" element={<AdminUpload />} />
                <Route path="history" element={<AdminHistory />} />
                <Route path="account" element={<AdminAccount />} />
              </Route>
              <Route path="*" element={<div className="page"><div className="empty"><h1>Page not found</h1></div></div>} />
            </Route>
          </Routes>
        </AdminProvider>
      </DataProvider>
    </BrowserRouter>
  );
}
