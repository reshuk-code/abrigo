'use client';

/**
 * ShareProfileModal.js
 * Shows a QR code of the user's npub + social share links.
 * Uses a pure-JS QR code generator (no extra npm package needed).
 * The QR code encodes:  nostr:<npub>
 * which standard Nostr clients can deep-link into.
 */

import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────
   Tiny self-contained QR encoder
   (Reed-Solomon + mask pattern, supports up to ~80 chars of alphanumeric)
   We rely on the browser's Canvas API to draw it.
   For longer npub strings we use a simple open-source QR lib loaded from
   a data-URL style inline script — actually we'll use qrcode-generator
   loaded via dynamic import from unpkg (allowed by network config).
───────────────────────────────────────────────*/

function QRCanvas({ value, size = 200 }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    let cancelled = false;

    // Dynamically load qrcode-generator from CDN
    const scriptId = '__qr_gen__';
    const load = () =>
      new Promise((res) => {
        if (window.qrcode) return res(window.qrcode);
        if (document.getElementById(scriptId)) {
          // already loading — poll
          const t = setInterval(() => { if (window.qrcode) { clearInterval(t); res(window.qrcode); } }, 50);
          return;
        }
        const s = document.createElement('script');
        s.id = scriptId;
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => res(window.qrcode || window.QRCode);
        s.onerror = () => res(null);
        document.head.appendChild(s);
      });

    // Use a canvas-based approach with the qrcode npm package available via dynamic import
    const draw = async () => {
      try {
        // Use QRious — lightweight, canvas-based
        let QRious = window.__QRious__;
        if (!QRious) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js';
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
          });
          QRious = window.QRious;
          window.__QRious__ = QRious;
        }
        if (cancelled || !canvasRef.current) return;
        new QRious({
          element: canvasRef.current,
          value,
          size,
          background: '#ffffff',
          foreground: '#1a1a2e',
          level: 'M',
        });
      } catch {
        if (!cancelled) setError(true);
      }
    };

    draw();
    return () => { cancelled = true; };
  }, [value, size]);

  if (error) {
    return (
      <div style={{ width: size, height: size, background: '#fff', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 28 }}>📷</span>
        <p style={{ fontSize: 11, color: '#666', textAlign: 'center', padding: '0 12px' }}>QR unavailable offline</p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ borderRadius: 12, display: 'block' }}
    />
  );
}

/* ─── Social share helpers ─── */
function shareLinks(npub, displayName) {
  const joinUrl = `https://abrigo-w3.antqr.xyz/join/${npub}`;
  const text = encodeURIComponent(`Chat with me on Abrigo — a private, encrypted messenger.\n\nMy Nostr address: ${npub}\n\nJoin here 👇`);
  const url   = encodeURIComponent(joinUrl);

  return [
    {
      label: 'WhatsApp',
      color: '#25D366',
      bg:    'rgba(37,211,102,.1)',
      border:'rgba(37,211,102,.25)',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.985-1.306A9.942 9.942 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 11.999 2zm0 18c-1.66 0-3.196-.463-4.5-1.265l-.322-.19-3.349.878.893-3.264-.207-.335A7.954 7.954 0 014 12c0-4.418 3.58-8 8-8s8 3.582 8 8-3.58 8-8 8z"/>
        </svg>
      ),
      href: `https://wa.me/?text=${text}%0A${url}`,
    },
    {
      label: 'Telegram',
      color: '#2AABEE',
      bg:    'rgba(42,171,238,.1)',
      border:'rgba(42,171,238,.25)',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.69 7.96c-.12.56-.45.7-.91.43l-2.52-1.86-1.22 1.17c-.13.13-.25.25-.52.25l.18-2.58 4.72-4.27c.2-.18-.05-.28-.32-.1L7.4 14.71 4.96 13.97c-.55-.17-.56-.55.12-.81l8.92-3.44c.46-.17.86.11.64.81v.27z"/>
        </svg>
      ),
      href: `https://t.me/share/url?url=${url}&text=${text}`,
    },
    {
      label: 'X / Twitter',
      color: '#fff',
      bg:    'rgba(255,255,255,.08)',
      border:'rgba(255,255,255,.18)',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      href: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    },
    {
      label: 'Facebook',
      color: '#1877F2',
      bg:    'rgba(24,119,242,.1)',
      border:'rgba(24,119,242,.25)',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078V12.07h3.047V9.413c0-3.018 1.793-4.685 4.533-4.685 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.927-1.956 1.877v2.255h3.328l-.532 3.493h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
        </svg>
      ),
      href: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    },
  ];
}

/* ─── Main modal ─── */
export default function ShareProfileModal({ identity, open, onClose }) {
  const [copied, setCopied] = useState('');

  if (!open || !identity) return null;

  const npub     = identity.npub;
  const name     = identity.displayName || 'me';
  const joinUrl  = `https://abrigo-w3.antqr.xyz/join/${npub}`;
  const nostrUri = `nostr:${npub}`;

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); } catch {}
    setCopied(label);
    setTimeout(() => setCopied(c => c === label ? '' : c), 2000);
  };

  const links = shareLinks(npub, name);

  return (
    <>
      <style>{`
        @keyframes modalIn { from{opacity:0;transform:scale(.94) translateY(10px)} to{opacity:1;transform:none} }
        @keyframes bgIn    { from{opacity:0} to{opacity:1} }
        .share-modal-bg  { animation: bgIn .18s ease }
        .share-modal-card{ animation: modalIn .22s cubic-bezier(.34,1.3,.64,1) }
      `}</style>

      {/* Backdrop */}
      <div
        className="share-modal-bg"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,.78)', backdropFilter: 'blur(14px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}
      >
        {/* Card */}
        <div
          className="share-modal-card"
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 420,
            background: 'linear-gradient(145deg,#141416,#0f0f12)',
            border: '1px solid rgba(255,255,255,.09)',
            borderRadius: 22,
            overflow: 'hidden',
            boxShadow: '0 40px 80px rgba(0,0,0,.8)',
          }}
        >
          {/* Header */}
          <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ color: 'rgba(255,255,255,.88)', fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Share your profile</h2>
              <p style={{ color: 'rgba(255,255,255,.28)', fontSize: 12 }}>Let friends find you on Abrigo</p>
            </div>
            <button
              onClick={onClose}
              style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 17 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.12)'; e.currentTarget.style.color = 'rgba(255,255,255,.8)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = 'rgba(255,255,255,.4)'; }}
            >×</button>
          </div>

          <div style={{ padding: '20px 22px 22px' }}>
            {/* QR code */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div style={{ padding: 12, background: '#fff', borderRadius: 16, boxShadow: '0 0 0 1px rgba(99,102,241,.25), 0 8px 28px rgba(0,0,0,.4)' }}>
                <QRCanvas value={nostrUri} size={180} />
              </div>
            </div>

            <p style={{ color: 'rgba(255,255,255,.22)', fontSize: 11, textAlign: 'center', marginBottom: 16 }}>
              Scan with any Nostr client to add you instantly
            </p>

            {/* Copy buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {/* Copy npub */}
              <button
                onClick={() => copy(npub, 'npub')}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 11, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.07)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
              >
                <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="4" width="9" height="9" rx="1.5" stroke="rgba(139,92,246,.8)" strokeWidth="1.2"/><path d="M4 4V2.5A1.5 1.5 0 015.5 1H11.5A1.5 1.5 0 0113 2.5v6A1.5 1.5 0 0111.5 10H10" stroke="rgba(139,92,246,.8)" strokeWidth="1.2"/></svg>
                </div>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 12.5, fontWeight: 500 }}>Copy npub key</p>
                  <p style={{ color: 'rgba(255,255,255,.25)', fontSize: 10.5, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{npub.slice(0, 36)}…</p>
                </div>
                <span style={{ fontSize: 11, color: copied === 'npub' ? '#34d399' : 'rgba(255,255,255,.3)', fontWeight: copied === 'npub' ? 600 : 400 }}>{copied === 'npub' ? '✓ Copied' : 'Copy'}</span>
              </button>

              {/* Copy join link */}
              <button
                onClick={() => copy(joinUrl, 'link')}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 11, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.07)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
              >
                <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M6 8l-2 2a2.83 2.83 0 000 4 2.83 2.83 0 004 0l2-2" stroke="rgba(52,211,153,.8)" strokeWidth="1.2" strokeLinecap="round"/><path d="M8 6l2-2a2.83 2.83 0 000-4 2.83 2.83 0 00-4 0L4 2" stroke="rgba(52,211,153,.8)" strokeWidth="1.2" strokeLinecap="round"/><path d="M5 9l4-4" stroke="rgba(52,211,153,.8)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                </div>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 12.5, fontWeight: 500 }}>Copy join link</p>
                  <p style={{ color: 'rgba(255,255,255,.25)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{joinUrl}</p>
                </div>
                <span style={{ fontSize: 11, color: copied === 'link' ? '#34d399' : 'rgba(255,255,255,.3)', fontWeight: copied === 'link' ? 600 : 400 }}>{copied === 'link' ? '✓ Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
              <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 10.5, fontWeight: 500 }}>SHARE ON</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
            </div>

            {/* Social buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {links.map(l => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 13px', borderRadius: 11,
                    background: l.bg, border: `1px solid ${l.border}`,
                    color: l.color, textDecoration: 'none',
                    fontSize: 12.5, fontWeight: 600,
                    transition: 'all .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.2)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'none'; }}
                >
                  {l.icon}
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
