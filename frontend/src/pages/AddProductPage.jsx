import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function AddProductPage() {
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPath, setPhotoPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [rawText, setRawText] = useState('');
  const [form, setForm] = useState({ name: '', maker: '', item_code: '', stock: '0', alert_threshold: '5' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileRef = useRef();
  const navigate = useNavigate();

  const resizeImage = (file, maxSize = 1024) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
    };
    img.src = URL.createObjectURL(file);
  });

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setPhotoFile(file);
    setPhoto(URL.createObjectURL(file));
    setScanning(true);
    setError('');

    try {
      const base64 = await resizeImage(file);
      const result = await api.scanProduct({ base64, filename: file.name });
      setForm(prev => ({
        ...prev,
        name: result.name || prev.name,
        maker: result.maker || prev.maker,
        item_code: result.item_code || prev.item_code,
      }));
      setPhotoPath(result.photo_path || '');
      setRawText(result.raw_text || '');
    } catch (e) {
      setError('OCR読み取りに失敗しました。手動で入力してください。');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name) return setError('商品名を入力してください');
    setLoading(true);
    setError('');

    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (photoPath) fd.append('photo_path', photoPath);

      await api.createProduct(fd);
      setSuccess(true);
      setTimeout(() => navigate('/'), 1200);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 60 }}>✅</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginTop: 12 }}>登録しました！</div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 20 }}>商品を追加</h2>

      {/* 写真エリア */}
      <div
        onClick={() => fileRef.current.click()}
        style={{
          border: '2px dashed #94a3b8',
          borderRadius: 12,
          padding: 20,
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: 20,
          background: photo ? 'transparent' : '#f8fafc',
          position: 'relative',
          minHeight: 140,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {photo ? (
          <img src={photo} alt="商品" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 8 }} />
        ) : (
          <div style={{ color: '#64748b' }}>
            <div style={{ fontSize: 40 }}>📷</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>商品の写真を撮る</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>タップして撮影・選択</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>自動でテキストを読み取ります</div>
          </div>
        )}

        {scanning && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            borderRadius: 12, gap: 10,
          }}>
            <div className="spinner" />
            <div style={{ fontWeight: 600, color: '#2563eb' }}>AIが読み取り中...</div>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        style={{ display: 'none' }}
      />

      {photo && (
        <button
          onClick={() => fileRef.current.click()}
          className="btn-secondary"
          style={{ marginBottom: 16 }}
        >
          📷 写真を撮り直す
        </button>
      )}

      {rawText && (
        <div style={{ background: '#f1f5f9', borderRadius: 8, padding: 10, marginBottom: 4, fontSize: 12, color: '#64748b' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📄 読み取ったテキスト（参考）</div>
          <div>{rawText}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="商品名 *" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="例: グラスアイオノマーセメント" />
        <Field label="メーカー" value={form.maker} onChange={v => setForm(p => ({ ...p, maker: v }))} placeholder="例: GC" />
        <Field label="品番" value={form.item_code} onChange={v => setForm(p => ({ ...p, item_code: v }))} placeholder="例: ABC-1234" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="現在の在庫数" value={form.stock} onChange={v => setForm(p => ({ ...p, stock: v }))} type="number" min="0" />
          <Field label="アラート閾値" value={form.alert_threshold} onChange={v => setForm(p => ({ ...p, alert_threshold: v }))} type="number" min="0" />
        </div>

        {error && (
          <div style={{ background: '#fee2e2', color: '#dc2626', padding: 12, borderRadius: 8, fontSize: 14 }}>
            {error}
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={loading || scanning}>
          {loading ? '登録中...' : '登録する'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', min }) {
  return (
    <div>
      <label style={{ fontSize: 13, color: '#64748b', display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
      />
    </div>
  );
}
