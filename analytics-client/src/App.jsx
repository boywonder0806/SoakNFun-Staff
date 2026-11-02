import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { FiltersProvider } from './context/FiltersContext.jsx';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Overview from './pages/Overview.jsx';
import RevenueTrends from './pages/RevenueTrends.jsx';
import ProductMix from './pages/ProductMix.jsx';
import Drinks from './pages/Drinks.jsx';
import Cabanas from './pages/Cabanas.jsx';
import Refunds from './pages/Refunds.jsx';
import SeasonPasses from './pages/SeasonPasses.jsx';
import SalesOffices from './pages/SalesOffices.jsx';
import PaymentMethods from './pages/PaymentMethods.jsx';
import SharedReports from './pages/SharedReports.jsx';
import UnderDevelopment from './components/UnderDevelopment.jsx';
import { ANALYTICS_DISABLED } from './lib/features.js';

const gated = el => (ANALYTICS_DISABLED ? <UnderDevelopment /> : el);

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
            <Route path="/" element={<Navigate to="/reports/shared" replace />} />
            <Route path="/overview" element={gated(<Overview />)} />
            <Route path="/revenue" element={gated(<RevenueTrends />)} />
            <Route path="/products" element={gated(<ProductMix />)} />
            <Route path="/drinks" element={gated(<Drinks />)} />
            <Route path="/cabanas" element={gated(<Cabanas />)} />
            <Route path="/season-passes" element={gated(<SeasonPasses />)} />
            <Route path="/offices" element={gated(<SalesOffices />)} />
            <Route path="/payment-methods" element={gated(<PaymentMethods />)} />
            <Route path="/refunds" element={gated(<Refunds />)} />
            <Route path="/reports/shared" element={<SharedReports />} />
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
