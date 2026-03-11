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
import { hexToBytes, cacheMessage, cacheMessages } from './identity';

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
      if (newMsgs.length) cacheMessages(newMsgs).catch(() => {});
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
    if (d) { cacheMessage(d).catch(() => {}); onMessage(d); }
  });
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export function fetchIncomingRequests(myPubkeyHex, myPrivkeyHex, sinceTs = 0) {
  return new Promise((resolve) => {
    const requests = [], open = getOpenRelays();
    if (open.size === 0) return resolve([]);
    let eoseCount = 0;
    const unsub = subscribe(
      [{ kinds: [14000], '#p': [myPubkeyHex], ...(sinceTs ? { since: sinceTs } : {}) }],
      ev => {
        try {
          const p = JSON.parse(decryptDM(ev.content, myPrivkeyHex, ev.pubkey));
          if (p.type === 'chat_request') requests.push({ fromPubkey: ev.pubkey, displayName: p.displayName || '', ts: ev.created_at * 1000, eventId: ev.id });
        } catch {}
      },
      () => { eoseCount++; if (eoseCount >= open.size) { unsub(); resolve(requests); } }
    );
    setTimeout(() => { unsub(); resolve(requests); }, 7000);
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
