/**
 * lib/nostr.js — Nostr protocol layer
 *
 * NIP-44 hard limit: plaintext must be 1–65535 bytes.
 *
 * Media strategy (fully decentralized — no upload servers):
 *   Images  → Canvas-compressed JPEG ≤ 40KB base64
 *   Audio   → raw WebM blob as base64 (short clips only, ≤ 25KB)
 *   Video   → REJECTED with friendly error (too large for relay transport)
 *
 * Kinds used:
 *   4      = encrypted DM  (text / media / reaction / edit / delete / reply)
 *   14000  = chat request
 *   14001  = request accepted
 *   14002  = request declined
 */

import { finalizeEvent, verifyEvent, nip44 } from 'nostr-tools';

// Helper to get identity functions only on client
async function getIdentity() {
  if (typeof window === 'undefined') return null;
  return await import('./identity');
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// ─── Relays ───────────────────────────────────────────────────────────────────

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

const RELAY_KEY = 'abrigo_relays';

export function getRelays() {
  if (typeof window === 'undefined') return DEFAULT_RELAYS;
  try { const s = localStorage.getItem(RELAY_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_RELAYS;
}

export function saveRelays(relays) {
  localStorage.setItem(RELAY_KEY, JSON.stringify(relays));
}

// ─── Relay pool ───────────────────────────────────────────────────────────────

const pool        = new Map();   // url → WebSocket
const msgHandlers = new Set();   // global message listeners
const activeSubs  = new Map();   // subId → filters  (for re-subscribing on reconnect)
const reconnectTimers = new Map(); // url → timer

function attachGlobalHandler(ws, url) {
  ws.addEventListener('message', ({ data }) => {
    for (const h of msgHandlers) { try { h(data); } catch {} }
  });
  // Use { once: true } so this listener fires exactly once and never re-triggers
  ws.addEventListener('close', () => {
    // Only schedule reconnect if this ws is still the one tracked in the pool
    if (pool.get(url) === ws) {
      pool.delete(url);
      scheduleReconnect(url, 2000);
    }
  }, { once: true });
}

function scheduleReconnect(url, delay) {
  if (reconnectTimers.has(url)) return; // already scheduled
  const timer = setTimeout(() => {
    reconnectTimers.delete(url);
    if (pool.has(url) && pool.get(url).readyState === WebSocket.OPEN) return;
    let ws;
    try { ws = new WebSocket(url); } catch { scheduleReconnect(url, Math.min(delay * 2, 30000)); return; }

    // Attach handlers BEFORE any async tick so they are in place even if
    // the socket fails synchronously or immediately after construction.
    const nextDelay = Math.min(delay * 2, 30000);
    const t = setTimeout(() => { ws.close(); scheduleReconnect(url, nextDelay); }, 8000);

    ws.addEventListener('open', () => {
      clearTimeout(t);
      pool.set(url, ws);
      attachGlobalHandler(ws, url);
      // Re-send all active subscriptions to this relay
      for (const [subId, filters] of activeSubs.entries()) {
        try { ws.send(JSON.stringify(['REQ', subId, ...filters])); } catch {}
      }
    }, { once: true });

    ws.addEventListener('error', () => {
      clearTimeout(t);
      // 'close' will fire right after 'error'; only schedule reconnect from 'close'
    }, { once: true });

    ws.addEventListener('close', () => {
      clearTimeout(t);
      // Only reconnect if we never successfully opened this socket
      if (pool.get(url) !== ws) scheduleReconnect(url, nextDelay);
    }, { once: true });
  }, delay);
  reconnectTimers.set(url, timer);
}

export async function connectRelays(relayUrls = getRelays()) {
  const connected = new Map();
  await Promise.allSettled(relayUrls.map(url => new Promise(resolve => {
    if (pool.has(url) && pool.get(url).readyState === WebSocket.OPEN) {
      connected.set(url, pool.get(url)); return resolve();
    }
    // Cancel any pending reconnect so we connect immediately
    const existing = reconnectTimers.get(url);
    if (existing) { clearTimeout(existing); reconnectTimers.delete(url); }
    let ws;
    try { ws = new WebSocket(url); } catch { scheduleReconnect(url, 2000); return resolve(); }
    // Attach ALL handlers synchronously before any tick
    const t = setTimeout(() => { ws.close(); scheduleReconnect(url, 2000); resolve(); }, 8000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      pool.set(url, ws);
      attachGlobalHandler(ws, url);
      connected.set(url, ws);
      resolve();
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(t);
      // 'close' fires next; schedule reconnect from there
    }, { once: true });
    ws.addEventListener('close', () => {
      clearTimeout(t);
      if (pool.get(url) !== ws) scheduleReconnect(url, 2000);
      resolve();
    }, { once: true });
  })));
  return connected;
}

export function disconnectAll() {
  for (const timer of reconnectTimers.values()) clearTimeout(timer);
  reconnectTimers.clear();
  for (const ws of pool.values()) ws.close();
  pool.clear(); msgHandlers.clear(); activeSubs.clear();
}

export function getOpenRelays() {
  const open = new Map();
  for (const [url, ws] of pool.entries()) if (ws.readyState === WebSocket.OPEN) open.set(url, ws);
  return open;
}

// ─── NIP-44 crypto ────────────────────────────────────────────────────────────

export function encryptDM(plaintext, myPrivkeyHex, theirPubkeyHex) {
  const key = nip44.v2.utils.getConversationKey(hexToBytes(myPrivkeyHex), theirPubkeyHex);
  return nip44.v2.encrypt(plaintext, key);
}

export function decryptDM(ciphertext, myPrivkeyHex, theirPubkeyHex) {
  const key = nip44.v2.utils.getConversationKey(hexToBytes(myPrivkeyHex), theirPubkeyHex);
  return nip44.v2.decrypt(ciphertext, key);
}

// ─── Media compression helpers ────────────────────────────────────────────────

/**
 * Compress an image File to JPEG base64 that fits within NIP-44.
 * Shrinks to max 480px on longest side, then iterates quality down until
 * the resulting JSON payload is under ~42 000 bytes (safe budget).
 * Returns { b64: string, mimeType: 'image/jpeg' }
 */
export async function compressImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      // Resize to max 480px on longest side
      const MAX = 480;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        const ratio = Math.min(MAX / w, MAX / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // Try quality from 0.65 down to 0.15 until base64 fits in budget
      // Budget: JSON wrapper ≈ 80 bytes overhead; NIP-44 limit 65535; keep ≤ 42000 chars b64
      const BUDGET = 42000;
      let quality = 0.65;
      let b64 = '';
      while (quality >= 0.15) {
        b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        if (b64.length <= BUDGET) break;
        quality = parseFloat((quality - 0.1).toFixed(2));
      }

      if (b64.length > BUDGET) {
        reject(new Error(
          `Image still too large after compression (${Math.round(b64.length / 1024)}KB). ` +
          `Please pick a smaller image.`
        ));
      } else {
        resolve({ b64, mimeType: 'image/jpeg' });
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image for compression')); };
    img.src = url;
  });
}

/**
 * Convert a small audio Blob to base64.
 * Hard limit: 25 000 chars (≈ ~18KB binary). This supports ~15–20s of
 * low-bitrate WebM/Opus audio recorded by the browser.
 * Returns { b64: string, mimeType: string }
 */
export async function audioBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const BUDGET = 25000;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const b64 = dataUrl.split(',')[1];
      const mimeType = dataUrl.split(';')[0].replace('data:', '') || 'audio/webm';
      if (b64.length > BUDGET) {
        reject(new Error(
          `Voice clip too long (${Math.round(b64.length / 1024)}KB). ` +
          `Keep recordings under ~20 seconds.`
        ));
      } else {
        resolve({ b64, mimeType });
      }
    };
    reader.onerror = () => reject(new Error('Failed to read audio'));
    reader.readAsDataURL(blob);
  });
}

// ─── Event builders ───────────────────────────────────────────────────────────

/** Kind 0 Profile metadata */
export function buildProfileEvent(name, privkeyHex) {
  return finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name, display_name: name }),
  }, hexToBytes(privkeyHex));
}

/** Plain text DM */
export function buildDMEvent(plaintext, senderPrivkeyHex, recipientPubkeyHex) {
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex]],
    content: encryptDM(plaintext, senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

/**
 * Media DM.
 * mediaPayload must already have a compressed/small b64 `data` field.
 * { type:'media', mediaType:'image'|'audio', data:b64string, mimeType, fileName }
 */
export function buildMediaDMEvent(mediaPayload, senderPrivkeyHex, recipientPubkeyHex) {
  const json = JSON.stringify(mediaPayload);
  const byteLen = new TextEncoder().encode(json).length;
  if (byteLen > 65000) {
    throw new Error(`Media payload ${byteLen} bytes exceeds NIP-44 limit. Compress further.`);
  }
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex]],
    content: encryptDM(json, senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

/** Reaction  { type:'reaction', targetId, emoji } */
export function buildReactionEvent(targetId, emoji, senderPrivkeyHex, recipientPubkeyHex) {
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex], ['e', targetId]],
    content: encryptDM(JSON.stringify({ type: 'reaction', targetId, emoji }), senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

/** Edit  { type:'edit', targetId, newText } */
export function buildEditEvent(targetId, newText, senderPrivkeyHex, recipientPubkeyHex) {
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex], ['e', targetId]],
    content: encryptDM(JSON.stringify({ type: 'edit', targetId, newText }), senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

/** Delete  { type:'delete', targetId } */
export function buildDeleteEvent(targetId, senderPrivkeyHex, recipientPubkeyHex) {
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex], ['e', targetId]],
    content: encryptDM(JSON.stringify({ type: 'delete', targetId }), senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

/** Reply  { type:'reply', replyToId, replyToText, text } */
export function buildReplyEvent(replyToId, replyToText, text, senderPrivkeyHex, recipientPubkeyHex) {
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex], ['e', replyToId]],
    content: encryptDM(JSON.stringify({ type: 'reply', replyToId, replyToText, text }), senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

// ─── Chat request events ──────────────────────────────────────────────────────

export function buildRequestEvent(senderPrivkeyHex, recipientPubkeyHex, displayName = '') {
  return finalizeEvent({
    kind: 14000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex]],
    content: encryptDM(JSON.stringify({ type: 'chat_request', displayName }), senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

export function buildAcceptEvent(myPrivkeyHex, requesterPubkeyHex) {
  return finalizeEvent({
    kind: 14001,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', requesterPubkeyHex]],
    content: encryptDM(JSON.stringify({ type: 'chat_accepted' }), myPrivkeyHex, requesterPubkeyHex),
  }, hexToBytes(myPrivkeyHex));
}

export function buildDeclineEvent(myPrivkeyHex, requesterPubkeyHex) {
  return finalizeEvent({
    kind: 14002,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', requesterPubkeyHex]],
    content: encryptDM(JSON.stringify({ type: 'chat_declined' }), myPrivkeyHex, requesterPubkeyHex),
  }, hexToBytes(myPrivkeyHex));
}

// ─── Publish ──────────────────────────────────────────────────────────────────

export async function publishEvent(event) {
  let open = getOpenRelays();
  // If no open relays, try reconnecting once before giving up
  if (open.size === 0) {
    await connectRelays();
    open = getOpenRelays();
  }
  let sent = 0;
  for (const ws of open.values()) {
    try { ws.send(JSON.stringify(['EVENT', event])); sent++; } catch {}
  }
  return sent;
}

// ─── Subscribe ────────────────────────────────────────────────────────────────

export function subscribe(filters, onEvent, onEOSE) {
  const subId = Math.random().toString(36).slice(2, 10);
  const seen  = new Set();
  const open  = getOpenRelays();
  // Track per-relay EOSE by relay URL so we fire onEOSE exactly once after ALL relays respond
  const eoseReceived = new Set();
  const relayUrls    = [...open.keys()];
  const totalRelays  = relayUrls.length;

  // Register in activeSubs so reconnected relays automatically re-subscribe
  activeSubs.set(subId, filters);

  for (const [url, ws] of open.entries()) {
    try { ws.send(JSON.stringify(['REQ', subId, ...filters])); } catch { eoseReceived.add(url); }
  }
  // If no relays open, fire EOSE immediately
  if (totalRelays === 0) setTimeout(() => onEOSE?.(), 0);

  let eoseFired = false;
  const fireEOSE = () => { if (!eoseFired) { eoseFired = true; onEOSE?.(); } };

  const handler = (data) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!Array.isArray(msg)) return;
    const [type, sid, event] = msg;
    if (sid !== subId) return;
    if (type === 'EVENT' && event && !seen.has(event.id)) {
      try { if (!verifyEvent(event)) return; } catch { return; }
      seen.add(event.id); onEvent(event);
    }
    if (type === 'EOSE') {
      // We can't identify which relay sent this from the message alone;
      // mark one unchecked relay as done each time EOSE arrives.
      const pending = relayUrls.find(u => !eoseReceived.has(u));
      if (pending) eoseReceived.add(pending);
      if (eoseReceived.size >= totalRelays) fireEOSE();
    }
  };

  msgHandlers.add(handler);
  return () => {
    activeSubs.delete(subId);
    msgHandlers.delete(handler);
    for (const ws of getOpenRelays().values()) {
      try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {}
    }
  };
}

// ─── Fetch DMs ────────────────────────────────────────────────────────────────

export async function fetchAndCacheDMs(myPubkeyHex, myPrivkeyHex, peerPubkeyHex, sinceTs = 0) {
  // Ensure relays are connected before fetching
  let open = getOpenRelays();
  if (open.size === 0) { await connectRelays(); open = getOpenRelays(); }
  if (open.size === 0) return [];

  return new Promise((resolve) => {
    const newMsgs = [];
    let resolved = false;
    const finish = () => {
      if (resolved) return; resolved = true;
      unsub();
      if (newMsgs.length) {
        getIdentity().then(id => id?.cacheMessages(newMsgs).catch(() => {}));
      }
      resolve(newMsgs.sort((a, b) => a.ts - b.ts));
    };
    const filters = [
      { kinds: [4], authors: [myPubkeyHex],  '#p': [peerPubkeyHex], ...(sinceTs ? { since: sinceTs } : {}) },
      { kinds: [4], authors: [peerPubkeyHex], '#p': [myPubkeyHex],  ...(sinceTs ? { since: sinceTs } : {}) },
    ];
    // unsub is assigned below; use a wrapper so the EOSE callback can call it
    let unsub = () => {};
    unsub = subscribe(filters, ev => {
      const d = decodeEvent(ev, myPubkeyHex, myPrivkeyHex, peerPubkeyHex);
      if (d) newMsgs.push(d);
    }, finish); // EOSE fires once after ALL relays respond
    // Safety timeout — 3s is plenty; relays that respond fast unblock immediately via EOSE
    setTimeout(finish, 3000);
  });
}

export async function subscribeToConversation(myPubkeyHex, myPrivkeyHex, peerPubkeyHex, sinceTs, onMessage) {
  // Ensure at least one relay is up before subscribing
  if (getOpenRelays().size === 0) await connectRelays();
  // Subtract 5 seconds to avoid missing messages sent in the same second as the subscription
  const since = Math.max(0, sinceTs - 5);
  const filters = [
    { kinds: [4], authors: [peerPubkeyHex], '#p': [myPubkeyHex],  since },
    { kinds: [4], authors: [myPubkeyHex],  '#p': [peerPubkeyHex], since },
  ];
  return subscribe(filters, ev => {
    const d = decodeEvent(ev, myPubkeyHex, myPrivkeyHex, peerPubkeyHex);
    if (d) {
      getIdentity().then(id => id?.cacheMessage(d).catch(() => {}));
      onMessage(d);
    }
  });
}

// ─── Group events (kind 14010–14013) ─────────────────────────────────────────────────────

/**
 * Encrypt/decrypt using a raw 32-byte group key (hex) via AES-GCM.
 * We can't use NIP-44 directly (that takes a Diffie-Hellman key pair),
 * so we do AES-256-GCM with the shared groupKeyHex as raw key material.
 */
export async function encryptGroupMsg(plaintext, groupKeyHex) {
  const keyBytes = hexToBytes(groupKeyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptGroupMsg(cipherB64, groupKeyHex) {
  const keyBytes = hexToBytes(groupKeyHex);
  const key      = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
  const iv  = combined.slice(0, 12);
  const enc = combined.slice(12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
  return new TextDecoder().decode(dec);
}

/**
 * Group invite — kind 14010
 * Sent individually (NIP-44) to each member so only they can read the group key.
 * payload: { type:'group_invite', groupId, groupKeyHex, groupName, members:[hex] }
 */
export function buildGroupInviteEvent(groupId, groupKeyHex, groupName, members, senderPrivkeyHex, recipientPubkeyHex) {
  const payload = JSON.stringify({ type: 'group_invite', groupId, groupKeyHex, groupName, members });
  return finalizeEvent({
    kind: 14010,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkeyHex]],
    content: encryptDM(payload, senderPrivkeyHex, recipientPubkeyHex),
  }, hexToBytes(senderPrivkeyHex));
}

/**
 * Group message — kind 14011
 * content is AES-GCM ciphertext with group key.
 * tags: [['g', groupId], ...memberPubkeys as ['p', hex]]
 */
export async function buildGroupMessageEvent(text, groupId, members, groupKeyHex, senderPrivkeyHex) {
  const payload = JSON.stringify({ type: 'group_msg', groupId, text });
  const cipher  = await encryptGroupMsg(payload, groupKeyHex);
  return finalizeEvent({
    kind: 14011,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['g', groupId], ...members.map(m => ['p', m])],
    content: cipher,
  }, hexToBytes(senderPrivkeyHex));
}

/**
 * Group media message — kind 14011 with media payload
 */
export async function buildGroupMediaEvent(mediaPayload, groupId, members, groupKeyHex, senderPrivkeyHex) {
  const payload = JSON.stringify({ type: 'group_media', groupId, ...mediaPayload });
  const cipher  = await encryptGroupMsg(payload, groupKeyHex);
  return finalizeEvent({
    kind: 14011,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['g', groupId], ...members.map(m => ['p', m])],
    content: cipher,
  }, hexToBytes(senderPrivkeyHex));
}

/**
 * Group member added — kind 14012 (re-invite with updated member list)
 */
export function buildGroupAddMemberEvent(groupId, groupKeyHex, groupName, members, senderPrivkeyHex, recipientPubkeyHex) {
  return buildGroupInviteEvent(groupId, groupKeyHex, groupName, members, senderPrivkeyHex, recipientPubkeyHex);
}

/**
 * Fetch + subscribe group messages for a given groupId.
 * Returns { messages, unsub }
 */
export async function fetchGroupMessages(myPubkeyHex, groupId, groupKeyHex, members, sinceTs = 0) {
  let open = getOpenRelays();
  if (open.size === 0) { await connectRelays(); open = getOpenRelays(); }
  if (open.size === 0) return [];

  return new Promise(resolve => {
    const newMsgs  = [];
    let resolved   = false;
    const finish   = () => { if (resolved) return; resolved = true; unsub(); resolve(newMsgs.sort((a,b) => a.ts - b.ts)); };
    // Filter by #p (member pubkeys) — universally supported by relays.
    // Also filter by #g if supported; we validate groupId inside decodeGroupEvent.
    const filters  = [{ kinds: [14011], '#p': [myPubkeyHex], ...(sinceTs ? { since: sinceTs } : {}) }];
    let unsub = () => {};
    unsub = subscribe(filters, async ev => {
      // Only process events tagged with our groupId
      if (!ev.tags.some(t => t[0] === 'g' && t[1] === groupId)) return;
      const d = await decodeGroupEvent(ev, myPubkeyHex, groupId, groupKeyHex);
      if (d) newMsgs.push(d);
    }, finish);
    setTimeout(finish, 3000);
  });
}

export async function subscribeToGroup(myPubkeyHex, groupId, groupKeyHex, sinceTs, onMessage) {
  if (getOpenRelays().size === 0) await connectRelays();
  const since = Math.max(0, sinceTs - 5);
  // Filter by #p (member pubkey) — universally supported. Validate groupId inside handler.
  return subscribe(
    [{ kinds: [14011], '#p': [myPubkeyHex], since }],
    async ev => {
      if (!ev.tags.some(t => t[0] === 'g' && t[1] === groupId)) return;
      const d = await decodeGroupEvent(ev, myPubkeyHex, groupId, groupKeyHex);
      if (d) {
      getIdentity().then(id => id?.cacheMessage(d).catch(() => {}));
      onMessage(d);
    }
    }
  );
}

export async function subscribeToGroupInvites(myPubkeyHex, myPrivkeyHex, sinceTs, onInvite) {
  if (getOpenRelays().size === 0) await connectRelays();
  const since = Math.max(0, sinceTs - 5);
  return subscribe(
    [{ kinds: [14010], '#p': [myPubkeyHex], since }],
    ev => {
      try {
        const p = JSON.parse(decryptDM(ev.content, myPrivkeyHex, ev.pubkey));
        if (p.type === 'group_invite') onInvite({ ...p, fromPubkey: ev.pubkey });
      } catch {}
    }
  );
}

export async function decodeGroupEvent(ev, myPubkeyHex, groupId, groupKeyHex) {
  try {
    const raw = await decryptGroupMsg(ev.content, groupKeyHex);
    const p   = JSON.parse(raw);
    if (p.groupId !== groupId) return null;
    const base = { id: ev.id, peer: groupId, from: ev.pubkey, ts: ev.created_at * 1000, mine: ev.pubkey === myPubkeyHex, groupId };
    if (p.type === 'group_media') return { ...base, msgType: 'media', mediaType: p.mediaType, data: p.data, mimeType: p.mimeType || '', fileName: p.fileName || '' };
    if (p.type === 'group_msg')   return { ...base, msgType: 'text', text: p.text, reactions: {} };
    return null;
  } catch { return null; }
}

// ─── Requests ───────────────────────────────────────────────────────────────────

export async function fetchProfile(pubkeyHex) {
  let open = getOpenRelays();
  if (open.size === 0) { await connectRelays(); open = getOpenRelays(); }
  if (open.size === 0) return null;

  return new Promise((resolve) => {
    let best = null;
    let eoseCount = 0;
    const unsub = subscribe(
      [{ kinds: [0], authors: [pubkeyHex] }],
      ev => {
        try {
          const p = JSON.parse(ev.content);
          if (!best || ev.created_at > best.ts) {
            best = { name: p.name || p.display_name || '', ts: ev.created_at };
          }
        } catch {}
      },
      () => { eoseCount++; if (eoseCount >= open.size) { unsub(); resolve(best); } }
    );
    setTimeout(() => { unsub(); resolve(best); }, 3000);
  });
}

export async function fetchIncomingRequests(myPubkeyHex, myPrivkeyHex, sinceTs = 0) {
  let open = getOpenRelays();
  if (open.size === 0) { await connectRelays(); open = getOpenRelays(); }
  if (open.size === 0) return [];

  return new Promise((resolve) => {
    const requests = [];
    let eoseCount = 0;
    const unsub = subscribe(
      [{ kinds: [14000, 14001, 14002], '#p': [myPubkeyHex], ...(sinceTs ? { since: sinceTs } : {}) }],
      ev => {
        try {
          const p = JSON.parse(decryptDM(ev.content, myPrivkeyHex, ev.pubkey));
          if (ev.kind === 14000 && p.type === 'chat_request') {
            requests.push({ kind: 14000, fromPubkey: ev.pubkey, displayName: p.displayName || '', ts: ev.created_at * 1000, eventId: ev.id });
          } else if (ev.kind === 14001 && p.type === 'chat_accepted') {
            requests.push({ kind: 14001, fromPubkey: ev.pubkey, ts: ev.created_at * 1000 });
          } else if (ev.kind === 14002 && p.type === 'chat_declined') {
            requests.push({ kind: 14002, fromPubkey: ev.pubkey, ts: ev.created_at * 1000 });
          }
        } catch {}
      },
      () => { eoseCount++; if (eoseCount >= open.size) { unsub(); resolve(requests); } }
    );
    setTimeout(() => { unsub(); resolve(requests); }, 5000);
  });
}

/** Fetch recent group invites (kind 14010) */
export async function fetchRecentGroupInvites(myPubkeyHex, myPrivkeyHex, sinceTs = 0) {
  let open = getOpenRelays();
  if (open.size === 0) { await connectRelays(); open = getOpenRelays(); }
  if (open.size === 0) return [];

  return new Promise((resolve) => {
    const invites = [];
    let eoseCount = 0;
    const unsub = subscribe(
      [{ kinds: [14010], '#p': [myPubkeyHex], ...(sinceTs ? { since: sinceTs } : {}) }],
      ev => {
        try {
          const p = JSON.parse(decryptDM(ev.content, myPrivkeyHex, ev.pubkey));
          if (p.type === 'group_invite') {
            invites.push({ ...p, fromPubkey: ev.pubkey, ts: ev.created_at * 1000 });
          }
        } catch {}
      },
      () => { eoseCount++; if (eoseCount >= open.size) { unsub(); resolve(invites); } }
    );
    setTimeout(() => { unsub(); resolve(invites); }, 5000);
  });
}

export function subscribeToRequests(myPubkeyHex, myPrivkeyHex, sinceTs, onRequest, onStatusUpdate) {
  return subscribe(
    [{ kinds: [14000, 14001, 14002], '#p': [myPubkeyHex], since: sinceTs }],
    ev => {
      try {
        const p = JSON.parse(decryptDM(ev.content, myPrivkeyHex, ev.pubkey));
        if (ev.kind === 14000 && p.type === 'chat_request')  onRequest?.({ fromPubkey: ev.pubkey, displayName: p.displayName || '', ts: ev.created_at * 1000, eventId: ev.id });
        if (ev.kind === 14001 && p.type === 'chat_accepted') onStatusUpdate?.(ev.pubkey, 'accepted');
        if (ev.kind === 14002 && p.type === 'chat_declined') onStatusUpdate?.(ev.pubkey, 'declined');
      } catch {}
    }
  );
}

// ─── Decode event → message object ───────────────────────────────────────────

export function decodeEvent(event, myPubkeyHex, myPrivkeyHex, peerPubkeyHex) {
  try {
    const isMine   = event.pubkey === myPubkeyHex;
    const theirKey = isMine ? peerPubkeyHex : event.pubkey;

    if (isMine) {
      if (event.tags.find(t => t[0] === 'p')?.[1] !== peerPubkeyHex) return null;
    } else {
      if (event.pubkey !== peerPubkeyHex) return null;
    }

    let raw = null;
    try { raw = decryptDM(event.content, myPrivkeyHex, theirKey); } catch {}

    let parsed = null;
    if (raw) try { parsed = JSON.parse(raw); } catch {}

    const base = { id: event.id, peer: peerPubkeyHex, from: event.pubkey, ts: event.created_at * 1000, mine: isMine };

    if (parsed?.type === 'media')    return { ...base, msgType: 'media',    mediaType: parsed.mediaType, data: parsed.data, mimeType: parsed.mimeType || '', fileName: parsed.fileName || '' };
    if (parsed?.type === 'reaction') return { ...base, msgType: 'reaction', targetId: parsed.targetId, emoji: parsed.emoji };
    if (parsed?.type === 'edit')     return { ...base, msgType: 'edit',     targetId: parsed.targetId, newText: parsed.newText };
    if (parsed?.type === 'delete')   return { ...base, msgType: 'delete',   targetId: parsed.targetId };
    if (parsed?.type === 'reply')    return { ...base, msgType: 'reply',    replyToId: parsed.replyToId, replyToText: parsed.replyToText, text: parsed.text };

    return { ...base, msgType: 'text', text: raw };
  } catch { return null; }
}
