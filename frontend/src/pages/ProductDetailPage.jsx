import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([api.getProduct(id), api.getUsageLogs(id)])
      .then(([p, l]) => { setProduct(p); setLogs(l); })
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!confirm(`「${product.name}」を削除しますか？`)) return;
    setDeleting(true);
    try {
      await api.deleteProduct(id);
      navigate('/');
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;
  if (!product) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>商品が見つかりません</div>;

  const isLow = product.stock <= product.alert_threshold;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={() => navigate('/')} style={{ background: 'none', color: '#2563eb', fontWeight: 600, padding: '4px 0', textAlign: 'left', fontSize: 15 }}>
        ← 戻る
      </button>

      <div className="card">
        {product.photo_path && (
          <img
            src={product.photo_path}
            alt={product.name}
            style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, marginBottom: 14 }}
          />
        )}

        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{product.name}</h1>
        {product.maker && <p style={{ color: '#64748b', marginTop: 4 }}>{product.maker}</p>}
        {product.item_code && <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>品番: {product.item_code}</p>}

        <div style={{ marginTop: 16, padding: '14px 0', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748b' }}>現在の在庫</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: product.stock === 0 ? '#dc2626' : isLow ? '#f59e0b' : '#16a34a' }}>
            {product.stock}個
          </span>
        </div>

        <div style={{ padding: '10px 0', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748b', fontSize: 14 }}>アラート閾値</span>
          <span style={{ fontWeight: 600 }}>{product.alert_threshold}個以下で警告</span>
        </div>
      </div>

      {/* 使用履歴 */}
      <div className="card">
        <h3 style={{ fontWeight: 700, marginBottom: 12 }}>使用履歴</h3>
        {logs.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>使用記録はありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {logs.map(log => (
              <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div>
                  <span style={{ fontWeight: 600, color: '#dc2626' }}>−{log.quantity}個</span>
                  {log.display_name && <span style={{ fontSize: 13, color: '#64748b', marginLeft: 8 }}>{log.display_name}</span>}
                </div>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {new Date(log.logged_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ width: '100%' }}>
        {deleting ? '削除中...' : '🗑️ この商品を削除'}
      </button>
    </div>
  );
}
