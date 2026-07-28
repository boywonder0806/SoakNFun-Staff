import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { FiltersProvider } from './context/FiltersContext.jsx';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Overview from './pages/Overview.jsx';
import RevenueTrends from './pages/RevenueTrends.jsx';
import ProductMix from './pages/ProductMix.jsx';
import Drinks from './pages/Drinks.jsx';
import SalesOffices from './pages/SalesOffices.jsx';
import PaymentMethods from './pages/PaymentMethods.jsx';

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="w-6 h-6 border-2 border-az/20 border-t-az rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <FiltersProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/revenue" element={<RevenueTrends />} />
            <Route path="/products" element={<ProductMix />} />
            <Route path="/drinks" element={<Drinks />} />
            <Route path="/offices" element={<SalesOffices />} />
            <Route path="/payment-methods" element={<PaymentMethods />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </FiltersProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
