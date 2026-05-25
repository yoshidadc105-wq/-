import React from 'react';

export default function SettingsPage({ onLogout }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20 }}>設定</h2>
      <div className="card" style={{ padding: 20 }}>
        <button onClick={onLogout} className="btn-danger" style={{ width: '100%' }}>
          ログアウト
        </button>
      </div>
    </div>
  );
}
