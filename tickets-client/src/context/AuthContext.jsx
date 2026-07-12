import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api.js';

const AuthContext = createContext(null);

function hasTicketAccess(user) {
  return user.role === 'sysadmin' || !!user.hasTicketsAccess;
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // SSO handoff from the staff platform launcher: token arrives in the URL
    // fragment (#sso=...), which never reaches the server or its logs.
    const hash = window.location.hash;
    if (hash.startsWith('#sso=')) {
      localStorage.setItem('tickets_token', decodeURIComponent(hash.slice(5)));
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const token = localStorage.getItem('tickets_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(r => {
        if (!hasTicketAccess(r.data.user)) {
          localStorage.removeItem('tickets_token');
          setUser(null);
        } else {
          setUser(r.data.user);
        }
      })
      .catch(() => { localStorage.removeItem('tickets_token'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    if (!hasTicketAccess(data.user)) {
      const err = new Error('The Ticket Manager requires ticket access — ask your administrator.');
      err.type = 'no_access';
      throw err;
    }
    localStorage.setItem('tickets_token', data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('tickets_token');
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
