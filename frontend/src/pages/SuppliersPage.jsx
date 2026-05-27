import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => api.getSuppliers().then(setSuppliers).catch(e => setError(e.message));

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
      setError(e.message || 'エラーが発生しました');
      alert('追加エラー: ' + (e.message || 'エラーが発生しました'));
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
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="例: ○○商事"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          style={{
            marginTop: 8, width: '100%', padding: '12px', borderRadius: 8,
            background: adding || !newName.trim() ? '#94a3b8' : '#2563eb',
            color: 'white', fontWeight: 700, fontSize: 15, border: 'none', cursor: adding || !newName.trim() ? 'default' : 'pointer',
          }}
        >
          {adding ? '追加中...' : '追加'}
        </button>
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
