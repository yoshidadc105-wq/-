import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AddProductPage from './pages/AddProductPage';
import ProductDetailPage from './pages/ProductDetailPage';
import Layout from './components/Layout';
import ImportPage from './pages/ImportPage';
import HistoryPage from './pages/HistoryPage';
import AddMenuPage from './pages/AddMenuPage';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/add" element={<AddMenuPage />} />
          <Route path="/add/product" element={<AddProductPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/product/:id" element={<ProductDetailPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
