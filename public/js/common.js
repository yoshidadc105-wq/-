// 共通ユーティリティ

// 現在のユーザー情報をロード（クイズモードチェック込み）
async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return null;
    }
    const user = await res.json();

    // 管理者以外はクイズモードをチェック
    if (user.role !== 'admin') {
      const qRes = await fetch('/api/settings/quiz-mode');
      if (qRes.ok) {
        const { quiz_mode } = await qRes.json();
        if (quiz_mode) {
          showQuizModeBlock();
          return null;
        }
      }
    }

    return user;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

function showQuizModeBlock() {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;">
      <div style="text-align:center;padding:48px 32px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.1);max-width:400px;">
        <div style="font-size:64px;margin-bottom:16px;">📝</div>
        <h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">クイズ実施中</h1>
        <p style="color:#666;line-height:1.6;">現在クイズが実施されているため<br>マニュアルにアクセスできません。<br>クイズ終了後に再度アクセスしてください。</p>
      </div>
    </div>
  `;
}

// ナビバーを初期化
function initNavbar(user) {
  const nameEl = document.getElementById('navUserName');
  const adminLink = document.getElementById('navAdminLink');
  const progressLink = document.getElementById('navProgressLink');

  if (nameEl) nameEl.textContent = user.displayName;
  if (adminLink) {
    if (user.role === 'admin') {
      adminLink.classList.remove('hidden');
    } else {
      adminLink.classList.add('hidden');
    }
  }
  if (progressLink) progressLink.classList.remove('hidden');
}

// ログアウト
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// アラート表示
function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ファイルサイズを表示用に整形
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 日時を表示用に整形（DBはUTC保存のため末尾にZを付けてJSTへ変換）
function formatDate(dateStr) {
  if (!dateStr) return '';
  // SQLiteはUTCで保存されているため、Zを付与してブラウザのローカル時刻（JST）に変換
  const isoStr = dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

// モーダルを開く/閉じる
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// 確認ダイアログ
function confirmDialog(message) {
  return window.confirm(message);
}
