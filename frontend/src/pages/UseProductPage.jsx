import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function UseProductPage() {
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getProducts().then(setProducts).finally(() => setLoading(false));
  }, []);

  const filtered = products.filter(p =>
    p.name.includes(search) || (p.maker || '').includes(search)
  );

  const handleSubmit = async () => {
    if (!selected) return;
    setError('');
    setSubmitting(true);
    try {
      await api.useProduct(selected.id, quantity);
      setSuccess(true);
      setSelected(null);
      setQuantity(1);
      setSearch('');
      const updated = await api.getProducts();
      setProducts(updated);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20 }}>使用を記録</h2>

      {success && (
        <div style={{ background: '#dcfce7', color: '#16a34a', padding: 14, borderRadius: 10, fontWeight: 600, textAlign: 'center' }}>
          ✅ 記録しました！
        </div>
      )}

      {/* 商品選択 */}
      {!selected ? (
        <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍  商品名で検索"
            style={{ background: 'white' }}
            autoFocus
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(p => (
              <div
                key={p.id}
                className="card"
                onClick={() => { setSelected(p); setQuantity(1); setError(''); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
              >
                {p.photo_path ? (
                  <img src={p.photo_path} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 8 }} />
                ) : (
                  <div style={{ width: 50, height: 50, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>📦</div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  {p.maker && <div style={{ fontSize: 12, color: '#64748b' }}>{p.maker}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 13, color: p.stock === 0 ? '#dc2626' : p.stock <= p.alert_threshold ? '#f59e0b' : '#16a34a', fontWeight: 600 }}>
                    {p.stock}個
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* 数量入力 */
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {selected.photo_path ? (
              <img src={selected.photo_path} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
            ) : (
              <div style={{ width: 64, height: 64, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>📦</div>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>現在の在庫: {selected.stock}個</div>
            </div>
          </div>

          <div>
            <div style={{ textAlign: 'center', marginBottom: 12, fontWeight: 600, color: '#64748b' }}>使用数</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: '#e2e8f0', fontSize: 28, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >−</button>
              <span style={{ fontSize: 48, fontWeight: 700, minWidth: 80, textAlign: 'center' }}>{quantity}</span>
              <button
                onClick={() => setQuantity(q => Math.min(selected.stock, q + 1))}
                style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: '#2563eb', color: 'white', fontSize: 28, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >＋</button>
            </div>
          </div>

          {error && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: 12, borderRadius: 8, fontSize: 14 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={() => setSelected(null)} style={{ flex: 1 }}>
              戻る
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{ flex: 2, background: '#2563eb', color: 'white', padding: 14, borderRadius: 8, fontWeight: 700, fontSize: 16 }}
            >
              {submitting ? '記録中...' : '✓ 使用を記録'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
