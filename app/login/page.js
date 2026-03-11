'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { generateIdentity, importIdentity, isValidNsec } from '@/lib/identity';

export default function LoginPage() {
  const [tab,         setTab]         = useState('new');
  const [displayName, setDisplayName] = useState('');
  const [nsecInput,   setNsecInput]   = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [showNsec,    setShowNsec]    = useState(false);
  const [importName,  setImportName]  = useState('');

  // live validation state for the nsec input
  const nsecTrimmed = nsecInput.trim();
  const nsecValid   = nsecTrimmed.length > 0 && isValidNsec(nsecTrimmed);
  const nsecInvalid = nsecTrimmed.length > 10 && !nsecValid; // only show red after they've typed enough
  const { login } = useAuth();
  const router = useRouter();

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const id = await generateIdentity();
      if (displayName.trim()) {
        const { setDisplayName: saveName } = await import('@/lib/identity');
        await saveName(displayName.trim(), true);
        id.displayName = displayName.trim();
      } else {
        id.displayName = id.pubkeyHex.slice(0, 8);
      }
      await login(id);
      router.replace('/chat/_');
    } catch { setError('Failed to generate identity. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = nsecInput.trim();
    if (!trimmed) { setError('Please paste your nsec key.'); return; }
    if (!trimmed.startsWith('nsec1')) { setError('Key must start with "nsec1" — make sure you\'re pasting your private key, not your public key (npub).'); return; }
    if (!isValidNsec(trimmed)) { setError('Invalid nsec key — the key appears malformed. Check you copied it completely.'); return; }
    setLoading(true);
    try {
      const id = await importIdentity(trimmed);
      // If user provided a name on import, save and publish it.
      // Otherwise, the syncData called inside login() will fetch the existing name from relays.
      if (importName.trim()) {
        const { setDisplayName: saveName } = await import('@/lib/identity');
        await saveName(importName.trim(), true);
        id.displayName = importName.trim();
      }
      await login(id);
      router.replace('/chat/_');
    } catch (err) {
      console.error('import error', err);
      setError('Could not import key. Make sure you copied the full nsec key correctly.');
    }
    finally { setLoading(false); }
  };

  const features = [
    {
      color: 'rgba(99,102,241,.75)',
      bg: 'rgba(99,102,241,.08)',
      border: 'rgba(99,102,241,.15)',
      icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 2a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM3 15c0-2.76 2.686-5 6-5s6 2.24 6 5" stroke="rgba(99,102,241,.8)" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      title: 'Zero-account identity',
      desc: 'One keypair — no phone, no email, no sign-up.',
    },
    {
      color: 'rgba(52,211,153,.75)',
      bg: 'rgba(52,211,153,.07)',
      border: 'rgba(52,211,153,.15)',
      icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="3" y="9" width="12" height="8" rx="2" stroke="rgba(52,211,153,.8)" strokeWidth="1.4"/><path d="M6 9V6.5a3 3 0 016 0V9" stroke="rgba(52,211,153,.8)" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      title: 'NIP-44 end-to-end encrypted',
      desc: 'Not even relays can read your messages.',
    },
    {
      color: 'rgba(251,191,36,.75)',
      bg: 'rgba(251,191,36,.07)',
      border: 'rgba(251,191,36,.14)',
      icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="rgba(251,191,36,.8)" strokeWidth="1.4"/><circle cx="9" cy="9" r="3" stroke="rgba(251,191,36,.8)" strokeWidth="1.4"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2" stroke="rgba(251,191,36,.8)" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      title: 'Decentralized relays',
      desc: 'No company controls your data.',
    },
    {
      color: 'rgba(168,85,247,.75)',
      bg: 'rgba(168,85,247,.07)',
      border: 'rgba(168,85,247,.15)',
      icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M3 9l4 4 8-8" stroke="rgba(168,85,247,.8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      title: 'Import anywhere',
      desc: 'Your nsec restores your full history instantly.',
    },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; font-family: 'DM Sans', -apple-system, sans-serif; }
        input::placeholder { color: rgba(255,255,255,.2); }
        input:focus { outline: none; }
        button { cursor: pointer; border: none; font-family: 'DM Sans', sans-serif; }
        ::selection { background: rgba(99,102,241,.3); color: #fff; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 99px; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(16px) scale(.98); } to { opacity:1; transform:none; } }
        @keyframes floatY  { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-7px); } }
        @keyframes glow    { 0%,100%{ opacity:.5; } 50%{ opacity:1; } }
        @keyframes shimmer { 0%{ background-position:-400px 0; } 100%{ background-position:400px 0; } }
        .form-card  { animation: fadeUp .32s cubic-bezier(.34,1.1,.64,1) both; }
        .cta-btn    { transition: all .2s cubic-bezier(.34,1.2,.64,1); }
        .cta-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 32px rgba(99,102,241,.5) !important; }
        .cta-btn:active:not(:disabled){ transform: scale(.97); }
        .tab-btn    { transition: all .18s; }
        .feat-row   { transition: background .15s; border-radius: 12px; padding: 10px 12px; margin: 0 -12px; }
        .feat-row:hover { background: rgba(255,255,255,.03); }
        .feat-icon  { transition: transform .2s cubic-bezier(.34,1.4,.64,1); }
        .feat-row:hover .feat-icon { transform: scale(1.12) rotate(-6deg); }
        input       { transition: border-color .2s, box-shadow .2s !important; }
        input:focus { border-color: rgba(99,102,241,.55) !important; box-shadow: 0 0 0 3px rgba(99,102,241,.1) !important; }
        @media (max-width: 860px) { .side-panel { display: none !important; } }
      `}</style>

      <div style={{ minHeight:'100vh', background:'#080809', display:'flex', fontFamily:"'DM Sans',sans-serif", position:'relative', overflow:'hidden' }}>

        {/* Ambient glows */}
        <div style={{ position:'fixed', top:-200, left:-200, width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.08) 0%,transparent 65%)', pointerEvents:'none' }}/>
        <div style={{ position:'fixed', bottom:-160, right:-120, width:520, height:520, borderRadius:'50%', background:'radial-gradient(circle,rgba(168,85,247,.06) 0%,transparent 65%)', pointerEvents:'none' }}/>
        <div style={{ position:'fixed', top:'40%', left:'40%', width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.04) 0%,transparent 65%)', pointerEvents:'none' }}/>

        {/* ════════════ LEFT PANEL ════════════ */}
        <div className="side-panel" style={{ width:460, flexShrink:0, display:'flex', flexDirection:'column', justifyContent:'space-between', padding:'44px 42px', borderRight:'1px solid rgba(255,255,255,.05)', background:'rgba(0,0,0,.15)', backdropFilter:'blur(24px)', position:'relative', zIndex:1 }}>

          {/* Brand */}
          <div style={{ display:'flex', alignItems:'center', gap:11 }}>
            <div style={{ width:36, height:36, borderRadius:11, overflow:'hidden', flexShrink:0, boxShadow:'0 4px 14px rgba(99,102,241,.35)' }}>
              <img src="/logo.svg" alt="abrigo" style={{ width:'100%', height:'100%', display:'block' }} />
            </div>
            <span style={{ color:'rgba(255,255,255,.8)', fontSize:17, fontWeight:600, letterSpacing:'-.025em' }}>abrigo</span>
          </div>

          {/* Feature list */}
          <div>
            <p style={{ color:'rgba(255,255,255,.18)', fontSize:10, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:22 }}>Why abrigo</p>
            {features.map((f, i) => (
              <div key={i} className="feat-row" style={{ display:'flex', gap:13, marginBottom:6, alignItems:'flex-start' }}>
                <div className="feat-icon" style={{ width:34, height:34, borderRadius:10, background:f.bg, border:`1px solid ${f.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {f.icon}
                </div>
                <div style={{ paddingTop:2 }}>
                  <p style={{ color:'rgba(255,255,255,.65)', fontSize:13, fontWeight:500, marginBottom:2 }}>{f.title}</p>
                  <p style={{ color:'rgba(255,255,255,.25)', fontSize:12, lineHeight:1.65 }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ display:'flex', alignItems:'center', gap:9, padding:'11px 14px', background:'rgba(52,211,153,.04)', border:'1px solid rgba(52,211,153,.1)', borderRadius:11 }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:'#34d399', boxShadow:'0 0 6px #34d399', flexShrink:0, animation:'glow 2.5s ease infinite' }}/>
            <span style={{ color:'rgba(52,211,153,.65)', fontSize:11.5, fontWeight:500 }}>Built on the open Nostr protocol</span>
          </div>
        </div>

        {/* ════════════ RIGHT PANEL ════════════ */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 24px', position:'relative', zIndex:1 }}>
          <div className="form-card" style={{ width:'100%', maxWidth:390 }}>

            {/* Mobile brand (shown when sidebar hidden) */}
            <div className="mobile-brand" style={{ display:'none', alignItems:'center', justifyContent:'center', gap:10, marginBottom:28 }}>
              <style>{`.mobile-brand { @media (max-width:860px) { display:flex !important; } }`}</style>
              <div style={{ width:40, height:40, borderRadius:13, overflow:'hidden', boxShadow:'0 4px 16px rgba(99,102,241,.4)' }}>
                <img src="/logo.svg" alt="abrigo" style={{ width:'100%', height:'100%', display:'block' }} />
              </div>
              <span style={{ color:'rgba(255,255,255,.8)', fontSize:20, fontWeight:600, letterSpacing:'-.025em' }}>abrigo</span>
            </div>

            {/* Hero logo + heading */}
            <div style={{ textAlign:'center', marginBottom:30 }}>
              <div style={{ width:72, height:72, borderRadius:22, overflow:'hidden', margin:'0 auto 18px', animation:'floatY 5s ease-in-out infinite', boxShadow:'0 8px 32px rgba(99,102,241,.3)' }}>
                <img src="/logo.svg" alt="abrigo" style={{ width:'100%', height:'100%', display:'block' }} />
              </div>
              <h1 style={{ color:'rgba(255,255,255,.9)', fontSize:23, fontWeight:600, letterSpacing:'-.03em', marginBottom:8 }}>
                Welcome to abrigo
              </h1>
              <p style={{ color:'rgba(255,255,255,.3)', fontSize:13.5, lineHeight:1.65 }}>
                Private, decentralized messaging.<br/>No accounts. No servers. Just keys.
              </p>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.07)', borderRadius:13, padding:4, marginBottom:22, gap:3 }}>
              {[['new','✦  New user'],['import','↩  Import key']].map(([id, label]) => (
                <button key={id} className="tab-btn" onClick={() => { setTab(id); setError(''); }}
                  style={{
                    flex:1, padding:'9px 12px', borderRadius:10, fontSize:13, fontWeight:500,
                    background: tab===id ? 'rgba(99,102,241,.15)' : 'transparent',
                    color:      tab===id ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.3)',
                    border:     tab===id ? '1px solid rgba(99,102,241,.28)' : '1px solid transparent',
                    boxShadow:  tab===id ? '0 2px 8px rgba(99,102,241,.15)' : 'none',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── NEW USER FORM ── */}
            {tab === 'new' && (
              <form onSubmit={handleGenerate}>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>
                  Your name&nbsp;<span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'rgba(255,255,255,.18)', fontSize:11 }}>(optional)</span>
                </label>
                <div style={{ position:'relative', marginBottom:16 }}>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value.slice(0, 32))}
                    placeholder="e.g. Alice, reshuk…"
                    autoFocus
                    style={{ width:'100%', height:46, background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.08)', borderRadius:11, padding:'0 14px', color:'rgba(255,255,255,.9)', fontSize:14 }}
                  />
                  {displayName && (
                    <span style={{ position:'absolute', right:13, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,.2)', fontSize:11 }}>
                      {32 - displayName.length}
                    </span>
                  )}
                </div>

                <div style={{ background:'rgba(99,102,241,.05)', border:'1px solid rgba(99,102,241,.13)', borderRadius:11, padding:'11px 14px', marginBottom:18 }}>
                  <p style={{ color:'rgba(255,255,255,.35)', fontSize:12, lineHeight:1.7 }}>
                    A private key (nsec) will be generated and stored&nbsp;
                    <strong style={{ color:'rgba(255,255,255,.55)', fontWeight:500 }}>only on this device</strong>.
                    You can back it up from Settings anytime.
                  </p>
                </div>

                {error && <ErrorBox msg={error} />}

                <button type="submit" disabled={loading} className="cta-btn"
                  style={{ width:'100%', height:46, background: !loading ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : 'rgba(255,255,255,.06)', color: !loading ? '#fff' : 'rgba(255,255,255,.25)', fontSize:14, fontWeight:600, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow: !loading ? '0 4px 20px rgba(99,102,241,.38)' : 'none' }}>
                  {loading
                    ? <><Spinner />Generating…</>
                    : <>Generate my keypair <ArrowIcon /></>}
                </button>
              </form>
            )}

            {/* ── IMPORT FORM ── */}
            {tab === 'import' && (
              <form onSubmit={handleImport}>

                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>
                  Your nsec private key
                </label>
                <div style={{ position:'relative', marginBottom:8 }}>
                  <input
                    type={showNsec ? 'text' : 'password'}
                    value={nsecInput}
                    onChange={e => { setNsecInput(e.target.value); setError(''); }}
                    placeholder="nsec1…"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    style={{
                      width:'100%', height:46, background:'rgba(255,255,255,.04)',
                      border: `1.5px solid ${
                        nsecValid  ? 'rgba(52,211,153,.5)' :
                        nsecInvalid ? 'rgba(239,68,68,.45)' :
                        'rgba(255,255,255,.08)'
                      }`,
                      borderRadius:11, padding:'0 44px 0 14px',
                      color:'rgba(255,255,255,.88)', fontSize:12.5,
                      fontFamily:"'DM Mono',monospace", letterSpacing:'.03em',
                      boxShadow: nsecValid ? '0 0 0 3px rgba(52,211,153,.1)' : nsecInvalid ? '0 0 0 3px rgba(239,68,68,.08)' : 'none',
                      transition: 'border-color .2s, box-shadow .2s',
                    }}
                  />
                  {/* Valid / invalid indicator */}
                  {nsecValid && (
                    <span style={{ position:'absolute', right:44, top:'50%', transform:'translateY(-50%)', color:'#34d399', fontSize:13 }}>✓</span>
                  )}
                  {nsecInvalid && (
                    <span style={{ position:'absolute', right:44, top:'50%', transform:'translateY(-50%)', color:'#f87171', fontSize:13 }}>✗</span>
                  )}
                  <button type="button" onClick={() => setShowNsec(!showNsec)}
                    style={{ position:'absolute', right:13, top:'50%', transform:'translateY(-50%)', background:'none', padding:4, display:'flex', alignItems:'center', color:'rgba(255,255,255,.3)', transition:'color .15s' }}
                    onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,.65)'}
                    onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.3)'}>
                    {showNsec
                      ? <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
                    }
                  </button>
                </div>

                {/* Inline validation hint */}
                {nsecInvalid && (
                  <p style={{ color:'rgba(239,68,68,.7)', fontSize:11.5, marginBottom:10, paddingLeft:2 }}>
                    {!nsecTrimmed.startsWith('nsec') ? 'Key should start with "nsec1…"' : 'Key looks incomplete or invalid — check you copied it fully.'}
                  </p>
                )}
                {nsecValid && (
                  <p style={{ color:'rgba(52,211,153,.7)', fontSize:11.5, marginBottom:10, paddingLeft:2 }}>Key looks valid ✓</p>
                )}
                {!nsecValid && !nsecInvalid && <div style={{ marginBottom:10 }}/>}

                {/* Optional display name on import */}
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>
                  Your name&nbsp;<span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'rgba(255,255,255,.18)', fontSize:11 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={importName}
                  onChange={e => setImportName(e.target.value.slice(0, 32))}
                  placeholder="e.g. Alice, reshuk…"
                  style={{ width:'100%', height:42, background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.08)', borderRadius:11, padding:'0 14px', color:'rgba(255,255,255,.9)', fontSize:14, marginBottom:14 }}
                />

                <div style={{ display:'flex', gap:8, padding:'10px 13px', background:'rgba(239,68,68,.04)', border:'1px solid rgba(239,68,68,.1)', borderRadius:11, marginBottom:16 }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0, marginTop:1 }}><path d="M7 2L1.5 11.5h11L7 2z" stroke="rgba(239,68,68,.5)" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 6v2.5M7 10.5v.3" stroke="rgba(239,68,68,.5)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  <p style={{ color:'rgba(239,68,68,.6)', fontSize:12, lineHeight:1.7 }}>Never paste your nsec into sites you don't trust. This key is your complete identity.</p>
                </div>

                {error && <ErrorBox msg={error} />}

                <button type="submit" disabled={loading || !nsecTrimmed} className="cta-btn"
                  style={{ width:'100%', height:46, background: nsecTrimmed && !loading ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : 'rgba(255,255,255,.06)', color: nsecTrimmed && !loading ? '#fff' : 'rgba(255,255,255,.25)', fontSize:14, fontWeight:600, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow: nsecTrimmed && !loading ? '0 4px 20px rgba(99,102,241,.38)' : 'none' }}>
                  {loading
                    ? <><Spinner />Importing…</>
                    : <>Import &amp; enter app <ArrowIcon /></>}
                </button>
              </form>
            )}

            <p style={{ color:'rgba(255,255,255,.12)', fontSize:11, marginTop:20, lineHeight:1.8, textAlign:'center' }}>
              No data is sent to any server during onboarding.<br/>Everything stays on your device.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── tiny shared sub-components ── */
function Spinner() {
  return <div style={{ width:14, height:14, border:'2px solid rgba(255,255,255,.2)', borderTop:'2px solid #fff', borderRadius:'50%', animation:'spin .8s linear infinite', flexShrink:0 }}/>;
}
function ArrowIcon() {
  return <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M2 13L13 7.5 2 2v4.5l7 1-7 1V13z" fill="currentColor"/></svg>;
}
function ErrorBox({ msg }) {
  return (
    <div style={{ display:'flex', gap:7, padding:'9px 12px', background:'rgba(239,68,68,.07)', border:'1px solid rgba(239,68,68,.18)', borderRadius:9, marginBottom:14 }}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0, marginTop:1 }}><circle cx="7" cy="7" r="6" stroke="#f87171" strokeWidth="1.2"/><path d="M7 4.5v3M7 9.5v.3" stroke="#f87171" strokeWidth="1.3" strokeLinecap="round"/></svg>
      <p style={{ color:'#f87171', fontSize:12 }}>{msg}</p>
    </div>
  );
}
