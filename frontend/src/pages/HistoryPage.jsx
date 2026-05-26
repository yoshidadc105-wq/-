import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function HistoryPage() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.getAllHistory().then(setHistory).finally(() => setLoading(false));
  }, []);

  const filtered = history.filter(h =>
    (filter === 'all' || h.type === filter) &&
    (!search || (h.product_name || '').includes(search))
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20 }}>履歴</h2>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍  商品名で検索"
        style={{ background: 'white' }}
      />

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[['all', 'すべて'], ['use', '✂️ 使用'], ['receive', '📥 入荷']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{
            flex: 1, padding: '8px 4px', borderRadius: 10, fontWeight: filter === val ? 700 : 400,
            background: filter === val ? '#2563eb' : '#f1f5f9',
            color: filter === val ? 'white' : '#475569',
            border: 'none', cursor: 'pointer', fontSize: 13,
          }}>{label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>記録がありません</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item, idx) => (
            <div key={idx} className="card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 20 }}>{item.type === 'receive' ? '📥' : '✂️'}</span>
                  <div>
                    <div
                      onClick={() => navigate(`/product/${item.product_id}`)}
                      style={{ fontWeight: 600, fontSize: 14, color: '#2563eb', cursor: 'pointer' }}>
                      {item.product_name}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      <span style={{ fontWeight: 700, color: item.type === 'receive' ? '#16a34a' : '#dc2626' }}>
                        {item.type === 'receive' ? `+${item.quantity}個` : `−${item.quantity}個`}
                      </span>
                      {item.display_name && <span style={{ color: '#64748b', marginLeft: 6 }}>{item.display_name}</span>}
                    </div>
                    {item.type === 'receive' && item.expiry_date && (
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>期限: {item.expiry_date}</div>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0, marginLeft: 8 }}>
                  {new Date(item.logged_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
