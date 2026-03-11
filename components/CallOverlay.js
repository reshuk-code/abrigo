'use client';
/**
 * components/CallOverlay.js
 *
 * Full-screen call overlay. Handles both outgoing and incoming calls.
 * Incoming ring banner is separate (IncomingCallBanner) and shown
 * in the chat header area.
 *
 * Props:
 *   callSession   — object returned by createCallSession (or null)
 *   callState     — 'ringing'|'connecting'|'active'|'ended'|'failed'
 *   peerName      — display name of peer
 *   peerPubkey    — peer pubkey hex (for avatar)
 *   isVideo       — bool
 *   onHangup      — () => void
 *   localStreamRef  — React ref whose .current = MediaStream (local)
 *   remoteStreamRef — React ref whose .current = MediaStream (remote)
 */

import { useEffect, useRef, useState } from 'react';

// ── gradient helper (same as in page.js) ──────────────────────────────────────
const GRADIENTS = [
  ['#6366f1','#8b5cf6'],['#ec4899','#f43f5e'],['#14b8a6','#06b6d4'],
  ['#f59e0b','#ef4444'],['#10b981','#3b82f6'],['#a855f7','#ec4899'],
  ['#f97316','#facc15'],['#06b6d4','#6366f1'],
];
function avatarGrad(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
  const [a, b] = GRADIENTS[Math.abs(h) % GRADIENTS.length];
  return `linear-gradient(135deg,${a},${b})`;
}

// ── Duration timer ─────────────────────────────────────────────────────────────
function useDuration(running) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) { setSecs(0); return; }
    const id = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Video element that auto-plays a MediaStream ────────────────────────────────
function VideoEl({ stream, muted = false, style = {} }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} style={{ ...style }} />;
}

// ─── Main overlay ──────────────────────────────────────────────────────────────
export function CallOverlay({
  callSession,
  callState,
  peerName,
  peerPubkey,
  isVideo,
  onHangup,
  localStream,
  remoteStream,
}) {
  const [micMuted, setMicMuted] = useState(false);
  const [camOff,   setCamOff]   = useState(false);
  const duration = useDuration(callState === 'active');

  if (!callState || callState === 'idle') return null;

  const toggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    callSession?.setMicMuted(next);
  };
  const toggleCam = () => {
    const next = !camOff;
    setCamOff(next);
    callSession?.setCamOff(next);
  };

  const stateLabel = {
    ringing:    'Ringing…',
    connecting: 'Connecting…',
    active:     duration,
    ended:      'Call ended',
    failed:     'Call failed',
  }[callState] ?? callState;

  const showEndedBriefly = callState === 'ended' || callState === 'failed';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: isVideo && remoteStream
        ? 'transparent'
        : 'linear-gradient(160deg,#0d0d10 0%,#0a0a0d 100%)',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes callPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,.5); }
          50%      { box-shadow: 0 0 0 22px rgba(99,102,241,0); }
        }
        @keyframes callFadeIn { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:none} }
        .call-overlay-in { animation: callFadeIn .25s cubic-bezier(.34,1.1,.64,1); }
        .ctrl-btn { transition: all .15s; }
        .ctrl-btn:hover { filter: brightness(1.2); transform: scale(1.07); }
        .ctrl-btn:active { transform: scale(.95); }
      `}</style>

      {/* ── Remote video (full-bleed background) ── */}
      {isVideo && remoteStream && (
        <VideoEl
          stream={remoteStream}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', background: '#000',
          }}
        />
      )}

      {/* ── Dark scrim for video mode ── */}
      {isVideo && remoteStream && (
        <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.35)', backdropFilter:'blur(0px)' }}/>
      )}

      {/* ── Local video pip (video mode only) ── */}
      {isVideo && localStream && !camOff && (
        <div style={{
          position: 'absolute', bottom: 110, right: 20,
          width: 110, height: 160, borderRadius: 16,
          overflow: 'hidden', border: '2px solid rgba(255,255,255,.15)',
          boxShadow: '0 8px 28px rgba(0,0,0,.5)', zIndex: 10,
        }}>
          <VideoEl stream={localStream} muted style={{ width:'100%', height:'100%', objectFit:'cover', transform:'scaleX(-1)' }} />
        </div>
      )}

      {/* ── Center card (audio mode / no remote video yet) ── */}
      {(!isVideo || !remoteStream) && (
        <div className="call-overlay-in" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
          padding: '40px 48px', borderRadius: 28,
          background: 'rgba(255,255,255,.035)',
          border: '1px solid rgba(255,255,255,.08)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 32px 80px rgba(0,0,0,.6)',
          minWidth: 280,
        }}>
          {/* Avatar with pulse ring */}
          <div style={{ position: 'relative', marginBottom: 4 }}>
            {callState === 'ringing' && (
              <div style={{
                position: 'absolute', inset: -14, borderRadius: '50%',
                border: '2px solid rgba(99,102,241,.35)',
                animation: 'callPulse 1.8s ease-in-out infinite',
              }}/>
            )}
            <div style={{
              width: 80, height: 80, borderRadius: 24,
              background: avatarGrad(peerPubkey || ''),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, fontWeight: 700, color: '#fff',
              boxShadow: '0 8px 28px rgba(0,0,0,.4)',
            }}>
              {(peerName?.[0] || '?').toUpperCase()}
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 20, fontWeight: 600, marginBottom: 6 }}>{peerName}</p>
            <p style={{ color: callState === 'failed' ? '#f87171' : 'rgba(255,255,255,.38)', fontSize: 13.5 }}>
              {stateLabel}
            </p>
          </div>

          {/* Call type badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 99,
            background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.2)',
          }}>
            {isVideo ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M1 5a2 2 0 012-2h7a2 2 0 012 2v6a2 2 0 01-2 2H3a2 2 0 01-2-2V5z" stroke="rgba(139,92,246,.8)" strokeWidth="1.3"/><path d="M12 6.5l3-2v7l-3-2v-3z" stroke="rgba(139,92,246,.8)" strokeWidth="1.3" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2a1 1 0 00-1 1v1.5C2 10.351 5.649 14 10.5 14H12a1 1 0 001-1v-2.5a1 1 0 00-1-1l-2.5-.5a1 1 0 00-1 .5l-.5 1C6.5 10 6 9.5 5.5 8l1-.5a1 1 0 00.5-1L6.5 4a1 1 0 00-1-1H3z" stroke="rgba(139,92,246,.8)" strokeWidth="1.3"/></svg>
            )}
            <span style={{ color: 'rgba(139,92,246,.8)', fontSize: 11, fontWeight: 500 }}>
              {isVideo ? 'Video call' : 'Voice call'} · E2E encrypted
            </span>
          </div>
        </div>
      )}

      {/* ── State label on video mode ── */}
      {isVideo && remoteStream && (
        <div style={{
          position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        }}>
          <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 16, fontWeight: 600 }}>{peerName}</p>
          <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>{stateLabel}</p>
        </div>
      )}

      {/* ── Control bar ── */}
      {!showEndedBriefly && (
        <div style={{
          position: 'absolute', bottom: 36,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          {/* Mic */}
          <button className="ctrl-btn" onClick={toggleMic} title={micMuted ? 'Unmute' : 'Mute'} style={{
            width: 54, height: 54, borderRadius: '50%',
            background: micMuted ? 'rgba(239,68,68,.18)' : 'rgba(255,255,255,.1)',
            border: `1.5px solid ${micMuted ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.12)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: micMuted ? '#f87171' : 'rgba(255,255,255,.8)',
          }}>
            {micMuted ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/><path d="M4 10a6 6 0 0012 0M10 16v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/><path d="M4 10a6 6 0 0012 0M10 16v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            )}
          </button>

          {/* Hang up */}
          <button className="ctrl-btn" onClick={onHangup} title="End call" style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg,#ef4444,#dc2626)',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 6px 24px rgba(239,68,68,.45)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="currentColor"/>
            </svg>
          </button>

          {/* Cam (video only) */}
          {isVideo && (
            <button className="ctrl-btn" onClick={toggleCam} title={camOff ? 'Turn on camera' : 'Turn off camera'} style={{
              width: 54, height: 54, borderRadius: '50%',
              background: camOff ? 'rgba(239,68,68,.18)' : 'rgba(255,255,255,.1)',
              border: `1.5px solid ${camOff ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.12)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: camOff ? '#f87171' : 'rgba(255,255,255,.8)',
            }}>
              {camOff ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 6a2 2 0 012-2h7a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" stroke="currentColor" strokeWidth="1.4"/><path d="M14 7.5l4-2.5v10l-4-2.5v-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M2 2l16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 6a2 2 0 012-2h7a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" stroke="currentColor" strokeWidth="1.4"/><path d="M14 7.5l4-2.5v10l-4-2.5v-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
              )}
            </button>
          )}
        </div>
      )}

      {/* ── Ended / failed dismiss ── */}
      {showEndedBriefly && (
        <div style={{ position: 'absolute', bottom: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <p style={{ color: callState === 'failed' ? '#f87171' : 'rgba(255,255,255,.5)', fontSize: 14 }}>
            {callState === 'failed' ? 'Call failed' : 'Call ended'}
          </p>
          <button onClick={onHangup} className="ctrl-btn" style={{
            padding: '10px 28px', borderRadius: 12,
            background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)',
            color: 'rgba(255,255,255,.7)', fontSize: 13.5,
          }}>Close</button>
        </div>
      )}
    </div>
  );
}

// ─── Incoming call banner ──────────────────────────────────────────────────────
/**
 * IncomingCallBanner — shown at top of chat when a call arrives.
 *
 * Props:
 *   callerName   — string
 *   callerPubkey — hex
 *   isVideo      — bool
 *   onAccept     — () => void
 *   onDecline    — () => void
 */
export function IncomingCallBanner({ callerName, callerPubkey, isVideo, onAccept, onDecline }) {
  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 900, display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 18px',
      background: 'rgba(14,14,18,.96)',
      border: '1px solid rgba(99,102,241,.3)',
      borderRadius: 18,
      boxShadow: '0 12px 48px rgba(0,0,0,.7)',
      backdropFilter: 'blur(16px)',
      animation: 'callFadeIn .22s cubic-bezier(.34,1.1,.64,1)',
      minWidth: 300, maxWidth: '90vw',
    }}>
      <style>{`
        @keyframes callFadeIn { from{opacity:0;transform:translateX(-50%) translateY(-10px) scale(.96)} to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)} }
        @keyframes ringShake { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-12deg)} 40%{transform:rotate(12deg)} 60%{transform:rotate(-8deg)} 80%{transform:rotate(8deg)} }
      `}</style>

      {/* Ringing icon */}
      <div style={{
        width: 42, height: 42, borderRadius: 13, flexShrink: 0,
        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(99,102,241,.4)',
        animation: 'ringShake 1s ease infinite',
      }}>
        {isVideo ? (
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M2 7a2.5 2.5 0 012.5-2.5h7A2.5 2.5 0 0114 7v6a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 012 13V7z" fill="white" fillOpacity=".9"/><path d="M14 8.5l4-2.5v10l-4-2.5v-5z" fill="white" fillOpacity=".7"/></svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="white" fillOpacity=".9"/></svg>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 14, fontWeight: 600 }}>{callerName}</p>
        <p style={{ color: 'rgba(139,92,246,.8)', fontSize: 12, marginTop: 1 }}>
          Incoming {isVideo ? 'video' : 'voice'} call…
        </p>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onDecline} style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'rgba(239,68,68,.15)', border: '1.5px solid rgba(239,68,68,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#f87171', transition: 'all .15s',
        }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.3)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,.15)'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="currentColor"/></svg>
        </button>
        <button onClick={onAccept} style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'rgba(52,211,153,.15)', border: '1.5px solid rgba(52,211,153,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#34d399', transition: 'all .15s',
        }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(52,211,153,.3)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(52,211,153,.15)'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="currentColor"/></svg>
        </button>
      </div>
    </div>
  );
}
