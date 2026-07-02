import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Console from './pages/Console.jsx';

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="w-6 h-6 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
      </div>
    );
  }
  return user ? <Console /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
