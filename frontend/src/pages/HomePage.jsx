import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.getProducts(), api.getLowStock()])
      .then(([all, low]) => { setProducts(all); setLowStock(low); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = products.filter(p =>
    p.name.includes(search) || (p.maker || '').includes(search)
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍  商品名・メーカーで検索"
        style={{ background: 'white' }}
      />

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
          {search ? '該当する商品がありません' : '商品が登録されていません'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(p => (
            <ProductCard key={p.id} product={p} onClick={() => navigate(`/product/${p.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, onClick }) {
  const isLow = product.stock <= product.alert_threshold;
  const isEmpty = product.stock === 0;

  return (
    <div
      className="card"
      onClick={onClick}
      style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'center' }}
    >
      {product.photo_path ? (
        <img
          src={product.photo_path}
          alt={product.name}
          style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 60, height: 60, background: '#f1f5f9', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, flexShrink: 0,
        }}>
          📦
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.name}
        </div>
        {product.maker && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{product.maker}</div>
        )}
        <div style={{ marginTop: 6 }}>
          {isEmpty
            ? <span className="badge-danger">在庫なし</span>
            : isLow
              ? <span className="badge-warning">残{product.stock}個</span>
              : <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>在庫: {product.stock}個</span>
          }
        </div>
      </div>

      <span style={{ color: '#94a3b8', fontSize: 20 }}>›</span>
    </div>
  );
}
