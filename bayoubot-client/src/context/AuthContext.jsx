import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // SSO handoff from the staff platform launcher: token arrives in the URL
    // fragment (#sso=...), which never reaches the server or its logs.
    const hash = window.location.hash;
    if (hash.startsWith('#sso=')) {
      localStorage.setItem('bayoubot_token', decodeURIComponent(hash.slice(5)));
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const token = localStorage.getItem('bayoubot_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(r => {
        if (!r.data.user.hasBotAccess) {
          localStorage.removeItem('bayoubot_token');
          setUser(null);
        } else {
          setUser(r.data.user);
        }
      })
      .catch(() => { localStorage.removeItem('bayoubot_token'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    if (!data.user.hasBotAccess) {
      const err = new Error('Your account does not have access to BayouBot. Contact your system administrator.');
      err.type = 'no_access';
      throw err;
    }
    localStorage.setItem('bayoubot_token', data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('bayoubot_token');
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
