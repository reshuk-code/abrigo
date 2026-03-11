'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { generateIdentity, importIdentity, isValidNsec } from '@/lib/identity';

export default function LoginPage() {
  const [tab, setTab]           = useState('new');
  const [displayName, setDisplayName] = useState('');
  const [nsecInput, setNsecInput] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [showNsec, setShowNsec] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const id = await generateIdentity();
      if (displayName.trim()) {
        const { setDisplayName: saveName } = await import('@/lib/identity');
        await saveName(displayName.trim());
        id.displayName = displayName.trim();
      } else {
        id.displayName = id.pubkeyHex.slice(0, 8);
      }
      await login(id);
      router.replace('/chat');
    } catch { setError('Failed to generate identity. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    setError('');
    if (!isValidNsec(nsecInput.trim())) { setError('Invalid nsec key — should start with "nsec1…"'); return; }
    setLoading(true);
    try {
      const id = await importIdentity(nsecInput.trim());
      id.displayName = id.pubkeyHex.slice(0, 8);
      await login(id);
      router.replace('/chat');
    } catch { setError('Could not import key. Make sure it is a valid nsec.'); }
    finally { setLoading(false); }
  };

  const features = [
    { icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 2a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM3 15c0-2.76 2.686-5 6-5s6 2.24 6 5" stroke="rgba(99,102,241,.7)" strokeWidth="1.3" strokeLinecap="round"/></svg>, title:'Zero-account identity', desc:'One keypair — no phone, no email, no sign-up. Your key is your passport, forever.' },
    { icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="3" y="9" width="12" height="8" rx="2" stroke="rgba(52,211,153,.7)" strokeWidth="1.3"/><path d="M6 9V6.5a3 3 0 016 0V9" stroke="rgba(52,211,153,.7)" strokeWidth="1.3" strokeLinecap="round"/></svg>, title:'NIP-44 end-to-end encrypted', desc:'X25519 + ChaCha20-Poly1305. Not even relays can read your messages.' },
    { icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="rgba(251,191,36,.7)" strokeWidth="1.3"/><circle cx="9" cy="9" r="3" stroke="rgba(251,191,36,.7)" strokeWidth="1.3"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2" stroke="rgba(251,191,36,.7)" strokeWidth="1.3" strokeLinecap="round"/></svg>, title:'Decentralized relays', desc:'Open Nostr protocol. No company controls your data or can shut you down.' },
    { icon: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M3 9l4 4 8-8" stroke="rgba(168,85,247,.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>, title:'Works on any device', desc:'Import your nsec anywhere and your full history reappears instantly.' },
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
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-8px); } }
        @keyframes glow { 0%,100%{ opacity:.5; } 50%{ opacity:1; } }
        .form-card { animation: fadeUp .3s cubic-bezier(.34,1.2,.64,1) forwards; }
        input:focus { border-color: rgba(99,102,241,.5) !important; box-shadow: 0 0 0 3px rgba(99,102,241,.1) !important; }
        .tab-btn { transition: all .18s; }
        .feature-row { transition: all .2s; }
        .feature-row:hover .feature-icon { transform: scale(1.1) rotate(-5deg); }
        .feature-icon { transition: transform .2s cubic-bezier(.34,1.4,.64,1); }
        .cta-btn { transition: all .2s cubic-bezier(.34,1.2,.64,1); }
        .cta-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(99,102,241,.45) !important; }
        ::selection { background: rgba(99,102,241,.3); color: #fff; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 99px; }
      `}</style>

      <div style={{ minHeight:'100vh', background:'#080809', display:'flex', fontFamily:"'DM Sans',sans-serif", position:'relative', overflow:'hidden' }}>

        {/* Background glows */}
        <div style={{ position:'fixed', top:-200, left:-200, width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(99,102,241,.07) 0%, transparent 65%)', pointerEvents:'none' }}/>
        <div style={{ position:'fixed', bottom:-150, right:-100, width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(168,85,247,.06) 0%, transparent 65%)', pointerEvents:'none' }}/>

        {/* ── LEFT PANEL ── */}
        <div style={{ width:460, flexShrink:0, display:'flex', flexDirection:'column', justifyContent:'space-between', padding:'48px 44px', borderRight:'1px solid rgba(255,255,255,.05)', background:'rgba(0,0,0,.2)', backdropFilter:'blur(20px)', position:'relative', zIndex:1 }}
          className="side-panel">
          <style>{`@media (max-width:860px){.side-panel{display:none!important}}`}</style>

          {/* Logo */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:11, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 16px rgba(99,102,241,.35)' }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H9l-3 2v-2H4a2 2 0 01-2-2V4z" fill="white" fillOpacity=".9"/>
              </svg>
            </div>
            <span style={{ color:'rgba(255,255,255,.75)', fontSize:16, fontWeight:600, letterSpacing:'-.02em' }}>abrigo</span>
          </div>

          {/* Feature list */}
          <div>
            <p style={{ color:'rgba(255,255,255,.18)', fontSize:10, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:28 }}>Why abrigo</p>
            {features.map((f, i) => (
              <div key={i} className="feature-row" style={{ display:'flex', gap:14, marginBottom:24, alignItems:'flex-start' }}>
                <div className="feature-icon" style={{ width:34, height:34, borderRadius:10, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.07)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {f.icon}
                </div>
                <div>
                  <p style={{ color:'rgba(255,255,255,.65)', fontSize:13, fontWeight:500, marginBottom:3, letterSpacing:'-.01em' }}>{f.title}</p>
                  <p style={{ color:'rgba(255,255,255,.25)', fontSize:12, lineHeight:1.7 }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer badge */}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'rgba(52,211,153,.04)', border:'1px solid rgba(52,211,153,.1)', borderRadius:10 }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:'#34d399', boxShadow:'0 0 6px #34d399', animation:'glow 2.5s ease infinite' }}/>
            <span style={{ color:'rgba(52,211,153,.65)', fontSize:11.5, fontWeight:500 }}>Built on open Nostr protocol</span>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 24px', position:'relative', zIndex:1 }}>
          <div className="form-card" style={{ width:'100%', maxWidth:380 }}>

            {/* Heading */}
            <div style={{ marginBottom:32, textAlign:'center' }}>
              <div style={{ width:52, height:52, borderRadius:16, background:'linear-gradient(135deg,rgba(99,102,241,.15),rgba(168,85,247,.15))', border:'1px solid rgba(99,102,241,.2)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', animation:'float 6s ease-in-out infinite' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6a3 3 0 013-3h12a3 3 0 013 3v9a3 3 0 01-3 3h-6l-5 3v-3H6a3 3 0 01-3-3V6z" fill="url(#lg1)" fillOpacity=".85"/>
                  <circle cx="8.5" cy="10.5" r="1.5" fill="white"/>
                  <circle cx="12" cy="10.5" r="1.5" fill="white"/>
                  <circle cx="15.5" cy="10.5" r="1.5" fill="white"/>
                  <defs>
                    <linearGradient id="lg1" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#6366f1"/><stop offset="1" stopColor="#a855f7"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h1 style={{ color:'rgba(255,255,255,.88)', fontSize:22, fontWeight:600, letterSpacing:'-.03em', marginBottom:7 }}>Welcome to abrigo</h1>
              <p style={{ color:'rgba(255,255,255,.28)', fontSize:13.5, lineHeight:1.6 }}>Private, decentralized messaging.<br/>No accounts. No servers. Just keys.</p>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.07)', borderRadius:12, padding:4, marginBottom:24, gap:3 }}>
              {[['new','✦ New user'],['import','↩ Import key']].map(([id,label]) => (
                <button key={id} className="tab-btn" onClick={() => { setTab(id); setError(''); }}
                  style={{ flex:1, padding:'9px 12px', borderRadius:9, fontSize:13, fontWeight:500, background: tab===id ? 'rgba(99,102,241,.15)' : 'transparent', color: tab===id ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.3)', border: tab===id ? '1px solid rgba(99,102,241,.25)' : '1px solid transparent', boxShadow: tab===id ? '0 2px 8px rgba(99,102,241,.15)' : 'none' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* New user form */}
            {tab === 'new' && (
              <form onSubmit={handleGenerate}>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>
                  Display Name <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'rgba(255,255,255,.18)', fontSize:11 }}>(optional)</span>
                </label>
                <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value.slice(0,32))}
                  placeholder="e.g. Alice, reshuk…" autoFocus
                  style={{ width:'100%', height:46, background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.08)', borderRadius:11, padding:'0 14px', color:'rgba(255,255,255,.88)', fontSize:14, marginBottom:14, transition:'all .2s' }}
                />

                <div style={{ background:'rgba(99,102,241,.04)', border:'1px solid rgba(99,102,241,.12)', borderRadius:11, padding:'12px 14px', marginBottom:18 }}>
                  <p style={{ color:'rgba(255,255,255,.35)', fontSize:12, lineHeight:1.7 }}>
                    A private key (nsec) will be generated and stored <strong style={{ color:'rgba(255,255,255,.55)' }}>only on this device</strong>. You can back it up from Settings anytime.
                  </p>
                </div>

                {error && (
                  <div style={{ display:'flex', gap:7, padding:'9px 12px', background:'rgba(239,68,68,.07)', border:'1px solid rgba(239,68,68,.18)', borderRadius:9, marginBottom:14 }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0, marginTop:1 }}><circle cx="7" cy="7" r="6" stroke="#f87171" strokeWidth="1.2"/><path d="M7 4.5v3M7 9.5v.3" stroke="#f87171" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    <p style={{ color:'#f87171', fontSize:12 }}>{error}</p>
                  </div>
                )}

                <button type="submit" disabled={loading} className="cta-btn"
                  style={{ width:'100%', height:46, background: !loading ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : 'rgba(255,255,255,.06)', color: !loading ? '#fff' : 'rgba(255,255,255,.25)', fontSize:14, fontWeight:600, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow: !loading ? '0 4px 18px rgba(99,102,241,.35)' : 'none' }}>
                  {loading
                    ? <><div style={{ width:14, height:14, border:'2px solid rgba(255,255,255,.2)', borderTop:'2px solid #fff', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>Generating…</>
                    : <>Generate my keypair <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M2 13L13 7.5 2 2v4.5l7 1-7 1V13z" fill="currentColor"/></svg></>
                  }
                </button>
              </form>
            )}

            {/* Import form */}
            {tab === 'import' && (
              <form onSubmit={handleImport}>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>
                  Your nsec private key
                </label>
                <div style={{ position:'relative', marginBottom:14 }}>
                  <input type={showNsec ? 'text' : 'password'} value={nsecInput}
                    onChange={e => { setNsecInput(e.target.value.trim()); setError(''); }}
                    placeholder="nsec1…" autoFocus autoComplete="off" spellCheck={false}
                    style={{ width:'100%', height:46, background:'rgba(255,255,255,.04)', border:`1.5px solid ${error ? 'rgba(239,68,68,.45)' : 'rgba(255,255,255,.08)'}`, borderRadius:11, padding:'0 44px 0 14px', color:'rgba(255,255,255,.85)', fontSize:12.5, fontFamily:"'DM Mono',monospace", letterSpacing:'.03em', transition:'all .2s' }}
                  />
                  <button type="button" onClick={() => setShowNsec(!showNsec)}
                    style={{ position:'absolute', right:13, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,.3)', background:'none', padding:4, display:'flex', alignItems:'center', transition:'color .15s' }}
                    onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,.6)'}
                    onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.3)'}>
                    {showNsec
                      ? <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
                    }
                  </button>
                </div>

                <div style={{ display:'flex', gap:8, padding:'11px 13px', background:'rgba(239,68,68,.04)', border:'1px solid rgba(239,68,68,.1)', borderRadius:11, marginBottom:18 }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0, marginTop:1 }}><path d="M7 2L1.5 11.5h11L7 2z" stroke="rgba(239,68,68,.5)" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 6v2.5M7 10.5v.3" stroke="rgba(239,68,68,.5)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  <p style={{ color:'rgba(239,68,68,.6)', fontSize:12, lineHeight:1.7 }}>Never paste your nsec into sites you don't trust. This key is your complete identity and cannot be reset.</p>
                </div>

                {error && (
                  <div style={{ display:'flex', gap:7, padding:'9px 12px', background:'rgba(239,68,68,.07)', border:'1px solid rgba(239,68,68,.18)', borderRadius:9, marginBottom:14 }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0, marginTop:1 }}><circle cx="7" cy="7" r="6" stroke="#f87171" strokeWidth="1.2"/><path d="M7 4.5v3M7 9.5v.3" stroke="#f87171" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    <p style={{ color:'#f87171', fontSize:12 }}>{error}</p>
                  </div>
                )}

                <button type="submit" disabled={loading || !nsecInput} className="cta-btn"
                  style={{ width:'100%', height:46, background: nsecInput && !loading ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : 'rgba(255,255,255,.06)', color: nsecInput && !loading ? '#fff' : 'rgba(255,255,255,.25)', fontSize:14, fontWeight:600, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow: nsecInput && !loading ? '0 4px 18px rgba(99,102,241,.35)' : 'none' }}>
                  {loading
                    ? <><div style={{ width:14, height:14, border:'2px solid rgba(255,255,255,.2)', borderTop:'2px solid #fff', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>Importing…</>
                    : <>Import &amp; enter app <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M2 13L13 7.5 2 2v4.5l7 1-7 1V13z" fill="currentColor"/></svg></>
                  }
                </button>
              </form>
            )}

            <p style={{ color:'rgba(255,255,255,.12)', fontSize:11, marginTop:22, lineHeight:1.8, textAlign:'center' }}>
              No data is sent to any server during onboarding.<br/>Everything stays on your device.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
