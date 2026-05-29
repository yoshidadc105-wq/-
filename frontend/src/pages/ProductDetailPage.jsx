import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

const PRESET_CATEGORIES = [
  'グローブ・マスク',
  '印象材・石膏',
  'セメント・接着材',
  '麻酔',
  '薬剤',
  '消耗品',
  '滅菌・清掃用品',
  'レントゲン',
  '器具・器材',
  '事務用品',
];

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [lots, setLots] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);

  // Lot form state
  const [lotExpiry, setLotExpiry] = useState('');
  const [lotQty, setLotQty] = useState(1);
  const [lotPackageLabel, setLotPackageLabel] = useState('');
  const [addingLot, setAddingLot] = useState(false);
  const [lotError, setLotError] = useState('');

  useEffect(() => {
    Promise.all([api.getProduct(id), api.getLots(id), api.getHistory(id)])
      .then(([p, l, h]) => { setProduct(p); setLots(l); setHistory(h); })
      .finally(() => setLoading(false));
    api.getProducts().then(ps => {
      const custom = ps.map(p => p.category).filter(Boolean);
      const all = [...new Set([...PRESET_CATEGORIES, ...custom])];
      setCategories(all);
    });
  }, [id]);

  const startEdit = () => {
    setEditForm({
      name: product.name || '',
      maker: product.maker || '',
      item_code: product.item_code || '',
      category: product.category || '',
      unit: product.unit || '',
      alert_threshold: product.alert_threshold || 5,
      supplier_url: product.supplier_url || '',
      default_supplier: product.default_supplier || '',
      default_price: product.default_price || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(editForm).forEach(([k, v]) => fd.append(k, v));
      await api.updateProduct(id, fd);
      const updated = await api.getProduct(id);
      setProduct(updated);
      setEditing(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };


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

  const handleAddLot = async () => {
    if (lotQty <= 0) return setLotError('数量を正しく入力してください');
    setLotError('');
    setAddingLot(true);
    try {
      await api.addLot(id, { expiry_date: lotExpiry || null, quantity: lotQty, package_label: lotPackageLabel || null });
      const [updatedLots, updatedProduct] = await Promise.all([api.getLots(id), api.getProduct(id)]);
      setLots(updatedLots);
      setProduct(updatedProduct);
      setLotExpiry('');
      setLotQty(1);
      setLotPackageLabel('');
    } catch (e) {
      setLotError(e.message);
    } finally {
      setAddingLot(false);
    }
  };

  const handleDeleteLot = async (lotId) => {
    if (!confirm('このロットを削除しますか？在庫数も減らされます。')) return;
    try {
      await api.deleteLot(lotId);
      const [updatedLots, updatedProduct] = await Promise.all([api.getLots(id), api.getProduct(id)]);
      setLots(updatedLots);
      setProduct(updatedProduct);
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;
  if (!product) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>商品が見つかりません</div>;

  const realStock = lots.length > 0
    ? lots.reduce((s, l) => s + l.quantity, 0)
    : product.stock;
  const isLow = realStock <= product.alert_threshold;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={() => navigate('/')} style={{ background: 'none', color: '#2563eb', fontWeight: 600, padding: '4px 0', textAlign: 'left', fontSize: 15 }}>
        ← 戻る
      </button>

      <div className="card">
        {product.photo_path && (
          <img src={product.photo_path} alt={product.name}
            style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, marginBottom: 14 }} />
        )}

        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: '商品名 *', key: 'name', type: 'text' },
              { label: 'メーカー', key: 'maker', type: 'text' },
              { label: '品番', key: 'item_code', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input type={f.type} value={editForm[f.key]} onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>カテゴリ</label>
              <select value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 15, background: 'white' }}>
                <option value="">（なし）</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                {editForm.category && !categories.includes(editForm.category) && (
                  <option value={editForm.category}>{editForm.category}</option>
                )}
              </select>
              <input type="text" value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                placeholder="新しいカテゴリを入力" style={{ marginTop: 6 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>単位</label>
                <select value={editForm.unit} onChange={e => setEditForm(p => ({ ...p, unit: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 15, background: 'white' }}>
                  <option value="">個</option>
                  {['箱','袋','本','枚','セット','巻'].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>アラート閾値</label>
                <input type="number" value={editForm.alert_threshold} onChange={e => setEditForm(p => ({ ...p, alert_threshold: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>発注先URL</label>
              <textarea value={editForm.supplier_url} onChange={e => setEditForm(p => ({ ...p, supplier_url: e.target.value }))}
                rows={2} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setEditing(false)}
                style={{ flex: 1, padding: 12, borderRadius: 8, background: '#f1f5f9', color: '#475569', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                キャンセル
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: 12, borderRadius: 8, background: '#2563eb', color: 'white', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: 20, fontWeight: 700 }}>{product.name}</h1>
                {product.maker && <p style={{ color: '#64748b', marginTop: 4 }}>{product.maker}</p>}
                {product.item_code && <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>品番: {product.item_code}</p>}
              </div>
              <button onClick={startEdit}
                style={{ background: '#f1f5f9', color: '#475569', padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0, marginLeft: 8 }}>
                ✏️ 編集
              </button>
            </div>
            {product.supplier_url && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {product.supplier_url.split('\n').map(url => url.trim()).filter(Boolean).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#eff6ff', color: '#2563eb', padding: '6px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    🛒 発注先{product.supplier_url.split('\n').filter(u => u.trim()).length > 1 ? ` ${i + 1}` : ''}を開く
                  </a>
                ))}
              </div>
            )}
            {product.category && (
              <div style={{ marginTop: 8 }}>
                <span style={{ display: 'inline-block', background: '#ede9fe', color: '#6d28d9', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10 }}>
                  {product.category}
                </span>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 16, padding: '14px 0', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748b' }}>現在の在庫</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: realStock === 0 ? '#dc2626' : isLow ? '#f59e0b' : '#16a34a' }}>
            {realStock}{product.unit || '個'}
          </span>
        </div>

        <div style={{ padding: '10px 0', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748b', fontSize: 14 }}>アラート閾値</span>
          <span style={{ fontWeight: 600 }}>{product.alert_threshold}個以下で警告</span>
        </div>
      </div>

      {/* ロット管理 */}
      <div className="card">
        <h3 style={{ fontWeight: 700, marginBottom: 12 }}>ロット管理</h3>

        {lots.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: '#64748b', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>パッケージ</th>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: '#64748b', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>使用期限</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: '#64748b', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>数量</th>
                <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid #e2e8f0' }}></th>
              </tr>
            </thead>
            <tbody>
              {lots.map(lot => (
                <tr key={lot.id}>
                  <td style={{ padding: '8px 6px', borderBottom: '1px solid #f1f5f9' }}>
                    {lot.package_label || <span style={{ color: '#94a3b8' }}>未設定</span>}
                  </td>
                  <td style={{ padding: '8px 6px', borderBottom: '1px solid #f1f5f9' }}>
                    {lot.expiry_date || <span style={{ color: '#94a3b8' }}>未設定</span>}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>{lot.quantity}個</td>
                  <td style={{ padding: '8px 6px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                    <button
                      onClick={() => handleDeleteLot(lot.id)}
                      style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>ロットが登録されていません</p>
        )}

        {/* Add lot form */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: '#475569' }}>新しいロットを追加</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>パッケージ</label>
              <input
                type="text"
                value={lotPackageLabel}
                onChange={e => setLotPackageLabel(e.target.value)}
                placeholder="例: 100枚入り"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>使用期限 (YYYY-MM)</label>
              <input
                type="text"
                value={lotExpiry}
                onChange={e => setLotExpiry(e.target.value)}
                placeholder="例: 2025-12"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 }}
              />
            </div>
            <div style={{ minWidth: 120 }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>数量</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setLotQty(q => Math.max(1, q - 1))}
                  style={{ width: 34, height: 34, borderRadius: 6, background: '#e2e8f0', fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >−</button>
                <input
                  type="number"
                  min="1"
                  value={lotQty}
                  onChange={e => setLotQty(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: 64, textAlign: 'center', fontSize: 18, fontWeight: 700, padding: '6px 4px', border: '1px solid #e2e8f0', borderRadius: 6 }}
                />
                <button
                  onClick={() => setLotQty(q => q + 1)}
                  style={{ width: 34, height: 34, borderRadius: 6, background: '#2563eb', color: 'white', fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >＋</button>
              </div>
            </div>
          </div>
          {lotError && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: 10, borderRadius: 8, fontSize: 13, marginTop: 8 }}>{lotError}</div>
          )}
          <button
            onClick={handleAddLot}
            disabled={addingLot}
            className="btn-primary"
            style={{ marginTop: 12, width: '100%' }}
          >
            {addingLot ? '追加中...' : '追加'}
          </button>
        </div>
      </div>

      {/* 統合履歴 */}
      <div className="card">
        <h3 style={{ fontWeight: 700, marginBottom: 12 }}>履歴</h3>
        {history.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>記録はありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{item.type === 'receive' ? '📥' : '✂️'}</span>
                  <div>
                    <span style={{ fontWeight: 600, color: item.type === 'receive' ? '#16a34a' : '#dc2626' }}>
                      {item.type === 'receive' ? `+${item.quantity}個` : `−${item.quantity}個`}
                    </span>
                    {item.display_name && (
                      <span style={{ fontSize: 12, color: '#64748b', marginLeft: 6 }}>{item.display_name}</span>
                    )}
                    {item.type === 'receive' && item.expiry_date && (
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>期限: {item.expiry_date}</div>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>
                  {new Date(item.logged_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
