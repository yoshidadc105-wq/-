import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('すべて');
  const [sheet, setSheet] = useState(null); // { product, mode: 'use'|'receive' }
  const [quantity, setQuantity] = useState(1);
  const [expiryDate, setExpiryDate] = useState('');
  const [packageLabel, setPackageLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flashMessage, setFlashMessage] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    return Promise.all([api.getProducts(), api.getLowStock(), api.getExpiring()])
      .then(([all, low, exp]) => { setProducts(all); setLowStock(low); setExpiring(exp); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = ['すべて', ...Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort()];

  const filtered = products.filter(p => {
    const matchSearch = p.name.includes(search) || (p.maker || '').includes(search);
    const matchCategory = selectedCategory === 'すべて' || p.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  const openSheet = (product, mode) => {
    setSheet({ product, mode });
    setQuantity(1);
    setExpiryDate('');
    setPackageLabel('');
  };

  const closeSheet = () => setSheet(null);

  const handleSubmit = async () => {
    if (!sheet) return;
    setSubmitting(true);
    try {
      if (sheet.mode === 'use') {
        await api.useProduct(sheet.product.id, quantity, null);
        setFlashMessage(`✅ ${sheet.product.name} を ${quantity}個 使用しました`);
      } else {
        await api.receiveProduct(sheet.product.id, quantity, null, expiryDate || undefined, packageLabel || undefined);
        setFlashMessage(`✅ ${sheet.product.name} を ${quantity}個 入荷しました`);
      }
      closeSheet();
      await load();
      setTimeout(() => setFlashMessage(''), 2500);
    } catch (e) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {flashMessage && (
        <div style={{ background: '#dcfce7', color: '#16a34a', padding: 12, borderRadius: 10, fontWeight: 600, textAlign: 'center', fontSize: 14 }}>
          {flashMessage}
        </div>
      )}

      {lowStock.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8 }}>⚠️ 在庫不足 ({lowStock.length}件)</div>
          {lowStock.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
              <span>{p.name}</span>
              <span className="badge-danger">残{p.stock}個</span>
            </div>
          ))}
        </div>
      )}

      {expiring.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: 8 }}>🗓️ 期限切れ間近 ({expiring.length}件)</div>
          {expiring.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
              <span>{p.name}</span>
              <span style={{ color: '#ea580c', fontWeight: 600 }}>{p.expiry_date}</span>
            </div>
          ))}
        </div>
      )}

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍  商品名・メーカーで検索"
        style={{ background: 'white' }}
      />

      {categories.length > 1 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)} style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 13,
              fontWeight: selectedCategory === cat ? 700 : 400,
              background: selectedCategory === cat ? '#2563eb' : '#f1f5f9',
              color: selectedCategory === cat ? 'white' : '#475569',
              border: 'none', cursor: 'pointer',
            }}>
              {cat}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
          {search || selectedCategory !== 'すべて' ? '該当する商品がありません' : '商品が登録されていません'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(p => (
            <ProductCard key={p.id} product={p}
              onUse={() => openSheet(p, 'use')}
              onReceive={() => openSheet(p, 'receive')}
              onDetail={() => navigate(`/product/${p.id}`)}
            />
          ))}
        </div>
      )}

      {/* Bottom sheet overlay */}
      {sheet && (
        <>
          <div onClick={closeSheet} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
          }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white',
            borderRadius: '20px 20px 0 0', padding: '20px 20px 40px',
            zIndex: 201, maxWidth: 600, margin: '0 auto',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{sheet.product.name}</div>
              <button onClick={closeSheet} style={{ background: '#f1f5f9', borderRadius: '50%', width: 32, height: 32, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {['use', 'receive'].map(mode => (
                <button key={mode} onClick={() => { setSheet(s => ({ ...s, mode })); setQuantity(1); setExpiryDate(''); }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 10, fontWeight: 700, fontSize: 15,
                    background: sheet.mode === mode ? (mode === 'use' ? '#dc2626' : '#16a34a') : '#f1f5f9',
                    color: sheet.mode === mode ? 'white' : '#64748b',
                    border: 'none', cursor: 'pointer',
                  }}>
                  {mode === 'use' ? '✂️ 使用' : '📥 入荷'}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 12, textAlign: 'center' }}>
              現在の在庫: <strong style={{ color: '#1e293b' }}>{sheet.product.stock}{sheet.product.unit || '個'}</strong>
            </div>

            {/* Quantity */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 20 }}>
              <button onClick={() => setQuantity(q => Math.max(1, q - 1))} style={{
                width: 52, height: 52, borderRadius: '50%', background: '#e2e8f0',
                fontSize: 28, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>−</button>
              <span style={{ fontSize: 44, fontWeight: 700, minWidth: 72, textAlign: 'center' }}>{quantity}</span>
              <button onClick={() => setQuantity(q => q + 1)} style={{
                width: 52, height: 52, borderRadius: '50%',
                background: sheet.mode === 'use' ? '#dc2626' : '#16a34a',
                color: 'white', fontSize: 28, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>＋</button>
            </div>

            {/* Package label and expiry date for receive */}
            {sheet.mode === 'receive' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: '#64748b', display: 'block', marginBottom: 6 }}>パッケージ（任意・例: 100枚入り）</label>
                  <input type="text" value={packageLabel} onChange={e => setPackageLabel(e.target.value)}
                    placeholder="例: 100枚入り、200枚入り"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: '#64748b', display: 'block', marginBottom: 6 }}>使用期限（任意・YYYY-MM）</label>
                  <input type="text" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                    placeholder="例: 2025-12"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' }}
                  />
                </div>
              </>
            )}

            <button onClick={handleSubmit} disabled={submitting} style={{
              width: '100%', padding: 16, borderRadius: 12, fontWeight: 700, fontSize: 16,
              background: sheet.mode === 'use' ? '#dc2626' : '#16a34a',
              color: 'white', border: 'none', cursor: 'pointer',
            }}>
              {submitting ? '記録中...' : sheet.mode === 'use' ? `${quantity}個 使用を記録` : `${quantity}個 入荷を記録`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProductCard({ product, onUse, onReceive, onDetail }) {
  const isLow = product.stock <= product.alert_threshold;
  const isEmpty = product.stock === 0;

  return (
    <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div onClick={onDetail} style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, cursor: 'pointer', minWidth: 0 }}>
        {product.photo_path ? (
          <img src={product.photo_path} alt={product.name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
        ) : (
          <div style={{ width: 56, height: 56, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>📦</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</div>
          {product.maker && <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{product.maker}</div>}
          {product.category && (
            <span style={{ display: 'inline-block', background: '#ede9fe', color: '#6d28d9', fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10, marginTop: 3 }}>{product.category}</span>
          )}
          <div style={{ marginTop: 4 }}>
            {isEmpty ? <span className="badge-danger">在庫なし</span>
              : isLow ? <span className="badge-warning">残{product.stock}{product.unit || '個'}</span>
              : <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>在庫: {product.stock}{product.unit || '個'}</span>}
          </div>
        </div>
      </div>
      {/* Quick action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <button onClick={onUse} style={{ padding: '6px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>使用</button>
        <button onClick={onReceive} style={{ padding: '6px 12px', borderRadius: 8, background: '#dcfce7', color: '#16a34a', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>入荷</button>
      </div>
    </div>
  );
}
