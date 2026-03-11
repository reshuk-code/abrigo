'use client';

/**
 * lib/auth-context.js
 *
 * Keypair-based auth. No server. No phone. No email.
 * Identity = secp256k1 keypair stored in IndexedDB.
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { loadIdentity, clearIdentity, setDisplayName, getContacts, getAllGroups, getAllRequestStates, getRequestState, saveGroup, setRequestState, saveContact } from '@/lib/identity';
import { connectRelays, disconnectAll, getRelays } from '@/lib/nostr';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(null); // { privkeyHex, pubkeyHex, npub, nsec, displayName }
  const [loading,  setLoading]  = useState(true);
  const [relayStatus, setRelayStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'disconnected'

  const [contacts,          setContacts]          = useState({});
  const [groups,            setGroups]            = useState([]);
  const [requestStates,     setRequestStates]     = useState({});
  const [incomingRequests,  setIncomingRequests]  = useState([]);
  const [syncing,           setSyncing]           = useState(false);

  // Connect relays and update status
  const initRelays = useCallback(async () => {
    setRelayStatus('connecting');
    const connected = await connectRelays(getRelays());
    setRelayStatus(connected.size > 0 ? 'connected' : 'disconnected');
  }, []);

  const loadLocalData = useCallback(async (id) => {
    if (!id) return;
    const [c, g, rs] = await Promise.all([
      getContacts(),
      getAllGroups(),
      getAllRequestStates(),
    ]);
    setContacts(c);
    setGroups(g);
    setRequestStates(rs);
  }, []);

  const syncData = useCallback(async (id) => {
    if (!id) return;
    setSyncing(true);
    try {
      const { fetchProfile, fetchRecentGroupInvites, fetchIncomingRequests } = await import('@/lib/nostr');

      // 1. Sync profile name
      const profile = await fetchProfile(id.pubkeyHex);
      if (profile && profile.name && profile.name !== id.displayName) {
        await setDisplayName(profile.name);
        setIdentity((prev) => prev ? { ...prev, displayName: profile.name } : prev);
      }

      // 2. Sync group invites
      const invites = await fetchRecentGroupInvites(id.pubkeyHex, id.privkeyHex);
      for (const invite of invites) {
        await saveGroup({
          groupId: invite.groupId,
          name: invite.groupName,
          members: invite.members,
          groupKeyHex: invite.groupKeyHex,
          createdAt: invite.ts,
          createdBy: invite.fromPubkey,
        });
      }

      // 3. Sync chat requests and status
      const reqs = await fetchIncomingRequests(id.pubkeyHex, id.privkeyHex);
      const pendingIncoming = [];
      for (const req of reqs) {
         const current = await getRequestState(req.fromPubkey);
         if (req.kind === 14000) {
            if (!current) {
              await setRequestState(req.fromPubkey, 'pending_incoming', { displayName: req.displayName });
              pendingIncoming.push({ fromPubkey: req.fromPubkey, displayName: req.displayName, ts: req.ts });
            }
         } else if (req.kind === 14001) {
            if (!current || current.status !== 'accepted') await setRequestState(req.fromPubkey, 'accepted');
         } else if (req.kind === 14002) {
            if (!current || current.status !== 'declined') await setRequestState(req.fromPubkey, 'declined');
         }
      }

      // 4. Sync contact profiles
      const currentContacts = await getContacts();
      for (const pk of Object.keys(currentContacts)) {
        const prof = await fetchProfile(pk);
        if (prof && prof.name && prof.name !== currentContacts[pk].displayName) {
          await saveContact(pk, prof.name);
        }
      }

      // Refresh all local states
      await loadLocalData(id);
      if (pendingIncoming.length) {
        setIncomingRequests(prev => {
          const s = new Set(prev.map(x => x.fromPubkey));
          return [...prev, ...pendingIncoming.filter(x => !s.has(x.fromPubkey))];
        });
      }
    } catch (err) {
      console.error('Sync failed', err);
    } finally {
      setSyncing(false);
    }
  }, [loadLocalData]);

  useEffect(() => {
    loadIdentity().then((id) => {
      if (id) {
        setIdentity(id);
        initRelays();
        loadLocalData(id);
        syncData(id);
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
  }, [initRelays, loadLocalData, syncData]);

  const login = useCallback(async (id) => {
    setIdentity(id);
    await initRelays();
    await loadLocalData(id);
    syncData(id);
  }, [initRelays, loadLocalData, syncData]);

  const logout = useCallback(async () => {
    disconnectAll();
    await clearIdentity();
    setIdentity(null);
    setRelayStatus('disconnected');
    setContacts({});
    setGroups([]);
    setRequestStates({});
    setIncomingRequests([]);
  }, []);

  const updateDisplayName = useCallback(async (name) => {
    await setDisplayName(name, true);
    setIdentity((prev) => prev ? { ...prev, displayName: name } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{
      identity, loading, login, logout, relayStatus, updateDisplayName, syncData,
      contacts, setContacts, groups, setGroups, requestStates, setRequestStates,
      incomingRequests, setIncomingRequests, syncing, setSyncing
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
