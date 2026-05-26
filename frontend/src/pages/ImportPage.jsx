import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const EMPTY_ROW = () => ({ name: '', maker: '', item_code: '', stock: '0', alert_threshold: '5', expiry_date: '', unit: '' });

export default function ImportPage() {
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const navigate = useNavigate();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      // Skip header if it looks like a header row
      const dataLines = lines[0] && (lines[0].startsWith('商品名') || lines[0].startsWith('name'))
        ? lines.slice(1)
        : lines;
      const parsed = dataLines.map(line => {
        const cols = line.split(',');
        return {
          name: (cols[0] || '').trim(),
          maker: (cols[1] || '').trim(),
          item_code: (cols[2] || '').trim(),
          stock: (cols[3] || '0').trim(),
          alert_threshold: (cols[4] || '5').trim(),
          expiry_date: (cols[5] || '').trim(),
          unit: (cols[6] || '').trim(),
        };
      }).filter(r => r.name);
      if (parsed.length > 0) {
        setRows(parsed);
      }
      setStep(2);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const updateRow = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const deleteRow = (idx) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    setRows(prev => [...prev, EMPTY_ROW()]);
  };

  const handleExecute = async () => {
    const valid = rows.filter(r => r.name.trim());
    if (valid.length === 0) {
      setError('商品名が入力された行がありません');
      return;
    }
    setError('');
    setImporting(true);
    try {
      const result = await api.importExecute(valid);
      setImportedCount(result.count);
      setStep(3);
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  if (step === 3) {
    return (
      <div style={{ textAlign: 'center', padding: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 60 }}>✅</div>
        <div style={{ fontWeight: 700, fontSize: 22 }}>{importedCount}件の商品を取り込みました</div>
        <button
          className="btn-primary"
          onClick={() => navigate('/')}
          style={{ marginTop: 8 }}
        >
          在庫一覧へ戻る
        </button>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 style={{ fontWeight: 700, fontSize: 20 }}>商品を一括取込</h2>

        <div style={{ background: '#f1f5f9', borderRadius: 12, padding: 16, fontSize: 14, color: '#475569' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>CSVファイルをアップロードしてください</div>
          <div style={{ fontSize: 13, marginBottom: 6, color: '#64748b' }}>CSVのフォーマット（1行目はヘッダーとして読み飛ばされます）:</div>
          <code style={{ display: 'block', background: '#e2e8f0', padding: '8px 12px', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            商品名,メーカー,品番,在庫数,アラート閾値,使用期限,単位
          </code>
          <div style={{ fontSize: 12, marginTop: 8, color: '#94a3b8' }}>使用期限はYYYY-MM形式 (例: 2025-12)　単位は箱・袋・本など</div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        <button
          className="btn-primary"
          onClick={() => fileRef.current.click()}
          style={{ padding: '16px', fontSize: 16 }}
        >
          📂 CSVファイルを選択
        </button>

        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>または</div>

        <button
          className="btn-secondary"
          onClick={() => setStep(2)}
        >
          ＋ 手動で入力する
        </button>
      </div>
    );
  }

  // Step 2: preview/edit
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontWeight: 700, fontSize: 20 }}>取込データの確認</h2>
        <button
          className="btn-secondary"
          onClick={() => setStep(1)}
          style={{ fontSize: 13, padding: '6px 12px' }}
        >
          ← 戻る
        </button>
      </div>

      <div style={{ fontSize: 13, color: '#64748b' }}>{rows.length}件のデータ。編集・削除してから取込を実行してください。</div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['商品名', 'メーカー', '品番', '在庫', '閾値', '使用期限', '単位', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 6px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12, borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                {['name', 'maker', 'item_code', 'stock', 'alert_threshold', 'expiry_date', 'unit'].map(field => (
                  <td key={field} style={{ padding: '6px 4px' }}>
                    <input
                      value={row[field]}
                      onChange={e => updateRow(idx, field, e.target.value)}
                      placeholder={field === 'expiry_date' ? 'YYYY-MM' : ''}
                      style={{
                        width: field === 'name' ? 120 : field === 'expiry_date' ? 90 : field === 'stock' || field === 'alert_threshold' ? 60 : 80,
                        padding: '5px 6px',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                  </td>
                ))}
                <td style={{ padding: '6px 4px' }}>
                  <button
                    onClick={() => deleteRow(idx)}
                    style={{
                      background: '#fee2e2',
                      color: '#dc2626',
                      padding: '4px 8px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        className="btn-secondary"
        onClick={addRow}
        style={{ fontSize: 14 }}
      >
        ＋ 行を追加
      </button>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: 12, borderRadius: 8, fontSize: 14 }}>
          {error}
        </div>
      )}

      <button
        className="btn-primary"
        onClick={handleExecute}
        disabled={importing}
        style={{ padding: '14px', fontSize: 16, fontWeight: 700 }}
      >
        {importing ? '取込中...' : '取込実行'}
      </button>
    </div>
  );
}
