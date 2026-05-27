import React, { useState, useEffect } from 'react';
import { api } from '../api';

const PERIODS = [
  { key: 'week',     label: '今週' },
  { key: 'month',   label: '今月' },
  { key: '3months', label: '直近3ヶ月' },
];

function fmt(n) { return Number(n || 0).toLocaleString(); }

function BarChart({ data, groupKey, period }) {
  if (!data || data.length === 0) return <div style={{ color: '#94a3b8', fontSize: 14, padding: '12px 0' }}>データがありません</div>;
  const max = Math.max(...data.map(d => Number(d.total_amount)));
  if (max === 0) return <div style={{ color: '#94a3b8', fontSize: 14, padding: '12px 0' }}>金額データがありません（単価未入力）</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => {
        const label = period === 'week'
          ? new Date(d.period_start).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
          : period === 'month'
          ? `${new Date(d.period_start).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}週`
          : new Date(d.period_start).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric' });
        const pct = max > 0 ? (Number(d.total_amount) / max) * 100 : 0;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 72, fontSize: 12, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 28, position: 'relative', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, background: '#2563eb', height: '100%', borderRadius: 6, transition: 'width 0.4s', minWidth: pct > 0 ? 4 : 0 }} />
            </div>
            <div style={{ width: 72, fontSize: 12, fontWeight: 600, color: '#1e293b', flexShrink: 0 }}>¥{fmt(d.total_amount)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function StatsPage() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getPurchaseStats(period)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  const totalAmount = data ? data.logs.reduce((s, l) => s + Number(l.total_amount), 0) : 0;
  const totalQty = data ? data.logs.reduce((s, l) => s + Number(l.quantity), 0) : 0;
  const totalCount = data ? data.logs.length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>購入統計</h2>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            flex: 1, padding: '8px 0', borderRadius: 20, fontSize: 14, fontWeight: period === p.key ? 700 : 400,
            background: period === p.key ? '#2563eb' : '#f1f5f9',
            color: period === p.key ? 'white' : '#475569',
            border: 'none', cursor: 'pointer',
          }}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>データ取得エラー</div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: '合計金額', value: `¥${fmt(totalAmount)}`, color: '#2563eb' },
              { label: '入荷回数', value: `${totalCount}回`, color: '#16a34a' },
              { label: '合計数量', value: `${fmt(totalQty)}`, color: '#9333ea' },
            ].map(card => (
              <div key={card.label} className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Time chart */}
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 14 }}>期間別購入額</div>
            <BarChart data={data.summary} period={period} />
          </div>

          {/* Supplier breakdown */}
          {data.bySupplier.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 14 }}>発注先別</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.bySupplier.map((s, i) => {
                  const pct = totalAmount > 0 ? (Number(s.total_amount) / totalAmount) * 100 : 0;
                  return (
                    <div key={i}>
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
            </div>
          )}

          {/* Detail table */}
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 12 }}>入荷詳細</div>
            {data.logs.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 14 }}>記録がありません</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {data.logs.map((log, i) => (
                  <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.product_name}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        {log.supplier_name && <span style={{ background: '#eff6ff', color: '#2563eb', padding: '1px 7px', borderRadius: 8, marginRight: 6, fontWeight: 600 }}>{log.supplier_name}</span>}
                        {new Date(log.logged_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{log.quantity}{log.unit || '個'}</div>
                      {log.unit_price > 0 && (
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          @¥{fmt(log.unit_price)} = <span style={{ color: '#2563eb', fontWeight: 600 }}>¥{fmt(log.total_amount)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
