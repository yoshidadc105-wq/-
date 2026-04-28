// 共通ユーティリティ

// 現在のユーザー情報をロード
async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return null;
    }
    return await res.json();
  } catch {
    window.location.href = '/login.html';
    return null;
  }
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

// 日時を表示用に整形
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
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
