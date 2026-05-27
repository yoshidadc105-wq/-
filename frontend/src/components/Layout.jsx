import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', label: '在庫', icon: '📦' },
  { path: '/history', label: '履歴', icon: '📋' },
  { path: '/add', label: '追加', icon: '➕' },
  { path: '/stats', label: '統計', icon: '📊' },
];

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header style={{
        background: '#2563eb', color: 'white', padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>🦷 歯科在庫管理</div>
      </header>

      <main style={{ flex: 1, padding: '16px', maxWidth: 600, width: '100%', margin: '0 auto', paddingBottom: 80 }}>
        {children}
      </main>

      <nav style={{ background: 'white', borderTop: '1px solid #e2e8f0', display: 'flex', position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}>
        {navItems.map(item => {
          const active = location.pathname === item.path || (item.path === '/add' && location.pathname.startsWith('/add'));
          return (
            <button key={item.path} onClick={() => navigate(item.path)} style={{
              flex: 1, background: 'none', padding: '10px 4px', borderRadius: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              color: active ? '#2563eb' : '#64748b',
              fontWeight: active ? 700 : 400, fontSize: 11,
              borderTop: active ? '2px solid #2563eb' : '2px solid transparent',
              border: 'none', cursor: 'pointer',
            }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
