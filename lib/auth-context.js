'use client';

/**
 * lib/auth-context.js
 *
 * Keypair-based auth. No server. No phone. No email.
 * Identity = secp256k1 keypair stored in IndexedDB.
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { loadIdentity, clearIdentity, setDisplayName } from '@/lib/identity';
import { connectRelays, disconnectAll, getRelays } from '@/lib/nostr';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(null); // { privkeyHex, pubkeyHex, npub, nsec, displayName }
  const [loading,  setLoading]  = useState(true);
  const [relayStatus, setRelayStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'disconnected'

  // Connect relays and update status
  const initRelays = useCallback(async () => {
    setRelayStatus('connecting');
    const connected = await connectRelays(getRelays());
    setRelayStatus(connected.size > 0 ? 'connected' : 'disconnected');
  }, []);

  useEffect(() => {
    loadIdentity().then((id) => {
      if (id) {
        setIdentity(id);
        initRelays();
      }
      setLoading(false);
    });
    // Poll relay status every 5s so the UI reflects reconnects
    const poll = setInterval(() => {
      import('@/lib/nostr').then(({ getOpenRelays }) => {
        const open = getOpenRelays();
        setRelayStatus(open.size > 0 ? 'connected' : 'disconnected');
      });
    }, 5000);
    return () => { clearInterval(poll); disconnectAll(); };
  }, [initRelays]);

  const login = useCallback(async (id) => {
    setIdentity(id);
    await initRelays();
  }, [initRelays]);

  const logout = useCallback(async () => {
    disconnectAll();
    await clearIdentity();
    setIdentity(null);
    setRelayStatus('disconnected');
  }, []);

  const updateDisplayName = useCallback(async (name) => {
    await setDisplayName(name);
    setIdentity((prev) => prev ? { ...prev, displayName: name } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ identity, loading, login, logout, relayStatus, updateDisplayName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
