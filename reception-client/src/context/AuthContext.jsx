import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('rc_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(r => {
        if (!r.data.user.hasReceptionAccess) {
          localStorage.removeItem('rc_token');
          setUser(null);
        } else {
          setUser(r.data.user);
        }
      })
      .catch(() => { localStorage.removeItem('rc_token'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    if (!data.user.hasReceptionAccess) {
      throw new Error('Your account does not have reception portal access. Contact your administrator.');
    }
    localStorage.setItem('rc_token', data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('rc_token');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
