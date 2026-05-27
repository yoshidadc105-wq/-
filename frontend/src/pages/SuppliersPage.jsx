import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => api.getSuppliers().then(setSuppliers).catch(() => {});

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.addSupplier(newName.trim());
      setNewName('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await api.deleteSupplier(id);
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={() => navigate('/add')} style={{ background: 'none', color: '#2563eb', fontWeight: 600, padding: '4px 0', textAlign: 'left', fontSize: 15 }}>
        ← 戻る
      </button>
      <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>発注先の管理</h2>

      {/* 追加フォーム */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>新しく追加</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="例: ○○商事"
            style={{ flex: 1, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 15 }}
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="btn-primary"
            style={{ padding: '10px 20px', flexShrink: 0 }}
          >
            追加
          </button>
        </div>
        {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>

      {/* 一覧 */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>登録済み発注先</div>
        {suppliers.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>まだ登録されていません</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {suppliers.map((s, i) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0', borderBottom: i < suppliers.length - 1 ? '1px solid #f1f5f9' : 'none',
              }}>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{s.name}</span>
                <button
                  onClick={() => handleDelete(s.id, s.name)}
                  style={{ background: '#fee2e2', color: '#dc2626', padding: '5px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
