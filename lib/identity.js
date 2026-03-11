/**
 * lib/identity.js — keypair identity + contacts + message cache + request state
 * All data lives in IndexedDB only. Nothing leaves the device.
 *
 * Contact statuses:
 *   'pending_sent'     — we sent them a request, waiting for reply
 *   'pending_incoming' — they sent us a request, we haven't responded
 *   'accepted'         — both sides confirmed, chat is open
 *   'declined'         — request was declined
 */

import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const DB_NAME    = 'abrigo_v2';
const DB_VERSION = 3; // bumped to add request status

// ─── Open DB ──────────────────────────────────────────────────────────────────

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }

      if (!db.objectStoreNames.contains('messages')) {
        const ms = db.createObjectStore('messages', { keyPath: 'id' });
        ms.createIndex('by_peer', 'peer', { unique: false });
        ms.createIndex('by_ts',   'ts',   { unique: false });
      }

      // New in v3: store chat request state per peer
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'pubkeyHex' });
      }
    };

    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

// ─── KV helpers ───────────────────────────────────────────────────────────────

async function kvSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function kvGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function kvDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export async function generateIdentity(displayName = '') {
  const privkeyBytes = generateSecretKey();
  const privkeyHex   = bytesToHex(privkeyBytes);
  const pubkeyHex    = getPublicKey(privkeyBytes);
  const npub         = nip19.npubEncode(pubkeyHex);
  const nsec         = nip19.nsecEncode(privkeyBytes);
  const name         = displayName.trim() || pubkeyHex.slice(0, 8);

  await kvSet('privkey',     privkeyHex);
  await kvSet('pubkey',      pubkeyHex);
  await kvSet('nsec',        nsec);
  await kvSet('displayName', name);

  return { privkeyHex, pubkeyHex, npub, nsec, displayName: name };
}

export async function importIdentity(nsecStr) {
  const { type, data } = nip19.decode(nsecStr.trim());
  if (type !== 'nsec') throw new Error('Not a valid nsec key');

  const privkeyHex = bytesToHex(data);
  const pubkeyHex  = getPublicKey(data);
  const npub       = nip19.npubEncode(pubkeyHex);
  const name       = (await kvGet('displayName')) || pubkeyHex.slice(0, 8);

  await kvSet('privkey',     privkeyHex);
  await kvSet('pubkey',      pubkeyHex);
  await kvSet('nsec',        nsecStr.trim());
  await kvSet('displayName', name);

  return { privkeyHex, pubkeyHex, npub, nsec: nsecStr.trim(), displayName: name };
}

export async function loadIdentity() {
  const privkeyHex = await kvGet('privkey');
  if (!privkeyHex) return null;
  const pubkeyHex   = await kvGet('pubkey')       || getPublicKey(hexToBytes(privkeyHex));
  const nsec        = await kvGet('nsec')          || nip19.nsecEncode(hexToBytes(privkeyHex));
  const npub        = nip19.npubEncode(pubkeyHex);
  const displayName = await kvGet('displayName')  || pubkeyHex.slice(0, 8);
  return { privkeyHex, pubkeyHex, npub, nsec, displayName };
}

export async function setDisplayName(name) { await kvSet('displayName', name.trim()); }

export async function clearIdentity() {
  for (const k of ['privkey', 'pubkey', 'nsec', 'displayName']) await kvDel(k);
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(['messages', 'requests'], 'readwrite');
    tx.objectStore('messages').clear();
    tx.objectStore('requests').clear();
    tx.oncomplete = res; tx.onerror = rej;
  });
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function getContacts() {
  const raw = await kvGet('contacts');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function saveContact(pubkeyHex, displayName) {
  if (!pubkeyHex || pubkeyHex.length !== 64) throw new Error('Invalid pubkey');
  const contacts = await getContacts();
  const npub = nip19.npubEncode(pubkeyHex);
  const name = (displayName || '').trim() || npub.slice(0, 16);
  contacts[pubkeyHex] = { pubkeyHex, npub, displayName: name, addedAt: Date.now() };
  await kvSet('contacts', JSON.stringify(contacts));
  return contacts[pubkeyHex];
}

export async function removeContact(pubkeyHex) {
  const contacts = await getContacts();
  delete contacts[pubkeyHex];
  await kvSet('contacts', JSON.stringify(contacts));
  await deleteRequestState(pubkeyHex);
}

// ─── Request state ────────────────────────────────────────────────────────────

/**
 * status: 'pending_sent' | 'pending_incoming' | 'accepted' | 'declined'
 */
export async function setRequestState(pubkeyHex, status, meta = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite');
    tx.objectStore('requests').put({ pubkeyHex, status, updatedAt: Date.now(), ...meta });
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

export async function getRequestState(pubkeyHex) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('requests', 'readonly');
    const req = tx.objectStore('requests').get(pubkeyHex);
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function getAllRequestStates() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('requests', 'readonly');
    const req = tx.objectStore('requests').getAll();
    req.onsuccess = (e) => {
      const map = {};
      for (const r of (e.target.result || [])) map[r.pubkeyHex] = r;
      resolve(map);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteRequestState(pubkeyHex) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite');
    tx.objectStore('requests').delete(pubkeyHex);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ─── Message cache (IndexedDB) ────────────────────────────────────────────────

export async function cacheMessage(msg) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').put(msg);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

export async function cacheMessages(msgs) {
  if (!msgs.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const m of msgs) store.put(m);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

export async function getCachedMessages(peerPubkeyHex) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by_peer');
    const req   = index.getAll(IDBKeyRange.only(peerPubkeyHex));
    req.onsuccess = (e) => resolve(
      (e.target.result || []).sort((a, b) => a.ts - b.ts)
    );
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getLatestCachedTs(peerPubkeyHex) {
  const msgs = await getCachedMessages(peerPubkeyHex);
  if (!msgs.length) return 0;
  return Math.max(...msgs.map(m => m.ts));
}

export async function getAllCachedPeers() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by_peer');
    const req   = index.getAllKeys();
    req.onsuccess = (e) => resolve([...new Set(e.target.result || [])]);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─── npub / hex helpers ───────────────────────────────────────────────────────

export function npubToPubkeyHex(npub) {
  try {
    const { type, data } = nip19.decode(npub.trim());
    if (type !== 'npub') return null;
    return data;
  } catch { return null; }
}

export function pubkeyHexToNpub(hex) {
  try { return nip19.npubEncode(hex); } catch { return null; }
}

export function isValidNpub(str) {
  try {
    const { type } = nip19.decode((str || '').trim());
    return type === 'npub';
  } catch { return false; }
}

export function isValidNsec(str) {
  try {
    const { type } = nip19.decode((str || '').trim());
    return type === 'nsec';
  } catch { return false; }
}

export function isValidPubkeyHex(str) {
  return /^[0-9a-f]{64}$/i.test((str || '').trim());
}

// ─── Byte helpers ─────────────────────────────────────────────────────────────

export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
