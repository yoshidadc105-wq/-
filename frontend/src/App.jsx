import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import AddProductPage from './pages/AddProductPage';
import UseProductPage from './pages/UseProductPage';
import ReceiveStockPage from './pages/ReceiveStockPage';
import ProductDetailPage from './pages/ProductDetailPage';
import Layout from './components/Layout';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);

  const login = (tok, displayName) => {
    localStorage.setItem('token', tok);
    setToken(tok);
    setUser({ displayName });
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={logout}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/add" element={<AddProductPage />} />
          <Route path="/use" element={<UseProductPage />} />
          <Route path="/receive" element={<ReceiveStockPage />} />
          <Route path="/product/:id" element={<ProductDetailPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
