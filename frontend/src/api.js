const BASE = '/api';

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
  getProduct: (id) => request('GET', `/products/${id}`),
  scanProduct: (formData) => request('POST', '/products/scan', formData),
  createProduct: (formData) => request('POST', '/products', formData),
  updateProduct: (id, formData) => request('PUT', `/products/${id}`, formData),
  deleteProduct: (id) => request('DELETE', `/products/${id}`),

  useProduct: (product_id, quantity, note) => request('POST', '/inventory/use', { product_id, quantity, note }),
  receiveProduct: (product_id, quantity, note) => request('POST', '/inventory/receive', { product_id, quantity, note }),
  getUsageLogs: (product_id) => request('GET', `/inventory/usage/${product_id}`),
};
