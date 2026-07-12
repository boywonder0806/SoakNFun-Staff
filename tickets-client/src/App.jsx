import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import TicketStudio from './pages/TicketStudio.jsx';

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="w-6 h-6 border-2 border-tix/20 border-t-tix rounded-full animate-spin" />
      </div>
    );
  }
  return user ? <TicketStudio /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
