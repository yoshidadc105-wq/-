import React from 'react';
import { useNavigate } from 'react-router-dom';

const items = [
  { path: '/add/product', icon: '📷', title: '商品を登録', desc: '写真を撮って商品を1件登録' },
  { path: '/import',      icon: '📋', title: 'CSVで一括取込', desc: '複数商品をまとめて登録' },
  { path: '/suppliers',   icon: '🏪', title: '発注先の管理', desc: '発注先を追加・削除' },
];

export default function AddMenuPage() {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20 }}>追加・設定</h2>
      {items.map(item => (
        <div key={item.path} className="card" onClick={() => navigate(item.path)}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, padding: 20 }}>
          <span style={{ fontSize: 36 }}>{item.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{item.title}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{item.desc}</div>
          </div>
          <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 20 }}>›</span>
        </div>
      ))}
    </div>
  );
}
