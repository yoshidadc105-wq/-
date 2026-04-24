import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', label: '在庫', icon: '📦' },
  { path: '/use', label: '使用', icon: '✂️' },
  { path: '/receive', label: '入荷', icon: '📥' },
  { path: '/add', label: '商品追加', icon: '➕' },
];

export default function Layout({ children, user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header style={{
        background: '#2563eb',
        color: 'white',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>🦷 歯科在庫管理</div>
        <button
          onClick={onLogout}
          style={{
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            padding: '6px 12px',
            fontSize: 14,
            borderRadius: 6,
          }}
        >
          ログアウト
        </button>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: '16px', maxWidth: 600, width: '100%', margin: '0 auto' }}>
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav style={{
        background: 'white',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        position: 'sticky',
        bottom: 0,
        zIndex: 100,
      }}>
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                flex: 1,
                background: 'none',
                padding: '10px 4px',
                borderRadius: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                color: active ? '#2563eb' : '#64748b',
                fontWeight: active ? 700 : 400,
                fontSize: 11,
                borderTop: active ? '2px solid #2563eb' : '2px solid transparent',
              }}
            >
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
