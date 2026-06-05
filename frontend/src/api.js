// スマホ等の別デバイスからは直接バックエンドに接続（Viteプロキシ経由だと大容量データが通らないため）
const BASE = import.meta.env.VITE_API_URL || (
  window.location.hostname === 'localhost'
    ? '/api'
    : `http://${window.location.hostname}:3001/api`
);

function getToken() {
  return localStorage.getItem('token');
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function request(method, path, body) {
  const headers = { ...authHeaders() };
  let fetchBody;

  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: fetchBody });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

export const api = {
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  register: (username, password, displayName) => request('POST', '/auth/register', { username, password, displayName }),
  me: () => request('GET', '/auth/me'),

  getProducts: () => request('GET', '/products'),
  getLowStock: () => request('GET', '/products/low-stock'),
  getExpiring: () => request('GET', '/products/expiring'),
  getProduct: (id) => request('GET', `/products/${id}`),
  scanProduct: (data) => request('POST', '/products/scan', data),
  createProduct: (formData) => request('POST', '/products', formData),
  updateProduct: (id, formData) => request('PUT', `/products/${id}`, formData),
  deleteProduct: (id) => request('DELETE', `/products/${id}`),

  useProduct: (product_id, quantity, note, lot_id) => request('POST', '/inventory/use', { product_id, quantity, note, lot_id }),
  receiveProduct: (product_id, quantity, note, expiry_date, package_label, supplier_name, unit_price) => request('POST', '/inventory/receive', { product_id, quantity, note, expiry_date, package_label, supplier_name, unit_price }),
  adjustProduct: (product_id, delta) => request('POST', '/inventory/adjust', { product_id, delta }),
  getUsageLogs: (product_id) => request('GET', `/inventory/usage/${product_id}`),

  getLots: (productId) => request('GET', `/products/${productId}/lots`),
  addLot: (productId, data) => request('POST', `/products/${productId}/lots`, data),
  deleteLot: (lotId) => request('DELETE', `/lots/${lotId}`),
  getHistory: (productId) => request('GET', `/inventory/history/${productId}`),
  deleteUsageLog: (id) => request('DELETE', `/inventory/usage-log/${id}`),
  getAllHistory: () => request('GET', '/inventory/history'),
  importPreview: (data) => request('POST', '/import/preview', data),
  importExecute: (data) => request('POST', '/import/execute', data),

  getSuppliers: () => request('GET', '/suppliers'),
  addSupplier: (name) => request('POST', '/suppliers', { name }),
  deleteSupplier: (id) => request('DELETE', `/suppliers/${id}`),
  getCategories: () => request('GET', '/categories'),
  addCategory: (name) => request('POST', '/categories', { name }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),
  getStatMonths: (type) => request('GET', `/stats/months?type=${type || 'purchase'}`),
  getPurchaseStats: (period, month) => request('GET', `/stats/purchases?${month ? `month=${month}` : `period=${period}`}`),
  getUsageStats: (period, month) => request('GET', `/stats/usage?${month ? `month=${month}` : `period=${period}`}`),
};
