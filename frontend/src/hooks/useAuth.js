import { useState, useEffect, createContext, useContext } from 'react';
import { getMe, logout as apiLogout } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading

  useEffect(() => {
    getMe()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
