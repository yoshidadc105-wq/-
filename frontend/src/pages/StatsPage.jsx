import React, { useState, useEffect } from 'react';
import { api } from '../api';

const PERIODS = [
  { key: 'week',     label: '今週' },
  { key: 'month',   label: '今月' },
  { key: '3months', label: '3ヶ月' },
  { key: '6months', label: '6ヶ月' },
  { key: 'year',    label: '1年' },
  { key: 'all',     label: '全期間' },
];

function fmt(n) { return Number(n || 0).toLocaleString(); }

function BarChart({ data, period, selectedMonth, valueKey = 'total_amount', color = '#2563eb' }) {
  if (!data || data.length === 0) return <div style={{ color: '#94a3b8', fontSize: 14, padding: '12px 0' }}>データがありません</div>;
  const max = Math.max(...data.map(d => Number(d[valueKey])));
  if (max === 0) return <div style={{ color: '#94a3b8', fontSize: 14, padding: '12px 0' }}>データがありません</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => {
        const date = new Date(d.period_start);
        const label = selectedMonth
          ? date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
          : period === 'week'
          ? date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
          : period === 'month'
          ? `${date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}週`
          : date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric' });
        const val = Number(d[valueKey]);
        const pct = (val / max) * 100;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 76, fontSize: 11, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 26, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 6, minWidth: pct > 0 ? 4 : 0 }} />
            </div>
            <div style={{ width: 76, fontSize: 12, fontWeight: 600, color: '#1e293b', flexShrink: 0, textAlign: 'right' }}>
              {valueKey === 'total_amount' ? `¥${fmt(val)}` : `${fmt(val)}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeriodSelector({ period, selectedMonth, availableMonths, onPeriod, onMonth }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => onPeriod(p.key)} style={{
            padding: '7px 14px', borderRadius: 20, fontSize: 13,
            fontWeight: period === p.key && !selectedMonth ? 700 : 400,
            background: period === p.key && !selectedMonth ? '#2563eb' : '#f1f5f9',
            color: period === p.key && !selectedMonth ? 'white' : '#475569',
            border: 'none', cursor: 'pointer', flexShrink: 0,
          }}>{p.label}</button>
        ))}
      </div>
      {availableMonths.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#64748b', flexShrink: 0 }}>月を指定：</span>
          <select value={selectedMonth} onChange={e => onMonth(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: 'white' }}>
            <option value="">（期間ボタンで選択中）</option>
            {availableMonths.map(m => (
              <option key={m} value={m}>{m.replace('-', '年')}月</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function PurchaseStats({ period, selectedMonth }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getPurchaseStats(period, selectedMonth)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [period, selectedMonth]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;
  if (!data) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>データ取得エラー</div>;

  const totalAmount = data.logs.reduce((s, l) => s + Number(l.total_amount), 0);
  const totalQty    = data.logs.reduce((s, l) => s + Number(l.quantity), 0);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { label: '合計金額', value: `¥${fmt(totalAmount)}`, color: '#2563eb' },
          { label: '入荷回数', value: `${data.logs.length}回`, color: '#16a34a' },
          { label: '合計数量', value: fmt(totalQty),           color: '#9333ea' },
        ].map(c => (
          <div key={c.label} className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>期間別購入額</div>
        <BarChart data={data.summary} period={period} selectedMonth={selectedMonth} valueKey="total_amount" color="#2563eb" />
      </div>

      {data.bySupplier.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 14 }}>発注先別</div>
          {data.bySupplier.map((s, i) => {
            const pct = totalAmount > 0 ? (Number(s.total_amount) / totalAmount) * 100 : 0;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{s.supplier_name}</span>
                  <span style={{ color: '#64748b' }}>¥{fmt(s.total_amount)}（{s.purchase_count}回）</span>
                </div>
                <div style={{ background: '#f1f5f9', borderRadius: 4, height: 8 }}>
                  <div style={{ width: `${pct}%`, background: ['#2563eb','#16a34a','#9333ea','#ea580c','#0891b2'][i % 5], height: '100%', borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 12 }}>入荷詳細</div>
        {data.logs.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 14 }}>記録がありません</div> : (
          data.logs.map((log, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.product_name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {log.supplier_name && <span style={{ background: '#eff6ff', color: '#2563eb', padding: '1px 7px', borderRadius: 8, fontWeight: 600 }}>{log.supplier_name}</span>}
                  <span>{new Date(log.logged_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{log.quantity}{log.unit || '個'}</div>
                {log.unit_price > 0 && (
                  <div style={{ fontSize: 12, color: '#64748b' }}>@¥{fmt(log.unit_price)} = <span style={{ color: '#2563eb', fontWeight: 600 }}>¥{fmt(log.total_amount)}</span></div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function UsageStats({ period, selectedMonth }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getUsageStats(period, selectedMonth)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [period, selectedMonth]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;
  if (!data) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>データ取得エラー</div>;

  const totalQty   = data.logs.reduce((s, l) => s + Number(l.quantity), 0);
  const maxQty     = data.byProduct.length > 0 ? Number(data.byProduct[0].total_qty) : 0;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { label: '合計使用数', value: fmt(totalQty),          color: '#dc2626' },
          { label: '使用回数',   value: `${data.logs.length}回`, color: '#ea580c' },
        ].map(c => (
          <div key={c.label} className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>期間別使用数</div>
        <BarChart data={data.summary} period={period} selectedMonth={selectedMonth} valueKey="total_qty" color="#dc2626" />
      </div>

      {data.byProduct.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 14 }}>商品別使用量（多い順）</div>
          {data.byProduct.map((p, i) => {
            const pct = maxQty > 0 ? (Number(p.total_qty) / maxQty) * 100 : 0;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{p.product_name}</span>
                  <span style={{ color: '#64748b', flexShrink: 0 }}>{fmt(p.total_qty)}{p.unit || '個'}（{p.use_count}回）</span>
                </div>
                <div style={{ background: '#f1f5f9', borderRadius: 4, height: 8 }}>
                  <div style={{ width: `${pct}%`, background: '#dc2626', height: '100%', borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 12 }}>使用詳細</div>
        {data.logs.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 14 }}>記録がありません</div> : (
          data.logs.map((log, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.product_name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {new Date(log.logged_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', flexShrink: 0 }}>−{log.quantity}{log.unit || '個'}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export default function StatsPage() {
  const [tab, setTab] = useState('purchase');
  const [period, setPeriod] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [availableMonths, setAvailableMonths] = useState([]);

  useEffect(() => {
    api.getStatMonths(tab === 'purchase' ? 'purchase' : 'usage')
      .then(setAvailableMonths).catch(() => {});
    setSelectedMonth('');
  }, [tab]);

  const handlePeriod = (key) => { setSelectedMonth(''); setPeriod(key); };
  const handleMonth  = (m)   => { setSelectedMonth(m); if (m) setPeriod(''); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>統計</h2>

      {/* Tab */}
      <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 12, padding: 4, gap: 4 }}>
        {[{ key: 'purchase', label: '📥 購入' }, { key: 'usage', label: '✂️ 使用' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px', borderRadius: 8, fontWeight: 700, fontSize: 15,
            background: tab === t.key ? 'white' : 'transparent',
            color: tab === t.key ? '#1e293b' : '#64748b',
            border: 'none', cursor: 'pointer',
            boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
          }}>{t.label}</button>
        ))}
      </div>

      <PeriodSelector
        period={period} selectedMonth={selectedMonth}
        availableMonths={availableMonths}
        onPeriod={handlePeriod} onMonth={handleMonth}
      />

      {tab === 'purchase'
        ? <PurchaseStats period={period} selectedMonth={selectedMonth} />
        : <UsageStats    period={period} selectedMonth={selectedMonth} />
      }
    </div>
  );
}
