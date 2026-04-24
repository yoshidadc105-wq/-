import React, { useState } from 'react';
import { api } from '../api';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let result;
      if (mode === 'login') {
        result = await api.login(username, password);
      } else {
        result = await api.register(username, password, displayName);
      }
      onLogin(result.token, result.displayName);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🦷</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>歯科在庫管理</h1>
          <p style={{ color: '#64748b', marginTop: 4 }}>ログインしてください</p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {['login', 'register'].map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: mode === m ? '#2563eb' : '#f1f5f9',
                  color: mode === m ? 'white' : '#64748b',
                  fontWeight: mode === m ? 700 : 400,
                  borderRadius: 8,
                }}
              >
                {m === 'login' ? 'ログイン' : '新規登録'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'register' && (
              <div>
                <label style={{ fontSize: 13, color: '#64748b', display: 'block', marginBottom: 4 }}>表示名</label>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="山田 花子"
                  required
                />
              </div>
            )}
            <div>
              <label style={{ fontSize: 13, color: '#64748b', display: 'block', marginBottom: 4 }}>ユーザー名</label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="username"
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: '#64748b', display: 'block', marginBottom: 4 }}>パスワード</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 14 }}>
                {error}
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
            </button>
          </form>

          {mode === 'login' && (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 16 }}>
              初期ID: admin / パスワード: admin1234
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
