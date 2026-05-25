import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function AddMenuPage() {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20 }}>追加・取込</h2>
      <div className="card" onClick={() => navigate('/add/product')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, padding: 20 }}>
        <span style={{ fontSize: 36 }}>📷</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>商品を登録</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>写真を撮って商品を1件登録</div>
        </div>
        <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 20 }}>›</span>
      </div>
      <div className="card" onClick={() => navigate('/import')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, padding: 20 }}>
        <span style={{ fontSize: 36 }}>📋</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>CSVで一括取込</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>複数商品をまとめて登録</div>
        </div>
        <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 20 }}>›</span>
      </div>
    </div>
  );
}
