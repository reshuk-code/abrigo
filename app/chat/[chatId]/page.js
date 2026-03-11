'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  buildDMEvent, buildMediaDMEvent, buildReactionEvent, buildEditEvent,
  buildDeleteEvent, buildReplyEvent, publishEvent,
  fetchAndCacheDMs, subscribeToConversation,
  connectRelays, getRelays, saveRelays,
  buildRequestEvent, buildAcceptEvent, buildDeclineEvent,
  subscribeToRequests, fetchIncomingRequests,
  compressImageToBase64, audioBlobToBase64,
  buildGroupInviteEvent, buildGroupMessageEvent, buildGroupMediaEvent,
  fetchGroupMessages, subscribeToGroup, subscribeToGroupInvites,
} from '@/lib/nostr';
import { createCallSession, subscribeIncomingCalls } from '@/lib/webrtc';
import { CallOverlay, IncomingCallBanner } from '@/components/CallOverlay';
import ShareProfileModal from '@/components/ShareProfileModal';
import {
  getContacts, saveContact, removeContact,
  getCachedMessages, cacheMessage,
  npubToPubkeyHex, pubkeyHexToNpub,
  isValidNpub, isValidPubkeyHex,
  setRequestState, getRequestState, getAllRequestStates,
  getAllGroups, saveGroup, getGroup, deleteGroup,
  generateGroupId, generateGroupKey,
} from '@/lib/identity';

/* ─── avatar gradients ─── */
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

const EMOJI_REACTIONS = ['❤️','👍','😂','😮','😢','🔥'];

/* ─── SVG icons ─── */
const Icon = {
  settings: <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus:     <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  send:     <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M3 17L17 10 3 3v5.5l8 1.5-8 1.5V17z" fill="currentColor"/></svg>,
  image:    <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="7" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 14l4.5-4.5 3 3 2.5-2.5L18 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  mic:      <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/><path d="M4 10a6 6 0 0012 0M10 16v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  lock:     <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="5.5" width="9" height="6" rx="1.2" stroke="currentColor" strokeWidth="1"/><path d="M3.5 5.5V4a2.5 2.5 0 015 0v1.5" stroke="currentColor" strokeWidth="1"/></svg>,
  reply:    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8h8a4 4 0 010 8H7M2 8l4-4M2 8l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  edit:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  trash:    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6 5V3h4v2M5 5l.5 8h5L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  dots:     <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3.5" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/></svg>,
  close:    <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  search:   <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  play:     <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 1.5l7 3.5-7 3.5V1.5z" fill="currentColor"/></svg>,
  pause:    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1.5" y="1" width="2.5" height="8" rx=".8" fill="currentColor"/><rect x="6" y="1" width="2.5" height="8" rx=".8" fill="currentColor"/></svg>,
};

/* ─── Custom audio player component ─── */
function AudioPlayer({ src, isMine }) {
  const audioRef = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else         { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const fmt = s => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const accent = isMine ? 'rgba(255,255,255,.75)' : '#6366f1';
  const trackBg = isMine ? 'rgba(255,255,255,.2)' : 'rgba(99,102,241,.18)';

  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 13px', minWidth:200 }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={e => setCurrent(e.target.currentTime)}
        onLoadedMetadata={e => setDuration(e.target.duration)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        style={{ display:'none' }}
      />
      {/* Play/pause button */}
      <button
        onClick={toggle}
        style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: isMine ? 'rgba(255,255,255,.18)' : 'rgba(99,102,241,.15)',
          border: isMine ? '1px solid rgba(255,255,255,.2)' : '1px solid rgba(99,102,241,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent, transition: 'all .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '.8'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        {playing ? Icon.pause : Icon.play}
      </button>

      {/* Waveform bar + time */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Progress bar — clickable scrubber */}
        <div
          style={{ height: 3, borderRadius: 99, background: trackBg, cursor: 'pointer', position: 'relative' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            if (audioRef.current) { audioRef.current.currentTime = ratio * duration; setCurrent(ratio * duration); }
          }}
        >
          <div style={{ position:'absolute', left:0, top:0, height:'100%', width:`${pct}%`, borderRadius:99, background: accent, transition:'width .1s linear' }}/>
        </div>
        {/* Waveform aesthetic bars */}
        <div style={{ display:'flex', alignItems:'center', gap:1.5, height:14 }}>
          {[3,5,8,6,9,7,10,8,6,9,7,5,8,6,4,7,9,6,8,5,7,4,6,9,7,5,8].map((h, i) => (
            <div
              key={i}
              style={{
                width: 2, borderRadius: 1,
                height: h,
                background: i / 27 * 100 <= pct ? accent : trackBg,
                transition: 'background .1s',
                flexShrink: 0,
              }}
            />
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:9.5, color: isMine ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.35)' }}>{fmt(current)}</span>
          <span style={{ fontSize:9.5, color: isMine ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.25)' }}>{fmt(duration)}</span>
        </div>
      </div>

      {/* Mic icon */}
      <div style={{ color: isMine ? 'rgba(255,255,255,.4)' : 'rgba(99,102,241,.5)', flexShrink:0 }}>{Icon.mic}</div>
    </div>
  );
}

export default function ChatPage() {
  const {
    identity, loading, logout, relayStatus, updateDisplayName, syncData,
    contacts, setContacts, groups, setGroups, requestStates, setRequestStates,
    incomingRequests, setIncomingRequests, syncing, setSyncing
  } = useAuth();
  const params     = useParams();
  const router     = useRouter();
  const rawChatId  = params?.chatId || '_';
  const isGroup    = rawChatId.startsWith('grp_');
  const peerPubkey = (!rawChatId || rawChatId === '_' || isGroup) ? null : rawChatId;
  const groupId    = isGroup ? rawChatId : null;

  const [messages,          setMessages]          = useState([]);
  const [loadingMsgs,       setLoadingMsgs]       = useState(false);
  const [input,             setInput]             = useState('');
  const [sending,           setSending]           = useState(false);
  const [mediaSending,      setMediaSending]      = useState(false); // separate spinner for media

  const [showAdd,  setShowAdd]  = useState(false);
  const [addInput, setAddInput] = useState('');
  const [addName,  setAddName]  = useState('');
  const [addError, setAddError] = useState('');
  const [addBusy,  setAddBusy]  = useState(false);

  const [showSettings,  setShowSettings]  = useState(false);
  const [editingName,   setEditingName]   = useState(false);
  const [nameInput,     setNameInput]     = useState('');
  const [nameSaving,    setNameSaving]    = useState(false);
  const [nameSaved,     setNameSaved]     = useState(false);
  const [search,       setSearch]       = useState('');
  const [copied,       setCopied]       = useState('');
  const [relayInput,   setRelayInput]   = useState('');
  const [userRelays,   setUserRelays]   = useState([]);

  const [menuMsg,        setMenuMsg]        = useState(null);
  const [emojiPickerMsg, setEmojiPickerMsg] = useState(null);
  const [replyTo,        setReplyTo]        = useState(null);
  const [editingMsg,     setEditingMsg]     = useState(null);
  const [lightboxSrc,    setLightboxSrc]    = useState(null);

  const [recording,     setRecording]     = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecRef  = useRef(null);
  const chunksRef    = useRef([]);
  const recTimerRef  = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showShare,   setShowShare]   = useState(false);

  // ── Group state ─────────────────────────────────────────────────────────────────
  const [currentGroup,   setCurrentGroup]   = useState(null);  // group object
  const [showNewGroup,   setShowNewGroup]   = useState(false);
  const [groupName,      setGroupName]      = useState('');
  const [groupMembers,   setGroupMembers]   = useState([]);    // [{pubkeyHex, displayName}]
  const [groupMemberInput, setGroupMemberInput] = useState('');
  const [groupMemberError, setGroupMemberError] = useState('');
  const [groupCreating,  setGroupCreating]  = useState(false);
  const [showGroupInfo,  setShowGroupInfo]  = useState(false);
  const [addMemberInput, setAddMemberInput] = useState('');
  const [addMemberError, setAddMemberError] = useState('');
  const unsubGroupRef = useRef(null);
  const unsubGroupInviteRef = useRef(null);

  // ── Call state ──────────────────────────────────────────────────────────────
  const [callSession,   setCallSession]   = useState(null);   // active createCallSession()
  const [callState,     setCallState]     = useState(null);   // 'ringing'|'connecting'|'active'|'ended'|'failed'
  const [callIsVideo,   setCallIsVideo]   = useState(false);
  const [localStream,   setLocalStream]   = useState(null);
  const [remoteStream,  setRemoteStream]  = useState(null);
  const [incomingCall,  setIncomingCall]  = useState(null);   // { payload, fromPubkey }
  const unsubCallRef = useRef(null);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const addRef     = useRef(null);
  const fileImgRef = useRef(null);
  const unsubRef    = useRef(null);
  const unsubReqRef = useRef(null);

  /* ── auth guard ── */
  useEffect(() => { if (!loading && !identity) router.replace('/login'); }, [identity, loading, router]);

  /* ── Listen for incoming calls globally ── */
  useEffect(() => {
    if (!identity) return;
    unsubCallRef.current = subscribeIncomingCalls(
      identity.pubkeyHex, identity.privkeyHex,
      (payload, fromPubkey) => {
        // Ignore if we're already in a call
        if (callState && callState !== 'ended' && callState !== 'failed') return;
        setIncomingCall({ payload, fromPubkey });
      }
    );
    return () => { unsubCallRef.current?.(); unsubCallRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, callState]);

  /* ── Call helpers ── */
  const startCall = useCallback(async (withVideo) => {
    if (!identity || !peerPubkey) return;
    if (callState && callState !== 'ended' && callState !== 'failed') return; // already in call
    setCallIsVideo(withVideo);
    setLocalStream(null);
    setRemoteStream(null);
    const session = createCallSession({
      myPrivkeyHex:  identity.privkeyHex,
      myPubkeyHex:   identity.pubkeyHex,
      peerPubkeyHex: peerPubkey,
      video: withVideo,
    });
    session.onStateChange  = (s) => setCallState(s);
    session.onRemoteStream = (rs) => setRemoteStream(rs);
    session.onError        = (msg) => console.error('[call error]', msg);
    setCallSession(session);
    setCallState('ringing');
    await session.startOutgoing();
    setLocalStream(session.localStream());
  }, [identity, peerPubkey, callState]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !identity) return;
    const { payload, fromPubkey } = incomingCall;
    setIncomingCall(null);
    setCallIsVideo(payload.video ?? false);
    setLocalStream(null);
    setRemoteStream(null);
    const session = createCallSession({
      myPrivkeyHex:  identity.privkeyHex,
      myPubkeyHex:   identity.pubkeyHex,
      peerPubkeyHex: fromPubkey,
      video: payload.video ?? false,
    });
    session.onStateChange  = (s) => setCallState(s);
    session.onRemoteStream = (rs) => setRemoteStream(rs);
    session.onError        = (msg) => console.error('[call error]', msg);
    setCallSession(session);
    setCallState('connecting');
    await session.acceptIncoming(payload);
    setLocalStream(session.localStream());
  }, [incomingCall, identity]);

  const declineCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  const hangup = useCallback(async () => {
    await callSession?.hangup();
    setCallState(null);
    setCallSession(null);
    setLocalStream(null);
    setRemoteStream(null);
  }, [callSession]);

  /* ── load relays ── */
  useEffect(() => { setUserRelays(getRelays()); }, []);

  /* ── subscribe to incoming group invites (live) ── */
  useEffect(() => {
    if (!identity) return;
    const setup = async () => {
      const liveSince = Math.floor(Date.now() / 1000);
      unsubGroupInviteRef.current = await subscribeToGroupInvites(
        identity.pubkeyHex, identity.privkeyHex, liveSince,
        async (invite) => {
          const existing = await getGroup(invite.groupId);
          if (!existing) {
            const group = { groupId: invite.groupId, name: invite.groupName, members: invite.members, groupKeyHex: invite.groupKeyHex, createdAt: Date.now(), createdBy: invite.fromPubkey };
            await saveGroup(group);
            setGroups(prev => prev.find(g => g.groupId === invite.groupId) ? prev : [...prev, group]);
          }
        }
      );
    };
    setup();
    return () => { unsubGroupInviteRef.current?.(); unsubGroupInviteRef.current = null; };
  }, [identity, setGroups]);

  /* ── subscribe to live requests ── */
  useEffect(() => {
    if (!identity) return;
    const liveSince = Math.floor(Date.now() / 1000);
    unsubReqRef.current = subscribeToRequests(
      identity.pubkeyHex, identity.privkeyHex, liveSince,
      async req => {
        const ex = await getRequestState(req.fromPubkey);
        if (!ex) {
          await setRequestState(req.fromPubkey, 'pending_incoming', { displayName: req.displayName });
          setIncomingRequests(prev => prev.find(r => r.fromPubkey === req.fromPubkey) ? prev : [...prev, req]);
          setRequestStates(await getAllRequestStates());
        }
      },
      async (pk, status) => { await setRequestState(pk, status); setRequestStates(await getAllRequestStates()); }
    );
    return () => { unsubReqRef.current?.(); unsubReqRef.current = null; };
  }, [identity, setIncomingRequests, setRequestStates]);

  /* ── load group messages ── */
  useEffect(() => {
    if (!identity || !isGroup || !groupId) return;
    let alive = true;
    unsubGroupRef.current?.(); unsubGroupRef.current = null;
    setLoadingMsgs(true);
    setMessages([]);
    getGroup(groupId).then(async g => {
      if (!g || !alive) { setLoadingMsgs(false); return; }
      setCurrentGroup(g);
      const cached = await getCachedMessages(groupId);
      if (!alive) return;
      setMessages(cached);
      setLoadingMsgs(false);
      const sinceTs = cached.length ? Math.floor(Math.max(...cached.map(m => m.ts)) / 1000) : 0;
      setSyncing(true);
      fetchGroupMessages(identity.pubkeyHex, groupId, g.groupKeyHex, g.members, sinceTs).then(newMsgs => {
        if (!alive) return;
        setSyncing(false);
        if (newMsgs.length) setMessages(prev => { const seen = new Set(prev.map(m => m.id)); return [...prev, ...newMsgs.filter(m => !seen.has(m.id))].sort((a,b) => a.ts - b.ts); });
      }).catch(() => setSyncing(false));
      const liveSince = Math.floor(Date.now() / 1000);
      subscribeToGroup(identity.pubkeyHex, groupId, g.groupKeyHex, liveSince, msg => {
        if (!alive) return;
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg].sort((a,b) => a.ts - b.ts));
      }).then(unsub => { if (!alive) { unsub?.(); return; } unsubGroupRef.current = unsub; });
    });
    return () => { alive = false; unsubGroupRef.current?.(); unsubGroupRef.current = null; };
  }, [identity, isGroup, groupId]);

  /* ── load messages for active chat ── */
  useEffect(() => {
    if (!identity || !peerPubkey) { setMessages([]); return; }
    let alive = true;
    unsubRef.current?.(); unsubRef.current = null;
    setLoadingMsgs(true);

    getCachedMessages(peerPubkey).then(cached => {
      if (!alive) return;
      setMessages(applyMutations(cached));
      setLoadingMsgs(false);

      const sinceTs = cached.length ? Math.floor(Math.max(...cached.map(m => m.ts)) / 1000) : 0;
      setSyncing(true);
      fetchAndCacheDMs(identity.pubkeyHex, identity.privkeyHex, peerPubkey, sinceTs)
        .then(newMsgs => {
          if (!alive) return;
          setSyncing(false);
          if (newMsgs.length) setMessages(prev => {
            const seen = new Set(prev.map(m => m.id));
            return applyMutations([...prev, ...newMsgs.filter(m => !seen.has(m.id))].sort((a, b) => a.ts - b.ts));
          });
        }).catch(() => setSyncing(false));

      const liveSince = Math.floor(Date.now() / 1000);
      // subscribeToConversation is async — await it so we store the unsub fn, not the Promise
      subscribeToConversation(
        identity.pubkeyHex, identity.privkeyHex, peerPubkey, liveSince,
        msg => {
          if (!alive) return;
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : applyMutations([...prev, msg].sort((a, b) => a.ts - b.ts)));
        }
      ).then(unsub => {
        if (!alive) { unsub?.(); return; } // component unmounted before promise resolved
        unsubRef.current = unsub;
      });
    });

    return () => { alive = false; unsubRef.current?.(); unsubRef.current = null; };
  }, [identity, peerPubkey]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (showAdd) setTimeout(() => addRef.current?.focus(), 60);
    else { setAddInput(''); setAddName(''); setAddError(''); }
  }, [showAdd]);

  /* ─── apply reaction / edit / delete mutations to raw message list ─── */
  function applyMutations(msgs) {
    const byId = {}, reactions = {}, edits = {}, deleted = new Set();
    for (const m of msgs) {
      if (m.msgType === 'reaction') {
        if (!reactions[m.targetId]) reactions[m.targetId] = {};
        if (!reactions[m.targetId][m.emoji]) reactions[m.targetId][m.emoji] = [];
        if (!reactions[m.targetId][m.emoji].includes(m.from)) reactions[m.targetId][m.emoji].push(m.from);
      } else if (m.msgType === 'edit'   && m.mine) { edits[m.targetId] = m.newText; }
        else if (m.msgType === 'delete' && m.mine) { deleted.add(m.targetId); }
        else if (['text','media','reply'].includes(m.msgType)) { byId[m.id] = m; }
    }
    return Object.values(byId)
      .map(m => ({ ...m, text: edits[m.id] ?? m.text, edited: !!edits[m.id], deleted: deleted.has(m.id), reactions: reactions[m.id] || {} }))
      .sort((a, b) => a.ts - b.ts);
  }

  /* ─── send group text ─── */
  const handleGroupSend = useCallback(async () => {
    if (!input.trim() || !currentGroup || sending || !identity) return;
    setSending(true);
    const text = input.trim();
    setInput('');
    if (inputRef.current) { inputRef.current.style.height = '26px'; inputRef.current.focus(); }
    try {
      const ev = await buildGroupMessageEvent(text, currentGroup.groupId, currentGroup.members, currentGroup.groupKeyHex, identity.privkeyHex);
      await publishEvent(ev);
      const msg = { id: ev.id, peer: currentGroup.groupId, from: identity.pubkeyHex, msgType: 'text', text, ts: ev.created_at * 1000, mine: true, reactions: {}, groupId: currentGroup.groupId };
      await cacheMessage(msg);
      setMessages(prev => [...prev, msg]);
    } catch (err) { console.error('group send failed', err); }
    finally { setSending(false); }
  }, [input, currentGroup, sending, identity]);

  /* ─── send group image ─── */
  const handleGroupImageFile = async (file) => {
    if (!file || !currentGroup || !identity) return;
    setMediaSending(true);
    try {
      const { b64, mimeType } = await compressImageToBase64(file);
      const payload = { mediaType: 'image', data: b64, mimeType, fileName: file.name };
      const ev = await buildGroupMediaEvent(payload, currentGroup.groupId, currentGroup.members, currentGroup.groupKeyHex, identity.privkeyHex);
      await publishEvent(ev);
      const msg = { id: ev.id, peer: currentGroup.groupId, from: identity.pubkeyHex, msgType: 'media', mediaType: 'image', data: b64, mimeType, fileName: file.name, ts: ev.created_at * 1000, mine: true, reactions: {}, groupId: currentGroup.groupId };
      await cacheMessage(msg);
      setMessages(prev => [...prev, msg]);
    } catch (err) { alert('Image error: ' + (err?.message || 'Unknown')); }
    finally { setMediaSending(false); if (fileImgRef.current) fileImgRef.current.value = ''; }
  };

  /* ─── create group ─── */
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupName.trim() || groupMembers.length === 0 || groupCreating || !identity) return;
    setGroupCreating(true);
    try {
      const gid = generateGroupId();
      const gkey = generateGroupKey();
      const allMembers = [...new Set([identity.pubkeyHex, ...groupMembers.map(m => m.pubkeyHex)])];
      const group = { groupId: gid, name: groupName.trim(), members: allMembers, groupKeyHex: gkey, createdAt: Date.now(), createdBy: identity.pubkeyHex };
      await saveGroup(group);
      setGroups(prev => [...prev, group]);
      // Send invite to each member
      for (const memberHex of groupMembers.map(m => m.pubkeyHex)) {
        const ev = buildGroupInviteEvent(gid, gkey, group.name, allMembers, identity.privkeyHex, memberHex);
        await publishEvent(ev);
        await new Promise(r => setTimeout(r, 100)); // small delay to avoid rate limits
      }
      setShowNewGroup(false);
      setGroupName('');
      setGroupMembers([]);
      router.push(`/chat/${gid}`);
    } catch (err) { console.error('create group failed', err); }
    finally { setGroupCreating(false); }
  };

  const addGroupMember = () => {
    const raw = groupMemberInput.trim();
    setGroupMemberError('');
    let pk = null;
    if (isValidNpub(raw)) pk = npubToPubkeyHex(raw);
    else if (isValidPubkeyHex(raw)) pk = raw.toLowerCase();
    else { setGroupMemberError('Enter a valid npub or hex pubkey.'); return; }
    if (pk === identity?.pubkeyHex) { setGroupMemberError("That's you — you're added automatically."); return; }
    if (groupMembers.find(m => m.pubkeyHex === pk)) { setGroupMemberError('Already added.'); return; }
    const contact = contacts[pk];
    setGroupMembers(prev => [...prev, { pubkeyHex: pk, displayName: contact?.displayName || pk.slice(0,12) }]);
    setGroupMemberInput('');
  };

  /* ─── send text / edit / reply ─── */
  const handleSend = useCallback(async () => {
    if (!input.trim() || !peerPubkey || sending || !identity) return;
    const rs = requestStates[peerPubkey];
    if (rs && rs.status !== 'accepted') return;

    setSending(true);
    const text = input.trim();
    setInput('');
    setReplyTo(null);
    if (inputRef.current) { inputRef.current.style.height = '26px'; inputRef.current.focus(); }

    try {
      if (editingMsg) {
        const ev = buildEditEvent(editingMsg.id, text, identity.privkeyHex, peerPubkey);
        await publishEvent(ev);
        setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, text, edited: true } : m));
        await cacheMessage({ id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'edit', targetId: editingMsg.id, newText: text, ts: ev.created_at * 1000, mine: true });
        setEditingMsg(null);
      } else if (replyTo) {
        const ev = buildReplyEvent(replyTo.id, replyTo.text || '', text, identity.privkeyHex, peerPubkey);
        await publishEvent(ev);
        const msg = { id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'reply', replyToId: replyTo.id, replyToText: replyTo.text || '', text, ts: ev.created_at * 1000, mine: true, reactions: {} };
        await cacheMessage(msg);
        setMessages(prev => [...prev, msg]);
      } else {
        const ev = buildDMEvent(text, identity.privkeyHex, peerPubkey);
        await publishEvent(ev);
        const msg = { id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'text', text, ts: ev.created_at * 1000, mine: true, reactions: {} };
        await cacheMessage(msg);
        setMessages(prev => [...prev, msg]);
      }
    } catch (err) { console.error('send failed', err); }
    finally { setSending(false); }
  }, [input, peerPubkey, sending, identity, requestStates, editingMsg, replyTo]);

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); isGroup ? handleGroupSend() : handleSend(); }
    if (e.key === 'Escape') { setEditingMsg(null); setReplyTo(null); setInput(''); }
  };

  /* ─── send image (Canvas-compressed to stay under NIP-44 limit) ─── */
  const handleImageFile = async (file) => {
    if (!file || !peerPubkey || !identity) return;
    setMediaSending(true);
    try {
      const { b64, mimeType } = await compressImageToBase64(file);
      const payload = { type: 'media', mediaType: 'image', data: b64, mimeType, fileName: file.name };
      const ev = buildMediaDMEvent(payload, identity.privkeyHex, peerPubkey);
      await publishEvent(ev);
      const msg = { id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'media', mediaType: 'image', data: b64, mimeType, fileName: file.name, ts: ev.created_at * 1000, mine: true, reactions: {} };
      await cacheMessage(msg);
      setMessages(prev => [...prev, msg]);
    } catch (err) {
      alert('Image error: ' + (err?.message || 'Unknown error'));
    } finally {
      setMediaSending(false);
      if (fileImgRef.current) fileImgRef.current.value = '';
    }
  };

  /* ─── voice recording — hold-to-record, release to send ─── */
  const startRecording = async (e) => {
    e.preventDefault();
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer low-bitrate opus to keep clips small
      const opts = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 }
        : {};
      const mr = new MediaRecorder(stream, opts);
      mediaRecRef.current = mr;
      chunksRef.current   = [];
      mr.ondataavailable = ev => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(recTimerRef.current);
        setRecordSeconds(0);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        setMediaSending(true);
        try {
          const { b64, mimeType } = await audioBlobToBase64(blob);
          const payload = { type: 'media', mediaType: 'audio', data: b64, mimeType, fileName: 'voice.webm' };
          const ev = buildMediaDMEvent(payload, identity.privkeyHex, peerPubkey);
          await publishEvent(ev);
          const msg = { id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'media', mediaType: 'audio', data: b64, mimeType, fileName: 'voice.webm', ts: ev.created_at * 1000, mine: true, reactions: {} };
          await cacheMessage(msg);
          setMessages(prev => [...prev, msg]);
        } catch (err) {
          alert('Voice error: ' + (err?.message || 'Too long — keep under 20 seconds'));
        } finally { setMediaSending(false); }
      };
      mr.start(100); // collect chunks every 100ms
      setRecording(true);
      setRecordSeconds(0);
      recTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch { alert('Microphone access denied.'); }
  };

  const stopRecording = (e) => {
    e.preventDefault();
    if (!recording || !mediaRecRef.current) return;
    mediaRecRef.current.stop();
    setRecording(false);
  };

  /* ─── react ─── */
  const handleReact = async (msgId, emoji) => {
    if (!peerPubkey || !identity) return;
    setEmojiPickerMsg(null); setMenuMsg(null);
    const ev = buildReactionEvent(msgId, emoji, identity.privkeyHex, peerPubkey);
    await publishEvent(ev);
    await cacheMessage({ id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'reaction', targetId: msgId, emoji, ts: ev.created_at * 1000, mine: true });
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const r = { ...(m.reactions || {}) };
      if (!r[emoji]) r[emoji] = [];
      if (!r[emoji].includes(identity.pubkeyHex)) r[emoji] = [...r[emoji], identity.pubkeyHex];
      return { ...m, reactions: r };
    }));
  };

  /* ─── delete ─── */
  const handleDelete = async (msg) => {
    setMenuMsg(null);
    if (!confirm('Delete this message?')) return;
    const ev = buildDeleteEvent(msg.id, identity.privkeyHex, peerPubkey);
    await publishEvent(ev);
    await cacheMessage({ id: ev.id, peer: peerPubkey, from: identity.pubkeyHex, msgType: 'delete', targetId: msg.id, ts: ev.created_at * 1000, mine: true });
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, deleted: true } : m));
  };

  /* ─── add contact ─── */
  const handleAddContact = async e => {
    e.preventDefault(); setAddError('');
    const raw = addInput.trim(); let pk = null;
    if (isValidNpub(raw))        pk = npubToPubkeyHex(raw);
    else if (isValidPubkeyHex(raw)) pk = raw.toLowerCase();
    else { setAddError('Paste a valid npub1… key or 64-char hex pubkey.'); return; }
    if (!pk)                          { setAddError('Could not read that key.'); return; }
    if (pk === identity?.pubkeyHex)   { setAddError("That's your own key!"); return; }
    setAddBusy(true);
    try {
      const contact = await saveContact(pk, addName.trim());
      setContacts(prev => ({ ...prev, [pk]: contact }));
      await publishEvent(buildRequestEvent(identity.privkeyHex, pk, identity.displayName));
      await setRequestState(pk, 'pending_sent');
      setRequestStates(await getAllRequestStates());
      setShowAdd(false);
      router.push(`/chat/${pk}`);
    } catch (err) { setAddError('Failed — ' + (err?.message || 'unknown')); }
    finally { setAddBusy(false); }
  };

  /* ─── accept / decline ─── */
  const handleAccept = async (fromPubkey, displayName) => {
    const contact = await saveContact(fromPubkey, displayName);
    setContacts(prev => ({ ...prev, [fromPubkey]: contact }));
    await publishEvent(buildAcceptEvent(identity.privkeyHex, fromPubkey));
    await setRequestState(fromPubkey, 'accepted');
    setRequestStates(await getAllRequestStates());
    setIncomingRequests(prev => prev.filter(r => r.fromPubkey !== fromPubkey));
    router.push(`/chat/${fromPubkey}`);
  };
  const handleDecline = async fromPubkey => {
    await publishEvent(buildDeclineEvent(identity.privkeyHex, fromPubkey));
    await setRequestState(fromPubkey, 'declined');
    setRequestStates(await getAllRequestStates());
    setIncomingRequests(prev => prev.filter(r => r.fromPubkey !== fromPubkey));
  };
  const handleRemoveContact = async pk => {
    await removeContact(pk);
    setContacts(prev => { const n = { ...prev }; delete n[pk]; return n; });
    if (peerPubkey === pk) router.push('/chat/_');
  };

  /* ─── save display name ─── */
  const saveDisplayName = useCallback(async () => {
    if (!nameInput.trim() || nameSaving) return;
    setNameSaving(true);
    try {
      await updateDisplayName(nameInput.trim());
      setNameSaved(true);
      setTimeout(() => { setEditingName(false); setNameSaved(false); }, 900);
    } catch (err) { console.error('Failed to save name', err); }
    finally { setNameSaving(false); }
  }, [nameInput, nameSaving, updateDisplayName]);

  /* ─── helpers ─── */
  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); } catch {}
    setCopied(label); setTimeout(() => setCopied(c => c === label ? '' : c), 2000);
  };
  const peerName = pk => pk ? (contacts[pk]?.displayName || pubkeyHexToNpub(pk)?.slice(0, 16) || pk.slice(0, 12)) : '';
  const fmtTime  = ts => {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const filteredContacts = Object.values(contacts).filter(c =>
    (c.displayName || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.npub || '').toLowerCase().includes(search.toLowerCase())
  );

  const relayColor     = { connected: '#34d399', connecting: '#f59e0b', disconnected: '#ef4444' }[relayStatus] || '#6b7280';
  const currentReqState = peerPubkey ? (requestStates[peerPubkey]?.status || 'accepted') : null;
  const canChat         = currentReqState === 'accepted' || !currentReqState;

  if (loading || !identity) return (
    <div style={{ height:'100vh', background:'#080809', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <style>{`@keyframes pr{0%{transform:scale(.8);opacity:1}100%{transform:scale(2.2);opacity:0}}`}</style>
      <div style={{ position:'relative', width:40, height:40 }}>
        <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(99,102,241,.2)', animation:'pr 1.4s ease-out infinite' }}/>
        <div style={{ position:'absolute', inset:8, borderRadius:'50%', background:'rgba(99,102,241,.6)' }}/>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;font-family:'DM Sans',-apple-system,sans-serif}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:99px}
        input,textarea,button{font-family:'DM Sans',sans-serif}
        textarea{resize:none}button{cursor:pointer;border:none;background:none}
        input::placeholder,textarea::placeholder{color:rgba(255,255,255,.2)}
        input:focus,textarea:focus{outline:none}
        ::selection{background:rgba(99,102,241,.3);color:#fff}
        @keyframes spin      {to{transform:rotate(360deg)}}
        @keyframes fadeIn    {from{opacity:0}to{opacity:1}}
        @keyframes slideUp   {from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
        @keyframes msgR      {from{opacity:0;transform:translateX(10px) scale(.97)}to{opacity:1;transform:none}}
        @keyframes msgL      {from{opacity:0;transform:translateX(-10px) scale(.97)}to{opacity:1;transform:none}}
        @keyframes floatY    {0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes glow      {0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes dotBounce {0%,80%,100%{transform:scale(0);opacity:0}40%{transform:scale(1);opacity:1}}
        @keyframes popIn     {from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
        @keyframes slideIn   {from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        @keyframes recPulse  {0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes slideInLeft{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        .modal-bg  {animation:fadeIn .18s ease}
        .modal-card{animation:slideUp .22s cubic-bezier(.34,1.4,.64,1)}
        .msg-r{animation:msgR .16s cubic-bezier(.34,1.2,.64,1)}
        .msg-l{animation:msgL .16s cubic-bezier(.34,1.2,.64,1)}
        .emoji-pop {animation:popIn .15s cubic-bezier(.34,1.4,.64,1)}
        .menu-slide{animation:slideIn .14s cubic-bezier(.34,1.2,.64,1)}
        .react-pill{animation:popIn .2s cubic-bezier(.34,1.6,.64,1)}
        .contact-row{transition:background .12s}
        .contact-row:hover{background:rgba(255,255,255,.04)!important}
        .contact-row:hover .del-btn{opacity:1!important}
        .msg-wrap:hover .msg-bar{opacity:1!important;transform:translateY(0)!important}
        .msg-bar{opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s}
        .send-btn{transition:all .15s cubic-bezier(.34,1.4,.64,1)}
        .send-btn:hover:not(:disabled){transform:scale(1.08)}
        .input-box:focus-within{border-color:rgba(99,102,241,.45)!important;box-shadow:0 0 0 3px rgba(99,102,241,.1)!important}
        .med-btn{transition:all .15s}.med-btn:hover{background:rgba(255,255,255,.1)!important;color:#fff!important}
        .pill{transition:all .18s}.pill:hover{transform:translateY(-1px)}
      `}</style>

      {/* Hidden image file input */}
      <input ref={fileImgRef} type="file" accept="image/*" style={{ display:'none' }}
        onChange={e => { if (e.target.files[0]) handleImageFile(e.target.files[0]); }} />

      {/* ── Lightbox ── */}
      {lightboxSrc && (
        <div className="modal-bg" onClick={() => setLightboxSrc(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(10px)' }}>
          <button onClick={() => setLightboxSrc(null)}
            style={{ position:'absolute', top:20, right:20, width:36, height:36, borderRadius:10, background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.7)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {Icon.close}
          </button>
          <img src={lightboxSrc} alt="" style={{ maxWidth:'90vw', maxHeight:'90vh', borderRadius:12, objectFit:'contain' }} />
        </div>
      )}

      <ShareProfileModal identity={identity} onClose={() => setShowShare(false)} open={showShare} />
      <div style={{ height:'100vh', display:'flex', background:'#080809', overflow:'hidden', fontSize:13.5, position:'relative' }}>

        {/* Ambient glows */}
        <div style={{ position:'fixed', top:-180, left:-120, width:480, height:480, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.07) 0%,transparent 70%)', pointerEvents:'none', zIndex:0 }}/>
        <div style={{ position:'fixed', bottom:-160, right:-80, width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(168,85,247,.05) 0%,transparent 70%)', pointerEvents:'none', zIndex:0 }}/>

        {/* ══════════ ADD CONTACT MODAL ══════════ */}
        {showAdd && (
          <div className="modal-bg" onClick={() => setShowAdd(false)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', backdropFilter:'blur(12px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div className="modal-card" onClick={e => e.stopPropagation()}
              style={{ width:440, background:'linear-gradient(145deg,#141416,#0f0f11)', border:'1px solid rgba(255,255,255,.09)', borderRadius:20, padding:28, boxShadow:'0 40px 80px rgba(0,0,0,.8)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
                <div style={{ width:38, height:38, borderRadius:12, background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 2a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM3 15c0-2.76 2.686-5 6-5s6 2.24 6 5" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round"/><path d="M13 7v4M11 9h4" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round"/></svg>
                </div>
                <div>
                  <h2 style={{ color:'rgba(255,255,255,.92)', fontSize:16, fontWeight:600 }}>New conversation</h2>
                  <p style={{ color:'rgba(255,255,255,.28)', fontSize:12, marginTop:1 }}>A message request will be sent</p>
                </div>
              </div>
              <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent)', margin:'18px 0' }}/>
              <form onSubmit={handleAddContact}>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:7 }}>Public key</label>
                <input ref={addRef} value={addInput} onChange={e => { setAddInput(e.target.value); setAddError(''); }}
                  placeholder="npub1… or 64-char hex" autoComplete="off" spellCheck={false}
                  style={{ width:'100%', background:'rgba(255,255,255,.04)', border:`1.5px solid ${addError?'rgba(239,68,68,.5)':'rgba(255,255,255,.08)'}`, borderRadius:10, padding:'11px 14px', color:'rgba(255,255,255,.85)', fontSize:12, fontFamily:"'DM Mono',monospace", marginBottom:12, transition:'border-color .2s' }}
                  onFocus={e => e.target.style.borderColor='rgba(99,102,241,.5)'}
                  onBlur={e  => e.target.style.borderColor=addError?'rgba(239,68,68,.5)':'rgba(255,255,255,.08)'}/>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:7 }}>Nickname <span style={{ fontWeight:400, textTransform:'none', color:'rgba(255,255,255,.2)', fontSize:11 }}>(optional)</span></label>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Alice"
                  style={{ width:'100%', background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.08)', borderRadius:10, padding:'11px 14px', color:'rgba(255,255,255,.85)', fontSize:13.5, marginBottom:16, transition:'border-color .2s' }}
                  onFocus={e => e.target.style.borderColor='rgba(99,102,241,.5)'}
                  onBlur={e  => e.target.style.borderColor='rgba(255,255,255,.08)'}/>
                {addError && (
                  <div style={{ background:'rgba(239,68,68,.07)', border:'1px solid rgba(239,68,68,.2)', borderRadius:9, padding:'9px 13px', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#f87171" strokeWidth="1.2"/><path d="M7 4.5v3M7 9.5v.3" stroke="#f87171" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    <p style={{ color:'#f87171', fontSize:12 }}>{addError}</p>
                  </div>
                )}
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button type="button" onClick={() => setShowAdd(false)} className="pill" style={{ padding:'10px 18px', borderRadius:9, color:'rgba(255,255,255,.4)', fontSize:13, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.07)' }}>Cancel</button>
                  <button type="submit" disabled={addBusy || !addInput.trim()} className="pill"
                    style={{ padding:'10px 20px', borderRadius:9, fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:7, background:addInput.trim()&&!addBusy?'linear-gradient(135deg,#6366f1,#8b5cf6)':'rgba(255,255,255,.06)', color:addInput.trim()&&!addBusy?'#fff':'rgba(255,255,255,.25)', boxShadow:addInput.trim()&&!addBusy?'0 4px 16px rgba(99,102,241,.35)':'none', transition:'all .2s' }}>
                    {addBusy ? <><div style={{ width:11, height:11, border:'1.5px solid rgba(255,255,255,.2)', borderTop:'1.5px solid #fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>Sending…</> : <>Send request {Icon.send}</>}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ══════════ SETTINGS MODAL ══════════ */}
        {showSettings && (
          <div className="modal-bg" onClick={() => setShowSettings(false)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', backdropFilter:'blur(12px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div className="modal-card" onClick={e => e.stopPropagation()}
              style={{ width:460, maxHeight:'88vh', overflowY:'auto', background:'linear-gradient(145deg,#141416,#0f0f11)', border:'1px solid rgba(255,255,255,.09)', borderRadius:20, padding:28, boxShadow:'0 40px 80px rgba(0,0,0,.8)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:22 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:34, height:34, borderRadius:10, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.5)' }}>{Icon.settings}</div>
                  <h2 style={{ color:'rgba(255,255,255,.88)', fontSize:16, fontWeight:600 }}>Settings</h2>
                </div>
                <button onClick={() => setShowSettings(false)} style={{ width:28, height:28, borderRadius:8, background:'rgba(255,255,255,.05)', color:'rgba(255,255,255,.35)', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center' }} onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.1)';e.currentTarget.style.color='rgba(255,255,255,.7)';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.05)';e.currentTarget.style.color='rgba(255,255,255,.35)';}}>×</button>
              </div>

              {/* Identity */}
              <p style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:10 }}>Identity</p>

              {/* ── Display name — editable ── */}
              <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', borderRadius:10, padding:'11px 13px', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: editingName ? 8 : 0 }}>
                  <p style={{ color:'rgba(255,255,255,.3)', fontSize:11 }}>Display name</p>
                  {!editingName && (
                    <button
                      onClick={() => { setNameInput(identity.displayName || ''); setEditingName(true); setNameSaved(false); }}
                      style={{ padding:'3px 9px', borderRadius:6, background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)', color:'rgba(139,92,246,.85)', fontSize:11, display:'flex', alignItems:'center', gap:5, transition:'all .15s' }}
                      onMouseEnter={e=>{ e.currentTarget.style.background='rgba(99,102,241,.18)'; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background='rgba(99,102,241,.1)'; }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                      Edit
                    </button>
                  )}
                </div>
                {editingName ? (
                  <div>
                    <div style={{ position:'relative', marginBottom:8 }}>
                      <input
                        autoFocus
                        value={nameInput}
                        onChange={e => setNameInput(e.target.value.slice(0, 32))}
                        onKeyDown={async e => {
                          if (e.key === 'Enter') { e.preventDefault(); await saveDisplayName(); }
                          if (e.key === 'Escape') setEditingName(false);
                        }}
                        placeholder="Your display name"
                        style={{ width:'100%', background:'rgba(255,255,255,.05)', border:'1.5px solid rgba(99,102,241,.4)', borderRadius:8, padding:'8px 36px 8px 10px', color:'rgba(255,255,255,.9)', fontSize:13.5, boxShadow:'0 0 0 3px rgba(99,102,241,.1)' }}
                      />
                      <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,.2)', fontSize:10 }}>{32 - nameInput.length}</span>
                    </div>
                    <div style={{ display:'flex', gap:7 }}>
                      <button
                        onClick={saveDisplayName}
                        disabled={nameSaving || !nameInput.trim()}
                        style={{ flex:1, padding:'7px', borderRadius:8, background: nameInput.trim() && !nameSaving ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : 'rgba(255,255,255,.06)', color: nameInput.trim() && !nameSaving ? '#fff' : 'rgba(255,255,255,.25)', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow: nameInput.trim() && !nameSaving ? '0 3px 12px rgba(99,102,241,.3)' : 'none', transition:'all .15s' }}>
                        {nameSaving
                          ? <><div style={{ width:10, height:10, border:'1.5px solid rgba(255,255,255,.2)', borderTop:'1.5px solid #fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>Saving…</>
                          : nameSaved ? '✓ Saved!' : 'Save name'}
                      </button>
                      <button
                        onClick={() => setEditingName(false)}
                        style={{ padding:'7px 12px', borderRadius:8, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.07)', color:'rgba(255,255,255,.35)', fontSize:12 }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ color:'rgba(255,255,255,.85)', fontSize:14, fontWeight:500, marginTop:3 }}>{identity.displayName}</p>
                )}
              </div>
              <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', borderRadius:10, padding:'11px 13px', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
                  <div style={{ minWidth:0 }}>
                    <p style={{ color:'rgba(255,255,255,.3)', fontSize:11, marginBottom:4 }}>Public key — <span style={{ color:'rgba(52,211,153,.6)' }}>safe to share</span></p>
                    <p style={{ color:'rgba(255,255,255,.7)', fontSize:10.5, fontFamily:"'DM Mono',monospace", wordBreak:'break-all', lineHeight:1.6 }}>{identity.npub}</p>
                  </div>
                  <button onClick={() => copy(identity.npub, 'npub')} className="pill" style={{ flexShrink:0, padding:'5px 11px', borderRadius:7, background:copied==='npub'?'rgba(52,211,153,.12)':'rgba(255,255,255,.05)', color:copied==='npub'?'#34d399':'rgba(255,255,255,.45)', fontSize:11, border:`1px solid ${copied==='npub'?'rgba(52,211,153,.25)':'rgba(255,255,255,.07)'}`, whiteSpace:'nowrap' }}>{copied==='npub'?'✓ Copied':'Copy'}</button>
                </div>
              </div>
              <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', borderRadius:10, padding:'11px 13px', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
                  <div style={{ minWidth:0, flex:1 }}>
                    <p style={{ color:'rgba(255,255,255,.3)', fontSize:11, marginBottom:4 }}>Private key — <span style={{ color:'rgba(239,68,68,.6)' }}>never share</span></p>
                    <p style={{ color:'rgba(255,255,255,.55)', fontSize:10.5, fontFamily:"'DM Mono',monospace", wordBreak:'break-all', lineHeight:1.6, filter:copied==='nsec-show'?'none':'blur(7px)', transition:'filter .25s' }}>{identity.nsec}</p>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5, flexShrink:0 }}>
                    <button onClick={() => setCopied(c => c==='nsec-show'?'':'nsec-show')} className="pill" style={{ padding:'5px 11px', borderRadius:7, background:'rgba(255,255,255,.05)', color:'rgba(255,255,255,.45)', fontSize:11, border:'1px solid rgba(255,255,255,.07)' }}>{copied==='nsec-show'?'Hide':'Reveal'}</button>
                    {copied==='nsec-show'&&<button onClick={() => copy(identity.nsec,'nsec')} className="pill" style={{ padding:'5px 11px', borderRadius:7, background:'rgba(239,68,68,.08)', color:copied==='nsec'?'#34d399':'#f87171', fontSize:11, border:'1px solid rgba(239,68,68,.18)' }}>{copied==='nsec'?'✓ Copied':'Copy'}</button>}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'10px 13px', background:'rgba(239,68,68,.04)', border:'1px solid rgba(239,68,68,.1)', borderRadius:10, marginBottom:22 }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0, marginTop:1 }}><path d="M7 2L1.5 11.5h11L7 2z" stroke="rgba(239,68,68,.5)" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 6v2.5M7 10.5v.3" stroke="rgba(239,68,68,.5)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                <p style={{ color:'rgba(239,68,68,.55)', fontSize:11, lineHeight:1.7 }}>Back up your nsec. No password reset — losing it means losing access permanently.</p>
              </div>

              {/* Share Profile */}
              <p style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:10 }}>Share Profile</p>
              <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', borderRadius:12, padding:16, marginBottom:22, textAlign:'center' }}>
                <div style={{ background:'#fff', padding:8, borderRadius:12, width:140, height:140, margin:'0 auto 16px', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent('https://abrigo-w3.antqr.xyz/join/' + identity.npub)}`}
                    alt="Join QR" style={{ width:'100%', height:'100%' }} />
                </div>
                <p style={{ color:'rgba(255,255,255,0.3)', fontSize:11, marginBottom:8 }}>Scan to join or share your link</p>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.04)', padding:'8px 10px', borderRadius:8, marginBottom:16 }}>
                  <span style={{ color:'rgba(255,255,255,0.5)', fontSize:10.5, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:"'DM Mono', monospace" }}>
                    abrigo-w3.antqr.xyz/join/{identity.npub.slice(0, 12)}...
                  </span>
                  <button onClick={() => copy(`https://abrigo-w3.antqr.xyz/join/${identity.npub}`, 'join-link')}
                    className="pill" style={{ padding:'5px 10px', borderRadius:6, background:copied==='join-link'?'rgba(52,211,153,0.1)':'rgba(99,102,241,0.1)', color:copied==='join-link'?'#34d399':'rgba(139,92,246,0.8)', fontSize:11, border:'1px solid rgba(99,102,241,0.2)' }}>
                    {copied==='join-link' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>

                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  {[
                    { label: 'X', color: '#000', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>, url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(identity.displayName + ' is on Abrigo, join them for secure and private chat.')}&url=${encodeURIComponent('https://abrigo-w3.antqr.xyz/join/' + identity.npub)}` },
                    { label: 'FB', color: '#1877f2', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>, url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://abrigo-w3.antqr.xyz/join/' + identity.npub)}` },
                    { label: 'WA', color: '#25d366', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>, url: `https://wa.me/?text=${encodeURIComponent(identity.displayName + ' is on Abrigo, join them for secure chat: https://abrigo-w3.antqr.xyz/join/' + identity.npub)}` }
                  ].map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                      style={{ width:34, height:34, borderRadius:10, background:s.color, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', transition:'transform 0.15s' }}
                      onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
                      {s.icon}
                    </a>
                  ))}
                </div>
              </div>

              {/* Relays */}
              <p style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:10 }}>Relays</p>
              <div style={{ marginBottom:10 }}>
                {userRelays.map(url => (
                  <div key={url} style={{ display:'flex', alignItems:'center', padding:'8px 11px', background:'rgba(255,255,255,.025)', border:'1px solid rgba(255,255,255,.06)', borderRadius:9, marginBottom:5 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:relayColor, flexShrink:0, marginRight:9, ...(relayStatus==='connected'?{boxShadow:`0 0 6px ${relayColor}`}:{}) }}/>
                    <span style={{ flex:1, color:'rgba(255,255,255,.4)', fontSize:11, fontFamily:"'DM Mono',monospace", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{url}</span>
                    <button onClick={() => { const n=userRelays.filter(r=>r!==url); setUserRelays(n); saveRelays(n); }} style={{ flexShrink:0, marginLeft:8, color:'rgba(255,255,255,.2)', fontSize:17 }} onMouseEnter={e=>e.currentTarget.style.color='#f87171'} onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.2)'}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, marginBottom:24 }}>
                <input value={relayInput} onChange={e => setRelayInput(e.target.value)} placeholder="wss://relay.example.com"
                  onKeyDown={e => { if (e.key==='Enter') { const u=relayInput.trim(); if(u.startsWith('wss://')||u.startsWith('ws://')){const n=[...new Set([...userRelays,u])];setUserRelays(n);saveRelays(n);setRelayInput('');connectRelays([u]);} } }}
                  style={{ flex:1, background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.07)', borderRadius:9, padding:'9px 11px', color:'rgba(255,255,255,.7)', fontSize:12, fontFamily:"'DM Mono',monospace" }}
                  onFocus={e=>e.target.style.borderColor='rgba(99,102,241,.4)'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.07)'}/>
                <button onClick={() => { const u=relayInput.trim(); if(u.startsWith('wss://')||u.startsWith('ws://')){const n=[...new Set([...userRelays,u])];setUserRelays(n);saveRelays(n);setRelayInput('');connectRelays([u]); } }} className="pill" style={{ padding:'9px 15px', borderRadius:9, background:'rgba(99,102,241,.1)', color:'rgba(139,92,246,.8)', fontSize:12, border:'1px solid rgba(99,102,241,.2)' }}>Add</button>
              </div>
              <button onClick={() => { logout(); router.replace('/login'); }} className="pill"
                style={{ width:'100%', padding:'11px', borderRadius:10, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.12)', color:'rgba(248,113,113,.8)', fontSize:13, fontWeight:500 }}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(239,68,68,.12)';e.currentTarget.style.borderColor='rgba(239,68,68,.25)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(239,68,68,.06)';e.currentTarget.style.borderColor='rgba(239,68,68,.12)';}}>
                Sign out &amp; clear identity
              </button>
            </div>
          </div>
        )}

        {/* ══════════ MOBILE SIDEBAR OVERLAY ══════════ */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:50, backdropFilter:'blur(4px)' }}
            className="mobile-overlay"
          />
        )}

        {/* ══════════ NEW GROUP MODAL ══════════ */}
        {showNewGroup && (
          <div className="modal-bg" onClick={() => setShowNewGroup(false)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', backdropFilter:'blur(12px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div className="modal-card" onClick={e => e.stopPropagation()}
              style={{ width:460, background:'linear-gradient(145deg,#141416,#0f0f11)', border:'1px solid rgba(255,255,255,.09)', borderRadius:20, padding:28, boxShadow:'0 40px 80px rgba(0,0,0,.8)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
                <div style={{ width:38, height:38, borderRadius:12, background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M1 14c0-2.76 2.239-5 5-5s5 2.24 5 5M6 9a3 3 0 100-6 3 3 0 000 6z" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round"/><path d="M12 5a3 3 0 010 6M17 14c0-2.21-1.79-4-4-4" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round"/></svg>
                </div>
                <div>
                  <h2 style={{ color:'rgba(255,255,255,.92)', fontSize:16, fontWeight:600 }}>New group chat</h2>
                  <p style={{ color:'rgba(255,255,255,.28)', fontSize:12, marginTop:1 }}>Messages are end-to-end encrypted with a shared key</p>
                </div>
              </div>
              <div style={{ height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent)', margin:'18px 0' }}/>
              <form onSubmit={handleCreateGroup}>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:7 }}>Group name</label>
                <input autoFocus value={groupName} onChange={e => setGroupName(e.target.value.slice(0,40))} placeholder="e.g. Team, Family, Friends"
                  style={{ width:'100%', background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.08)', borderRadius:10, padding:'11px 14px', color:'rgba(255,255,255,.85)', fontSize:13.5, marginBottom:16, transition:'border-color .2s' }}
                  onFocus={e => e.target.style.borderColor='rgba(99,102,241,.5)'} onBlur={e => e.target.style.borderColor='rgba(255,255,255,.08)'}/>
                <label style={{ display:'block', color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:7 }}>Add members</label>
                <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                  <input value={groupMemberInput} onChange={e => { setGroupMemberInput(e.target.value); setGroupMemberError(''); }} placeholder="npub1… or hex pubkey"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGroupMember(); } }}
                    style={{ flex:1, background:'rgba(255,255,255,.04)', border:`1.5px solid ${groupMemberError?'rgba(239,68,68,.5)':'rgba(255,255,255,.08)'}`, borderRadius:10, padding:'10px 14px', color:'rgba(255,255,255,.85)', fontSize:12, fontFamily:"'DM Mono',monospace", transition:'border-color .2s' }}
                    onFocus={e => e.target.style.borderColor='rgba(99,102,241,.5)'} onBlur={e => e.target.style.borderColor=groupMemberError?'rgba(239,68,68,.5)':'rgba(255,255,255,.08)'}/>
                  <button type="button" onClick={addGroupMember} className="pill" style={{ padding:'10px 16px', borderRadius:9, background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)', color:'rgba(139,92,246,.85)', fontSize:12, fontWeight:600 }}>Add</button>
                </div>
                {groupMemberError && <p style={{ color:'#f87171', fontSize:11.5, marginBottom:8 }}>{groupMemberError}</p>}
                {/* Also allow picking from contacts */}
                {Object.values(contacts).length > 0 && (
                  <div style={{ marginBottom:12 }}>
                    <p style={{ color:'rgba(255,255,255,.2)', fontSize:11, marginBottom:6 }}>Or pick from contacts:</p>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {Object.values(contacts).filter(c => !groupMembers.find(m => m.pubkeyHex === c.pubkeyHex)).map(c => (
                        <button key={c.pubkeyHex} type="button" onClick={() => setGroupMembers(prev => [...prev, { pubkeyHex: c.pubkeyHex, displayName: c.displayName }])}
                          style={{ padding:'5px 11px', borderRadius:20, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.09)', color:'rgba(255,255,255,.55)', fontSize:11.5, display:'flex', alignItems:'center', gap:5 }}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(99,102,241,.1)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.05)'}>
                          <div style={{ width:16, height:16, borderRadius:5, background:avatarGrad(c.pubkeyHex), display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:700, color:'#fff' }}>{c.displayName?.[0]?.toUpperCase()}</div>
                          {c.displayName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Selected members */}
                {groupMembers.length > 0 && (
                  <div style={{ marginBottom:16 }}>
                    <p style={{ color:'rgba(255,255,255,.25)', fontSize:11, marginBottom:6 }}>Members ({groupMembers.length + 1} including you):</p>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                      {groupMembers.map(m => (
                        <div key={m.pubkeyHex} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)', borderRadius:20 }}>
                          <div style={{ width:14, height:14, borderRadius:4, background:avatarGrad(m.pubkeyHex), display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:'#fff' }}>{m.displayName?.[0]?.toUpperCase()}</div>
                          <span style={{ color:'rgba(139,92,246,.9)', fontSize:11.5 }}>{m.displayName}</span>
                          <button type="button" onClick={() => setGroupMembers(prev => prev.filter(x => x.pubkeyHex !== m.pubkeyHex))} style={{ color:'rgba(139,92,246,.5)', fontSize:14, lineHeight:1, marginLeft:1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button type="button" onClick={() => { setShowNewGroup(false); setGroupName(''); setGroupMembers([]); setGroupMemberInput(''); setGroupMemberError(''); }} className="pill" style={{ padding:'10px 18px', borderRadius:9, color:'rgba(255,255,255,.4)', fontSize:13, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.07)' }}>Cancel</button>
                  <button type="submit" disabled={groupCreating || !groupName.trim() || groupMembers.length === 0} className="pill"
                    style={{ padding:'10px 22px', borderRadius:9, fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:7, background:groupName.trim()&&groupMembers.length>0&&!groupCreating?'linear-gradient(135deg,#6366f1,#8b5cf6)':'rgba(255,255,255,.06)', color:groupName.trim()&&groupMembers.length>0&&!groupCreating?'#fff':'rgba(255,255,255,.25)', boxShadow:groupName.trim()&&groupMembers.length>0&&!groupCreating?'0 4px 16px rgba(99,102,241,.35)':'none', transition:'all .2s' }}>
                    {groupCreating ? <><div style={{ width:11, height:11, border:'1.5px solid rgba(255,255,255,.2)', borderTop:'1.5px solid #fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>Creating…</> : 'Create group'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ══════════ SIDEBAR ══════════ */}
        <div className={`sidebar-panel${sidebarOpen ? ' sidebar-open' : ''}`} style={{ width:260, flexShrink:0, display:'flex', flexDirection:'column', background:'#0b0b0d', borderRight:'1px solid rgba(255,255,255,.05)', position:'relative', zIndex:1 }}>

          {/* Header */}
          <div style={{ padding:'18px 14px 12px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, overflow:'hidden', boxShadow:'0 4px 12px rgba(99,102,241,.35)' }}>
                  <img src="/logo.svg" alt="abrigo" width={30} height={30} style={{ display:'block', width:'100%', height:'100%' }} />
                </div>
                <span style={{ color:'rgba(255,255,255,.75)', fontSize:14.5, fontWeight:600, letterSpacing:'-.02em' }}>abrigo</span>
              </div>
              <div style={{ display:'flex', gap:2, alignItems:'center' }}>
                {incomingRequests.length > 0 && <div style={{ width:7, height:7, borderRadius:'50%', background:'#f59e0b', marginRight:2, boxShadow:'0 0 6px #f59e0b', animation:'glow 2s ease infinite' }}/>}
                {[{icon:Icon.plus,action:()=>setShowAdd(true),title:'New conversation'},{icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 12c0-2.21 1.79-4 4-4s4 1.79 4 4M5 8a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10 4a3 3 0 010 6M15 12c0-1.66-1.34-3-3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,action:()=>setShowNewGroup(true),title:'New group'},{icon:Icon.settings,action:()=>setShowSettings(true),title:'Settings'}].map((btn,i) => (
                  <button key={i} onClick={btn.action} title={btn.title}
                    style={{ width:28, height:28, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.32)', transition:'all .15s' }}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.07)';e.currentTarget.style.color='rgba(255,255,255,.75)';}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='rgba(255,255,255,.32)';}} >
                    {btn.icon}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,.22)', pointerEvents:'none' }}>{Icon.search}</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
                style={{ width:'100%', background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.06)', borderRadius:9, padding:'8px 10px 8px 30px', color:'rgba(255,255,255,.65)', fontSize:12.5 }}
                onFocus={e=>e.target.style.borderColor='rgba(99,102,241,.35)'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.06)'}/>
            </div>
          </div>

          {/* Incoming requests */}
          {incomingRequests.length > 0 && (
            <div style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              {incomingRequests.map(req => (
                <div key={req.fromPubkey} style={{ margin:'8px 10px', padding:'11px 12px', background:'rgba(245,158,11,.05)', border:'1px solid rgba(245,158,11,.12)', borderRadius:11 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:9 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:avatarGrad(req.fromPubkey), display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{(req.displayName?.[0]||'?').toUpperCase()}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ color:'rgba(255,255,255,.75)', fontSize:12, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{req.displayName||'Unknown'}</p>
                      <p style={{ color:'rgba(245,158,11,.6)', fontSize:10.5, fontWeight:500 }}>Message request</p>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={() => handleAccept(req.fromPubkey, req.displayName)} style={{ flex:1, padding:'6px 0', borderRadius:7, background:'rgba(52,211,153,.1)', color:'#34d399', fontSize:11.5, fontWeight:600, border:'1px solid rgba(52,211,153,.2)' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(52,211,153,.18)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(52,211,153,.1)'}>Accept</button>
                    <button onClick={() => handleDecline(req.fromPubkey)} style={{ flex:1, padding:'6px 0', borderRadius:7, background:'rgba(239,68,68,.06)', color:'rgba(248,113,113,.8)', fontSize:11.5, fontWeight:600, border:'1px solid rgba(239,68,68,.14)' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.12)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,.06)'}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Groups section */}
          {groups.length > 0 && (
            <div style={{ borderBottom:'1px solid rgba(255,255,255,.04)', paddingBottom:4 }}>
              <div style={{ padding:'8px 14px 4px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase' }}>Groups</span>
                <button onClick={() => setShowNewGroup(true)} style={{ color:'rgba(255,255,255,.25)', fontSize:16, lineHeight:1 }} onMouseEnter={e=>e.currentTarget.style.color='rgba(139,92,246,.8)'} onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.25)'}>+</button>
              </div>
              {groups.filter(g => !search || g.name?.toLowerCase().includes(search.toLowerCase())).map(g => {
                const active = g.groupId === groupId;
                return (
                  <div key={g.groupId} className="contact-row"
                    style={{ position:'relative', background:active?'rgba(99,102,241,.08)':'transparent', borderLeft:`2px solid ${active?'rgba(99,102,241,.6)':'transparent'}`, transition:'all .12s' }}>
                    <button onClick={() => router.push(`/chat/${g.groupId}`)}
                      style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'9px 12px 9px 10px', textAlign:'left' }}>
                      <div style={{ width:36, height:36, borderRadius:11, background:active?avatarGrad(g.groupId):'rgba(255,255,255,.07)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:12, fontWeight:700, color:active?'#fff':'rgba(255,255,255,.35)', transition:'all .2s', position:'relative' }}>
                        {g.name?.[0]?.toUpperCase()}
                        <div style={{ position:'absolute', bottom:-2, right:-2, width:12, height:12, borderRadius:'50%', background:'rgba(99,102,241,.9)', border:'2px solid #0b0b0d', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="6" height="6" viewBox="0 0 8 8" fill="none"><path d="M1 6c0-1.66 1.34-3 3-3s3 1.34 3 3M4 3a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" stroke="white" strokeWidth="1" strokeLinecap="round"/></svg>
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ color:active?'rgba(255,255,255,.92)':'rgba(255,255,255,.62)', fontSize:13.5, fontWeight:active?500:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name}</p>
                        <p style={{ color:'rgba(255,255,255,.2)', fontSize:10.5 }}>{g.members?.length || 0} members</p>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Contact list */}
          <div style={{ flex:1, overflowY:'auto', padding:'6px 0' }}>
            {filteredContacts.length === 0 ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:10, paddingBottom:'20%' }}>
                <div style={{ width:46, height:46, borderRadius:14, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', display:'flex', alignItems:'center', justifyContent:'center', animation:'floatY 4s ease-in-out infinite' }}>
                  <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M2 6a3 3 0 013-3h12a3 3 0 013 3v8a3 3 0 01-3 3h-5l-4 3v-3H5a3 3 0 01-3-3V6z" stroke="rgba(255,255,255,.15)" strokeWidth="1.4" strokeLinejoin="round"/></svg>
                </div>
                <p style={{ color:'rgba(255,255,255,.18)', fontSize:12.5 }}>{search ? 'No results' : 'No conversations yet'}</p>
                {!search && <p style={{ color:'rgba(255,255,255,.08)', fontSize:11 }}>Press + to begin</p>}
              </div>
            ) : filteredContacts.map(c => {
              const active = c.pubkeyHex === peerPubkey;
              const reqSt  = requestStates[c.pubkeyHex]?.status;
              const badgeCol   = reqSt==='declined'?'#ef4444':'#f59e0b';
              const badgeLabel = reqSt==='pending_sent'?'Sent':reqSt==='pending_incoming'?'Incoming':reqSt==='declined'?'Declined':null;
              return (
                <div key={c.pubkeyHex} className="contact-row"
                  style={{ position:'relative', background:active?'rgba(99,102,241,.08)':'transparent', borderLeft:`2px solid ${active?'rgba(99,102,241,.6)':'transparent'}`, transition:'all .12s' }}>
                  <button onClick={() => router.push(`/chat/${c.pubkeyHex}`)}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px 10px 10px', textAlign:'left' }}>
                    <div style={{ width:36, height:36, borderRadius:11, background:active?avatarGrad(c.pubkeyHex):'rgba(255,255,255,.07)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:14, fontWeight:700, color:active?'#fff':'rgba(255,255,255,.35)', transition:'all .2s', boxShadow:active?'0 4px 12px rgba(0,0,0,.3)':'none' }}>
                      {(c.displayName?.[0]||'?').toUpperCase()}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ color:active?'rgba(255,255,255,.92)':'rgba(255,255,255,.62)', fontSize:13.5, fontWeight:active?500:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.displayName}</p>
                      {badgeLabel
                        ? <p style={{ color:badgeCol, fontSize:10.5, fontWeight:600, opacity:.8 }}>{badgeLabel}</p>
                        : <p style={{ color:'rgba(255,255,255,.18)', fontSize:10.5, fontFamily:"'DM Mono',monospace", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.npub?.slice(0,18)}…</p>}
                    </div>
                  </button>
                  <button className="del-btn" onClick={() => handleRemoveContact(c.pubkeyHex)}
                    style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', opacity:0, width:22, height:22, borderRadius:6, background:'rgba(239,68,68,.12)', color:'rgba(248,113,113,.7)', fontSize:15, display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity .15s', border:'1px solid rgba(239,68,68,.15)' }}>×</button>
                </div>
              );
            })}
          </div>

          {/* New group button if no groups yet */}
          {groups.length === 0 && (
            <div style={{ padding:'4px 8px 8px' }}>
              <button onClick={() => setShowNewGroup(true)}
                style={{ width:'100%', padding:'8px 12px', borderRadius:10, background:'rgba(255,255,255,.025)', border:'1px dashed rgba(255,255,255,.08)', color:'rgba(255,255,255,.3)', fontSize:12, display:'flex', alignItems:'center', gap:7, transition:'all .15s' }}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(99,102,241,.06)';e.currentTarget.style.borderColor='rgba(99,102,241,.2)';e.currentTarget.style.color='rgba(139,92,246,.7)';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.025)';e.currentTarget.style.borderColor='rgba(255,255,255,.08)';e.currentTarget.style.color='rgba(255,255,255,.3)';}}>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                New group chat
              </button>
            </div>
          )}

          {/* Footer */}
          <div
            style={{ padding:'10px 12px', borderTop:'1px solid rgba(255,255,255,.04)', display:'flex', alignItems:'center', gap:9, cursor:'pointer', transition:'background .15s', borderRadius:'0 0 0 0' }}
            onClick={() => setShowSettings(true)}
            title="Open settings"
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{ width:30, height:30, borderRadius:9, background:avatarGrad(identity.pubkeyHex), display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 }}>{identity.displayName?.[0]?.toUpperCase()}</div>
            <div style={{ flex:1, minWidth:0 }}><p style={{ color:'rgba(255,255,255,.55)', fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight:500 }}>{identity.displayName}</p></div>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              {(syncing || mediaSending) && <div style={{ width:9, height:9, border:'1.5px solid rgba(255,255,255,.08)', borderTop:'1.5px solid rgba(99,102,241,.8)', borderRadius:'50%', animation:'spin .9s linear infinite' }}/>}
              <div style={{ width:7, height:7, borderRadius:'50%', background:relayColor, ...(relayStatus==='connected'?{boxShadow:`0 0 5px ${relayColor}`}:{}) }} title={relayStatus}/>
            </div>
          </div>
        </div>

        {/* ══════════ MAIN AREA ══════════ */}
        {!peerPubkey && !isGroup ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#080809', position:'relative', zIndex:1, minWidth:0 }}>
            {/* Mobile top bar - empty state */}
            <div className="mobile-topbar" style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,.05)', display:'none', alignItems:'center', gap:12, flexShrink:0, background:'rgba(8,8,9,.95)', backdropFilter:'blur(20px)' }}>
              <button onClick={() => setSidebarOpen(true)} style={{ width:34, height:34, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.5)', background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)', flexShrink:0 }}>
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              <span style={{ color:'rgba(255,255,255,.6)', fontSize:15, fontWeight:600 }}>abrigo</span>
            </div>
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ textAlign:'center', maxWidth:340 }}>
              <div style={{ width:72, height:72, borderRadius:22, overflow:'hidden', margin:'0 auto 20px', animation:'floatY 5s ease-in-out infinite', boxShadow:'0 8px 32px rgba(99,102,241,.25)' }}>
                <img src="/logo.svg" alt="abrigo" style={{ width:'100%', height:'100%', display:'block' }} />
              </div>
              <h2 style={{ color:'rgba(255,255,255,.7)', fontSize:18, fontWeight:600, marginBottom:6 }}>Your messages</h2>
              <p style={{ color:'rgba(255,255,255,.2)', fontSize:13, lineHeight:1.7, marginBottom:20 }}>Select a conversation or start a new one. All messages are end-to-end encrypted.</p>
              <div style={{ padding:'16px 20px', background:'rgba(255,255,255,.025)', border:'1px solid rgba(255,255,255,.06)', borderRadius:14, textAlign:'left', marginBottom:12 }}>
                <p style={{ color:'rgba(255,255,255,.28)', fontSize:11, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', marginBottom:10 }}>Your public key</p>
                <p style={{ color:'rgba(255,255,255,.45)', fontSize:10.5, fontFamily:"'DM Mono',monospace", wordBreak:'break-all', lineHeight:1.7, marginBottom:12 }}>{identity.npub}</p>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => copy(identity.npub, 'npub-main')} className="pill"
                    style={{ flex:1, padding:'8px', borderRadius:8, background:copied==='npub-main'?'rgba(52,211,153,.1)':'rgba(99,102,241,.08)', color:copied==='npub-main'?'#34d399':'rgba(139,92,246,.8)', fontSize:12, border:`1px solid ${copied==='npub-main'?'rgba(52,211,153,.2)':'rgba(99,102,241,.15)'}`, fontWeight:500 }}>
                    {copied==='npub-main'?'✓ Copied':'Copy npub'}
                  </button>
                  <button onClick={() => setShowShare(true)} className="pill"
                    style={{ flex:1, padding:'8px', borderRadius:8, background:'rgba(99,102,241,.12)', color:'rgba(139,92,246,.9)', fontSize:12, border:'1px solid rgba(99,102,241,.2)', fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="11" cy="2.5" r="1.8" stroke="currentColor" strokeWidth="1.2"/><circle cx="11" cy="11.5" r="1.8" stroke="currentColor" strokeWidth="1.2"/><circle cx="3" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.2"/><path d="M4.7 6.1L9.3 3.4M4.7 7.9l4.6 2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    Share & QR
                  </button>
                </div>
              </div>
            </div>
            </div>
          </div>
        ) : isGroup ? (
          /* ══════════ GROUP CHAT MAIN AREA ══════════ */
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, background:'#080809', position:'relative', zIndex:1 }}
            onClick={() => { setMenuMsg(null); setEmojiPickerMsg(null); }}>

            {/* Group header */}
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,.05)', display:'flex', alignItems:'center', gap:10, flexShrink:0, background:'rgba(8,8,9,.9)', backdropFilter:'blur(20px)' }}>
              <button onClick={(e) => { e.stopPropagation(); setSidebarOpen(true); }} className="mobile-menu-btn" style={{ width:34, height:34, borderRadius:10, display:'none', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.45)', background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.07)', flexShrink:0 }}>
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              {/* Group avatar */}
              <div style={{ width:38, height:38, borderRadius:12, background:avatarGrad(groupId||''), display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#fff', boxShadow:'0 4px 12px rgba(0,0,0,.3)', flexShrink:0, position:'relative' }}>
                {currentGroup?.name?.[0]?.toUpperCase() || '#'}
                <div style={{ position:'absolute', bottom:-3, right:-3, width:14, height:14, borderRadius:'50%', background:'rgba(99,102,241,.9)', border:'2.5px solid #080809', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 6.5c0-1.66 1.34-3 3-3s3 1.34 3 3M4 3.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" stroke="white" strokeWidth="1" strokeLinecap="round"/></svg>
                </div>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ color:'rgba(255,255,255,.88)', fontSize:14.5, fontWeight:600 }}>{currentGroup?.name || 'Group'}</p>
                {/* Member mini-avatars */}
                <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:3 }}>
                  {(currentGroup?.members||[]).slice(0,5).map(m => (
                    <div key={m} style={{ width:14, height:14, borderRadius:4, background:avatarGrad(m), display:'flex', alignItems:'center', justifyContent:'center', fontSize:6, fontWeight:700, color:'#fff', border:'1px solid #080809' }}>
                      {(contacts[m]?.displayName?.[0] || m[0]).toUpperCase()}
                    </div>
                  ))}
                  {(currentGroup?.members||[]).length > 5 && <span style={{ color:'rgba(255,255,255,.25)', fontSize:10 }}>+{currentGroup.members.length - 5}</span>}
                  <span style={{ color:'rgba(255,255,255,.2)', fontSize:10, marginLeft:3 }}>{currentGroup?.members?.length || 0} members</span>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); setShowGroupInfo(v => !v); }}
                style={{ width:34, height:34, borderRadius:10, background:showGroupInfo?'rgba(99,102,241,.15)':'rgba(255,255,255,.05)', border:`1px solid ${showGroupInfo?'rgba(99,102,241,.3)':'rgba(255,255,255,.08)'}`, display:'flex', alignItems:'center', justifyContent:'center', color:showGroupInfo?'#a78bfa':'rgba(255,255,255,.45)', flexShrink:0, transition:'all .15s' }}>
                {Icon.settings}
              </button>
              <div className="enc-badge" style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', background:'rgba(52,211,153,.05)', border:'1px solid rgba(52,211,153,.1)', borderRadius:20 }}>
                {Icon.lock}
                <span style={{ color:'rgba(52,211,153,.65)', fontSize:10.5, fontWeight:500 }}>Encrypted</span>
              </div>
            </div>

            <div style={{ flex:1, display:'flex', minHeight:0 }}>
              {/* Messages */}
              <div className="messages-area" style={{ flex:1, overflowY:'auto', padding:'16px 24px 8px', display:'flex', flexDirection:'column' }}>
                {loadingMsgs ? (
                  <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
                    <div style={{ display:'flex', gap:6 }}>{[0,1,2].map(i => <div key={i} style={{ width:8, height:8, borderRadius:'50%', background:'rgba(99,102,241,.5)', animation:`dotBounce 1.4s ease-in-out ${i*.2}s infinite` }}/>)}</div>
                    <p style={{ color:'rgba(255,255,255,.2)', fontSize:12 }}>Loading group messages…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
                    <div style={{ width:56, height:56, borderRadius:18, background:avatarGrad(groupId||''), display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:'#fff', boxShadow:'0 8px 28px rgba(0,0,0,.4)', animation:'floatY 5s ease-in-out infinite' }}>{currentGroup?.name?.[0]?.toUpperCase()||'#'}</div>
                    <p style={{ color:'rgba(255,255,255,.35)', fontSize:14, fontWeight:500 }}>Start the conversation in {currentGroup?.name}</p>
                    <p style={{ color:'rgba(255,255,255,.12)', fontSize:11.5 }}>AES-256-GCM · End-to-end encrypted</p>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    {messages.map((msg, i) => {
                      const prev = messages[i-1], next = messages[i+1];
                      const isLast  = !next || next.from !== msg.from;
                      const isFirst = !prev || prev.from !== msg.from;
                      const showDate = i===0 || new Date(msg.ts).toDateString() !== new Date(messages[i-1].ts).toDateString();
                      const senderName = msg.mine ? 'You' : (contacts[msg.from]?.displayName || msg.from?.slice(0,12));
                      const audioSrc = msg.msgType==='media'&&msg.mediaType==='audio' ? `data:${msg.mimeType||'audio/webm'};base64,${msg.data}` : null;
                      return (
                        <div key={msg.id}>
                          {showDate && (
                            <div style={{ display:'flex', alignItems:'center', gap:10, margin:'16px 0 10px' }}>
                              <div style={{ flex:1, height:1, background:'rgba(255,255,255,.05)' }}/>
                              <span style={{ color:'rgba(255,255,255,.18)', fontSize:10.5, fontWeight:500 }}>{new Date(msg.ts).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</span>
                              <div style={{ flex:1, height:1, background:'rgba(255,255,255,.05)' }}/>
                            </div>
                          )}
                          <div style={{ display:'flex', justifyContent:msg.mine?'flex-end':'flex-start', marginTop:isFirst&&i>0&&!showDate?12:2, paddingBottom:isLast?4:1, alignItems:'flex-end', gap:8 }}>
                            {!msg.mine && (
                              <div style={{ width:28, flexShrink:0, alignSelf:'flex-end' }}>
                                {isLast && <div style={{ width:26, height:26, borderRadius:8, background:avatarGrad(msg.from), display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#fff' }} title={senderName}>{senderName[0]?.toUpperCase()}</div>}
                              </div>
                            )}
                            <div style={{ maxWidth:'60%' }}>
                              {isFirst && !msg.mine && <p style={{ color:'rgba(255,255,255,.3)', fontSize:10.5, fontWeight:600, marginBottom:3, paddingLeft:2 }}>{senderName}</p>}
                              <div style={{
                                padding: audioSrc ? 0 : (msg.msgType==='media'&&msg.mediaType==='image') ? '4px' : '10px 14px',
                                borderRadius:16,
                                borderBottomRightRadius: msg.mine ? (isLast?5:16) : 16,
                                borderBottomLeftRadius: !msg.mine ? (isLast?5:16) : 16,
                                background: msg.mine ? 'linear-gradient(135deg,#6366f1,#7c3aed)' : 'rgba(255,255,255,.07)',
                                border: msg.mine ? 'none' : '1px solid rgba(255,255,255,.08)',
                                boxShadow: msg.mine ? '0 4px 16px rgba(99,102,241,.25)' : 'none',
                                overflow:'hidden',
                              }}>
                                {audioSrc ? (
                                  <AudioPlayer src={audioSrc} isMine={msg.mine} />
                                ) : msg.msgType==='media' && msg.mediaType==='image' ? (
                                  <img src={`data:${msg.mimeType||'image/jpeg'};base64,${msg.data}`} alt=""
                                    style={{ maxWidth:'100%', maxHeight:220, borderRadius:13, display:'block', cursor:'pointer', objectFit:'cover' }}
                                    onClick={() => setLightboxSrc(`data:${msg.mimeType||'image/jpeg'};base64,${msg.data}`)}/>
                                ) : (
                                  <p style={{ fontSize:13.5, lineHeight:1.55, color:msg.mine?'rgba(255,255,255,.92)':'rgba(255,255,255,.82)', wordBreak:'break-word', whiteSpace:'pre-wrap' }}>{msg.text}</p>
                                )}
                              </div>
                              {isLast && <p style={{ fontSize:10, color:'rgba(255,255,255,.18)', marginTop:4, textAlign:msg.mine?'right':'left' }}>{fmtTime(msg.ts)}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef}/>
                  </div>
                )}
              </div>

              {/* Group info panel */}
              {showGroupInfo && currentGroup && (
                <div style={{ width:220, flexShrink:0, borderLeft:'1px solid rgba(255,255,255,.05)', background:'rgba(8,8,9,.8)', overflowY:'auto', padding:'16px 14px' }}>
                  <p style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:12 }}>Group Info</p>
                  <div style={{ width:52, height:52, borderRadius:16, background:avatarGrad(currentGroup.groupId), display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:700, color:'#fff', margin:'0 auto 10px', boxShadow:'0 4px 16px rgba(0,0,0,.4)' }}>{currentGroup.name?.[0]?.toUpperCase()}</div>
                  <p style={{ color:'rgba(255,255,255,.75)', fontSize:14, fontWeight:600, textAlign:'center', marginBottom:4 }}>{currentGroup.name}</p>
                  <p style={{ color:'rgba(255,255,255,.2)', fontSize:11, textAlign:'center', marginBottom:18 }}>Created {new Date(currentGroup.createdAt).toLocaleDateString()}</p>
                  <p style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:8 }}>Members</p>
                  {currentGroup.members.map(m => (
                    <div key={m} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                      <div style={{ width:28, height:28, borderRadius:8, background:avatarGrad(m), display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#fff', flexShrink:0 }}>{(contacts[m]?.displayName?.[0] || m[0])?.toUpperCase()}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ color:'rgba(255,255,255,.65)', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m === identity.pubkeyHex ? 'You' : (contacts[m]?.displayName || m.slice(0,12))}</p>
                        {m === currentGroup.createdBy && <p style={{ color:'rgba(99,102,241,.6)', fontSize:9.5 }}>Admin</p>}
                      </div>
                    </div>
                  ))}
                  {/* Add member */}
                  {currentGroup.createdBy === identity.pubkeyHex && (
                    <div style={{ marginTop:14 }}>
                      <p style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:8 }}>Add member</p>
                      <input value={addMemberInput} onChange={e => { setAddMemberInput(e.target.value); setAddMemberError(''); }} placeholder="npub1… or hex"
                        style={{ width:'100%', background:'rgba(255,255,255,.04)', border:`1.5px solid ${addMemberError?'rgba(239,68,68,.4)':'rgba(255,255,255,.08)'}`, borderRadius:9, padding:'8px 10px', color:'rgba(255,255,255,.75)', fontSize:11.5, fontFamily:"'DM Mono',monospace", marginBottom:6 }}
                        onFocus={e=>e.target.style.borderColor='rgba(99,102,241,.4)'} onBlur={e=>e.target.style.borderColor=addMemberError?'rgba(239,68,68,.4)':'rgba(255,255,255,.08)'}
                        onKeyDown={async e => {
                          if (e.key !== 'Enter') return;
                          const raw = addMemberInput.trim();
                          let pk = isValidNpub(raw) ? npubToPubkeyHex(raw) : isValidPubkeyHex(raw) ? raw.toLowerCase() : null;
                          if (!pk) { setAddMemberError('Invalid key'); return; }
                          if (currentGroup.members.includes(pk)) { setAddMemberError('Already a member'); return; }
                          const updated = { ...currentGroup, members: [...currentGroup.members, pk] };
                          await saveGroup(updated); setCurrentGroup(updated);
                          setGroups(prev => prev.map(g => g.groupId === updated.groupId ? updated : g));

                          // Re-invite ALL members (including the new one) so everyone has the updated member list
                          for (const mHex of updated.members) {
                            if (mHex === identity.pubkeyHex) continue; // skip ourselves
                            const ev = buildGroupInviteEvent(updated.groupId, updated.groupKeyHex, updated.name, updated.members, identity.privkeyHex, mHex);
                            await publishEvent(ev);
                            await new Promise(r => setTimeout(r, 100)); // small delay
                          }
                          setAddMemberInput(''); setAddMemberError('');
                        }}/>
                      {addMemberError && <p style={{ color:'#f87171', fontSize:10.5 }}>{addMemberError}</p>}
                      <p style={{ color:'rgba(255,255,255,.15)', fontSize:10, marginTop:4 }}>Press Enter to add</p>
                    </div>
                  )}

                  {currentGroup.createdBy === identity.pubkeyHex ? (
                    <button onClick={async () => {
                        if (confirm('Delete this group? This will remove it from your device for everyone. Since this is decentralized, others might still see it until they also remove it.')) {
                          await deleteGroup(currentGroup.groupId);
                          setGroups(prev => prev.filter(g => g.groupId !== currentGroup.groupId));
                          router.push('/chat/_');
                        }
                      }}
                      style={{ width:'100%', marginTop:18, padding:'8px', borderRadius:9, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.12)', color:'rgba(248,113,113,.7)', fontSize:11.5, fontWeight:600 }}
                      onMouseEnter={e=>{e.currentTarget.style.background='rgba(239,68,68,.12)';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(239,68,68,.06)';}}>
                      Delete group
                    </button>
                  ) : (
                    <button onClick={async () => {
                        await deleteGroup(currentGroup.groupId);
                        setGroups(prev => prev.filter(g => g.groupId !== currentGroup.groupId));
                        router.push('/chat/_');
                      }}
                      style={{ width:'100%', marginTop:18, padding:'8px', borderRadius:9, background:'rgba(239,68,68,.04)', border:'1px solid rgba(255,255,255,.05)', color:'rgba(255,255,255,.35)', fontSize:11.5, fontWeight:500 }}
                      onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.08)';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(239,68,68,.06)';}}>
                      Leave group
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Relay warning */}
            {relayStatus !== 'connected' && (
              <div style={{ margin:'0 20px 6px', display:'flex', alignItems:'center', gap:8, padding:'7px 13px', background:'rgba(245,158,11,.04)', border:'1px solid rgba(245,158,11,.1)', borderRadius:9 }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:relayColor, flexShrink:0 }}/>
                <p style={{ color:'rgba(245,158,11,.55)', fontSize:11.5, flex:1 }}>{relayStatus==='connecting'?'Connecting to relays…':'Relay disconnected'}</p>
              </div>
            )}
            {mediaSending && (
              <div style={{ margin:'0 20px 6px', display:'flex', alignItems:'center', gap:8, padding:'7px 13px', background:'rgba(99,102,241,.04)', border:'1px solid rgba(99,102,241,.12)', borderRadius:9 }}>
                <div style={{ width:10, height:10, border:'1.5px solid rgba(255,255,255,.1)', borderTop:'1.5px solid #6366f1', borderRadius:'50%', animation:'spin .8s linear infinite', flexShrink:0 }}/>
                <p style={{ color:'rgba(139,92,246,.7)', fontSize:11.5 }}>Sending media…</p>
              </div>
            )}

            {/* Group input */}
            <div className="input-area" style={{ padding:'8px 20px 16px', flexShrink:0 }}>
              <div className="input-box" style={{ display:'flex', alignItems:'flex-end', gap:8, background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.07)', borderRadius:16, padding:'8px 8px 8px 14px', transition:'border-color .2s,box-shadow .2s' }}>
                <button onClick={() => fileImgRef.current?.click()} className="med-btn" title="Send image"
                  style={{ width:30, height:30, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.35)', background:'transparent' }} disabled={mediaSending}>
                  {Icon.image}
                </button>
                <div style={{ width:1, height:20, background:'rgba(255,255,255,.07)', alignSelf:'flex-end', marginBottom:5 }}/>
                <textarea ref={inputRef} value={input}
                  onChange={e => { setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,130)+'px'; }}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${currentGroup?.name||'group'}…`}
                  rows={1}
                  style={{ flex:1, background:'transparent', border:'none', color:'rgba(255,255,255,.85)', fontSize:14, lineHeight:1.55, minHeight:26, maxHeight:130, overflowY:'auto' }}/>
                <button onClick={handleGroupSend} disabled={sending||!input.trim()} className="send-btn"
                  style={{ width:36, height:36, borderRadius:11, background:input.trim()&&!sending?'linear-gradient(135deg,#6366f1,#7c3aed)':'rgba(255,255,255,.05)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:input.trim()&&!sending?'0 4px 14px rgba(99,102,241,.4)':'none', border:'none', color:input.trim()&&!sending?'#fff':'rgba(255,255,255,.2)' }}>
                  {sending ? <div style={{ width:12, height:12, border:'1.5px solid rgba(255,255,255,.2)', borderTop:'1.5px solid #fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/> : Icon.send}
                </button>
              </div>
            </div>

            {/* Hidden image file input — group version */}
            <input type="file" accept="image/*" style={{ display:'none' }}
              onChange={e => { if (e.target.files[0]) handleGroupImageFile(e.target.files[0]); e.target.value=''; }}
              ref={r => { if (r && isGroup) fileImgRef._groupRef = r; }}/>
          </div>
        ) : peerPubkey ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, background:'#080809', position:'relative', zIndex:1 }}
            onClick={() => { setMenuMsg(null); setEmojiPickerMsg(null); }}>

            {/* Chat header */}
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,.05)', display:'flex', alignItems:'center', gap:10, flexShrink:0, background:'rgba(8,8,9,.9)', backdropFilter:'blur(20px)' }}>
              {/* Hamburger — mobile only */}
              <button onClick={(e) => { e.stopPropagation(); setSidebarOpen(true); }} className="mobile-menu-btn" style={{ width:34, height:34, borderRadius:10, display:'none', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.45)', background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.07)', flexShrink:0 }}>
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              <div style={{ width:38, height:38, borderRadius:12, background:avatarGrad(peerPubkey), display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#fff', boxShadow:'0 4px 12px rgba(0,0,0,.3)', flexShrink:0 }}>{peerName(peerPubkey)?.[0]?.toUpperCase()||'?'}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ color:'rgba(255,255,255,.88)', fontSize:14.5, fontWeight:600 }}>{peerName(peerPubkey)}</p>
                <p className="npub-sub" style={{ color:'rgba(255,255,255,.2)', fontSize:10, fontFamily:"'DM Mono',monospace", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pubkeyHexToNpub(peerPubkey)?.slice(0,32)}…</p>
              </div>
              {/* ── Call buttons ── */}
              {canChat && (
                <>
                  <button onClick={() => startCall(false)} title="Voice call"
                    style={{ width:34, height:34, borderRadius:10, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.5)', transition:'all .15s', flexShrink:0 }}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(99,102,241,.15)';e.currentTarget.style.color='#a78bfa';e.currentTarget.style.borderColor='rgba(99,102,241,.3)';}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.05)';e.currentTarget.style.color='rgba(255,255,255,.5)';e.currentTarget.style.borderColor='rgba(255,255,255,.08)';}}
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="currentColor"/></svg>
                  </button>
                  <button onClick={() => startCall(true)} title="Video call"
                    style={{ width:34, height:34, borderRadius:10, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.5)', transition:'all .15s', flexShrink:0 }}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(99,102,241,.15)';e.currentTarget.style.color='#a78bfa';e.currentTarget.style.borderColor='rgba(99,102,241,.3)';}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.05)';e.currentTarget.style.color='rgba(255,255,255,.5)';e.currentTarget.style.borderColor='rgba(255,255,255,.08)';}}
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M2 7a2 2 0 012-2h7a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" fill="currentColor"/><path d="M14 8.5l4-2.5v8l-4-2.5v-3z" fill="currentColor"/></svg>
                  </button>
                </>
              )}
              <div className="enc-badge" style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', background:'rgba(52,211,153,.05)', border:'1px solid rgba(52,211,153,.1)', borderRadius:20 }}>
                {syncing ? <div style={{ width:7, height:7, border:'1.5px solid rgba(255,255,255,.1)', borderTop:'1.5px solid #34d399', borderRadius:'50%', animation:'spin .9s linear infinite' }}/> : <span style={{ color:'rgba(52,211,153,.7)', display:'flex' }}>{Icon.lock}</span>}
                <span style={{ color:'rgba(52,211,153,.65)', fontSize:10.5, fontWeight:500 }}>{syncing?'Syncing…':'Encrypted'}</span>
              </div>
            </div>

            {/* Request banners */}
            {currentReqState==='pending_sent' && (
              <div style={{ margin:'14px 20px 0', padding:'14px 18px', background:'rgba(245,158,11,.04)', border:'1px solid rgba(245,158,11,.12)', borderRadius:13, display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:11, background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><svg width="16" height="16" viewBox="0 0 17 17" fill="none"><path d="M1.5 8.5L15.5 2l-4 13-3-5.5-7 .5z" stroke="rgba(245,158,11,.8)" strokeWidth="1.3" strokeLinejoin="round"/></svg></div>
                <div><p style={{ color:'rgba(245,158,11,.85)', fontSize:13, fontWeight:600, marginBottom:2 }}>Request sent</p><p style={{ color:'rgba(255,255,255,.25)', fontSize:12 }}>Waiting for {peerName(peerPubkey)} to accept.</p></div>
              </div>
            )}
            {currentReqState==='declined' && (
              <div style={{ margin:'14px 20px 0', padding:'14px 18px', background:'rgba(239,68,68,.04)', border:'1px solid rgba(239,68,68,.12)', borderRadius:13, display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:11, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.18)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="rgba(248,113,113,.7)" strokeWidth="1.2"/><path d="M5 5l6 6M11 5l-6 6" stroke="rgba(248,113,113,.7)" strokeWidth="1.4" strokeLinecap="round"/></svg></div>
                <div><p style={{ color:'#f87171', fontSize:13, fontWeight:600, marginBottom:2 }}>Request declined</p><p style={{ color:'rgba(255,255,255,.25)', fontSize:12 }}>{peerName(peerPubkey)} declined your message request.</p></div>
              </div>
            )}
            {currentReqState==='pending_incoming' && (
              <div style={{ margin:'14px 20px 0', padding:'16px 18px', background:'rgba(99,102,241,.04)', border:'1px solid rgba(99,102,241,.14)', borderRadius:13 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                  <div style={{ width:38, height:38, borderRadius:12, background:avatarGrad(peerPubkey), display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#fff' }}>{peerName(peerPubkey)?.[0]?.toUpperCase()||'?'}</div>
                  <div><p style={{ color:'rgba(255,255,255,.8)', fontSize:13.5, fontWeight:600 }}>{peerName(peerPubkey)}</p><p style={{ color:'rgba(139,92,246,.7)', fontSize:11.5 }}>wants to start a conversation</p></div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => handleAccept(peerPubkey, contacts[peerPubkey]?.displayName||'')}
                    style={{ flex:1, padding:'9px', borderRadius:9, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontSize:13, fontWeight:600, boxShadow:'0 4px 14px rgba(99,102,241,.3)', transition:'all .2s' }}
                    onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 6px 20px rgba(99,102,241,.45)';e.currentTarget.style.transform='translateY(-1px)';}}
                    onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 4px 14px rgba(99,102,241,.3)';e.currentTarget.style.transform='none';}}>Accept &amp; Chat</button>
                  <button onClick={() => handleDecline(peerPubkey)} style={{ padding:'9px 16px', borderRadius:9, background:'rgba(239,68,68,.07)', color:'rgba(248,113,113,.8)', fontSize:13, fontWeight:600, border:'1px solid rgba(239,68,68,.15)', transition:'all .15s' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.14)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,.07)'}>Decline</button>
                </div>
              </div>
            )}

            {/* ── Messages ── */}
            <div className="messages-area" style={{ flex:1, overflowY:'auto', padding:'16px 24px 8px', display:'flex', flexDirection:'column' }}>
              {loadingMsgs ? (
                <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
                  <div style={{ display:'flex', gap:6 }}>{[0,1,2].map(i => <div key={i} style={{ width:8, height:8, borderRadius:'50%', background:'rgba(99,102,241,.5)', animation:`dotBounce 1.4s ease-in-out ${i*.2}s infinite` }}/>)}</div>
                  <p style={{ color:'rgba(255,255,255,.2)', fontSize:12 }}>Loading messages…</p>
                </div>
              ) : messages.length === 0 ? (
                <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
                  <div style={{ width:56, height:56, borderRadius:18, background:avatarGrad(peerPubkey), display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:'#fff', boxShadow:'0 8px 28px rgba(0,0,0,.4)', animation:'floatY 5s ease-in-out infinite' }}>{peerName(peerPubkey)?.[0]?.toUpperCase()||'?'}</div>
                  <p style={{ color:'rgba(255,255,255,.35)', fontSize:14, fontWeight:500 }}>{canChat ? `Say hello to ${peerName(peerPubkey)}` : 'No messages yet'}</p>
                  <p style={{ color:'rgba(255,255,255,.12)', fontSize:11.5 }}>NIP-44 · End-to-end encrypted</p>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                  {messages.map((msg, i) => {
                    const prev = messages[i-1], next = messages[i+1];
                    const isLast  = !next || next.mine !== msg.mine;
                    const isFirst = !prev || prev.mine !== msg.mine;
                    const showDate = i===0 || new Date(msg.ts).toDateString() !== new Date(messages[i-1].ts).toDateString();
                    const rxEntries = Object.entries(msg.reactions||{}).filter(([,u])=>u.length>0);
                    const audioSrc  = msg.msgType==='media'&&msg.mediaType==='audio' ? `data:${msg.mimeType||'audio/webm'};base64,${msg.data}` : null;

                    return (
                      <div key={msg.id}>
                        {showDate && (
                          <div style={{ display:'flex', alignItems:'center', gap:10, margin:'16px 0 10px' }}>
                            <div style={{ flex:1, height:1, background:'rgba(255,255,255,.05)' }}/>
                            <span style={{ color:'rgba(255,255,255,.18)', fontSize:10.5, fontWeight:500, letterSpacing:'.04em' }}>{new Date(msg.ts).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</span>
                            <div style={{ flex:1, height:1, background:'rgba(255,255,255,.05)' }}/>
                          </div>
                        )}

                        <div className="msg-wrap"
                          style={{ display:'flex', justifyContent:msg.mine?'flex-end':'flex-start', marginTop:isFirst&&i>0&&!showDate?12:2, paddingBottom:isLast?6:1, position:'relative', alignItems:'flex-end', gap:8 }}>

                          {/* Peer avatar */}
                          {!msg.mine && (
                            <div style={{ width:26, flexShrink:0, alignSelf:'flex-end' }}>
                              {isLast && <div style={{ width:24, height:24, borderRadius:8, background:avatarGrad(peerPubkey), display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#fff' }}>{peerName(peerPubkey)?.[0]?.toUpperCase()}</div>}
                            </div>
                          )}

                          <div className="msg-bubble-wrap" style={{ maxWidth:'60%', position:'relative' }}>

                            {/* ── Floating action bar ── */}
                            <div className="msg-bar"
                              style={{ position:'absolute', top:-34, [msg.mine?'right':'left']:0, display:'flex', alignItems:'center', gap:2, background:'rgba(15,15,17,.96)', border:'1px solid rgba(255,255,255,.1)', borderRadius:10, padding:'4px 5px', boxShadow:'0 4px 16px rgba(0,0,0,.5)', zIndex:10, whiteSpace:'nowrap' }}>
                              {EMOJI_REACTIONS.slice(0,3).map(em => (
                                <button key={em} onClick={e => { e.stopPropagation(); handleReact(msg.id, em); }}
                                  style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}
                                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{em}</button>
                              ))}
                              <button onClick={e => { e.stopPropagation(); setEmojiPickerMsg(p => p===msg.id?null:msg.id); setMenuMsg(null); }}
                                style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'rgba(255,255,255,.5)' }}
                                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>＋</button>
                              <div style={{ width:1, height:16, background:'rgba(255,255,255,.08)', margin:'0 2px' }}/>
                              <button onClick={e => { e.stopPropagation(); setReplyTo({id:msg.id,text:msg.text||'',mine:msg.mine}); inputRef.current?.focus(); }}
                                style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.45)' }}
                                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{Icon.reply}</button>
                              <button onClick={e => { e.stopPropagation(); setMenuMsg(p => p===msg.id?null:msg.id); setEmojiPickerMsg(null); }}
                                style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.45)' }}
                                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{Icon.dots}</button>
                            </div>

                            {/* Emoji picker */}
                            {emojiPickerMsg===msg.id && (
                              <div className="emoji-pop" onClick={e=>e.stopPropagation()}
                                style={{ position:'absolute', top:-80, [msg.mine?'right':'left']:0, display:'flex', gap:4, background:'rgba(15,15,17,.96)', border:'1px solid rgba(255,255,255,.1)', borderRadius:12, padding:'8px 10px', boxShadow:'0 8px 24px rgba(0,0,0,.5)', zIndex:20 }}>
                                {EMOJI_REACTIONS.map(em => (
                                  <button key={em} onClick={() => handleReact(msg.id,em)}
                                    style={{ width:32, height:32, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}
                                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.1)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{em}</button>
                                ))}
                              </div>
                            )}

                            {/* 3-dot context menu */}
                            {menuMsg===msg.id && (
                              <div className="menu-slide" onClick={e=>e.stopPropagation()}
                                style={{ position:'absolute', top:-120, [msg.mine?'right':'left']:0, background:'rgba(15,15,17,.97)', border:'1px solid rgba(255,255,255,.1)', borderRadius:11, overflow:'hidden', boxShadow:'0 8px 28px rgba(0,0,0,.6)', zIndex:20, minWidth:140 }}>
                                {msg.mine && msg.msgType==='text' && !msg.deleted && (
                                  <button onClick={() => { setEditingMsg({id:msg.id,text:msg.text||''}); setInput(msg.text||''); setMenuMsg(null); inputRef.current?.focus(); }}
                                    style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'10px 14px', color:'rgba(255,255,255,.65)', fontSize:12.5, textAlign:'left' }}
                                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.06)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{Icon.edit}<span>Edit</span></button>
                                )}
                                <button onClick={() => { setReplyTo({id:msg.id,text:msg.text||'',mine:msg.mine}); setMenuMsg(null); inputRef.current?.focus(); }}
                                  style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'10px 14px', color:'rgba(255,255,255,.65)', fontSize:12.5, textAlign:'left' }}
                                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.06)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{Icon.reply}<span>Reply</span></button>
                                {msg.mine && !msg.deleted && <>
                                  <div style={{ height:1, background:'rgba(255,255,255,.06)', margin:'2px 0' }}/>
                                  <button onClick={() => handleDelete(msg)}
                                    style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'10px 14px', color:'rgba(248,113,113,.7)', fontSize:12.5, textAlign:'left' }}
                                    onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{Icon.trash}<span>Delete</span></button>
                                </>}
                              </div>
                            )}

                            {/* Reply preview */}
                            {msg.msgType==='reply' && msg.replyToText && (
                              <div style={{ marginBottom:4, padding:'6px 10px', background:'rgba(99,102,241,.08)', border:'1px solid rgba(99,102,241,.15)', borderLeft:'3px solid rgba(99,102,241,.6)', borderRadius:8 }}>
                                <p style={{ color:'rgba(139,92,246,.8)', fontSize:10.5, fontWeight:600, marginBottom:2 }}>{msg.mine?'You':'them'} replied</p>
                                <p style={{ color:'rgba(255,255,255,.4)', fontSize:11.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{msg.replyToText}</p>
                              </div>
                            )}

                            {/* Message bubble */}
                            <div className={msg.mine?'msg-r':'msg-l'} style={{
                              padding: audioSrc ? 0 : (msg.msgType==='media'&&msg.mediaType==='image') ? '4px' : '10px 14px',
                              borderRadius: 16,
                              borderBottomRightRadius: msg.mine  ? (isLast?5:16) : 16,
                              borderBottomLeftRadius:  !msg.mine ? (isLast?5:16) : 16,
                              background: msg.deleted
                                ? 'rgba(255,255,255,.04)'
                                : msg.text===null
                                  ? 'rgba(245,158,11,.06)'
                                  : msg.mine
                                    ? 'linear-gradient(135deg,#6366f1,#7c3aed)'
                                    : 'rgba(255,255,255,.07)',
                              border: msg.deleted
                                ? '1px solid rgba(255,255,255,.06)'
                                : msg.text===null
                                  ? '1px solid rgba(245,158,11,.15)'
                                  : msg.mine ? 'none' : '1px solid rgba(255,255,255,.08)',
                              boxShadow: msg.mine&&!msg.deleted ? '0 4px 16px rgba(99,102,241,.25)' : 'none',
                              opacity: msg.deleted ? .5 : 1,
                              overflow: 'hidden',
                            }}>
                              {msg.deleted ? (
                                <p style={{ fontSize:12, color:'rgba(255,255,255,.3)', fontStyle:'italic', padding:'10px 14px' }}>Message deleted</p>
                              ) : msg.text===null ? (
                                <span style={{ fontSize:12, color:'rgba(245,158,11,.55)', display:'flex', alignItems:'center', gap:5 }}>{Icon.lock} encrypted</span>
                              ) : audioSrc ? (
                                <AudioPlayer src={audioSrc} isMine={msg.mine} />
                              ) : msg.msgType==='media' && msg.mediaType==='image' ? (
                                <div>
                                  <img src={`data:${msg.mimeType||'image/jpeg'};base64,${msg.data}`} alt=""
                                    style={{ maxWidth:'100%', width:'100%', maxHeight:220, borderRadius:13, display:'block', cursor:'pointer', objectFit:'cover' }}
                                    onClick={() => setLightboxSrc(`data:${msg.mimeType||'image/jpeg'};base64,${msg.data}`)}/>
                                </div>
                              ) : (
                                <p style={{ fontSize:13.5, lineHeight:1.55, color:msg.mine?'rgba(255,255,255,.92)':'rgba(255,255,255,.82)', wordBreak:'break-word', whiteSpace:'pre-wrap' }}>
                                  {msg.text}
                                  {msg.edited && <span style={{ color:msg.mine?'rgba(255,255,255,.4)':'rgba(255,255,255,.3)', fontSize:10.5, marginLeft:5, fontStyle:'italic' }}>edited</span>}
                                </p>
                              )}
                            </div>

                            {/* Timestamp */}
                            {isLast && (
                              <p style={{ fontSize:10, color:'rgba(255,255,255,.18)', marginTop:4, textAlign:msg.mine?'right':'left' }}>
                                {fmtTime(msg.ts)}{msg.mine&&<span style={{ marginLeft:4, color:'rgba(99,102,241,.5)' }}>✓</span>}
                              </p>
                            )}

                            {/* Reaction pills */}
                            {rxEntries.length > 0 && (
                              <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:5, justifyContent:msg.mine?'flex-end':'flex-start' }}>
                                {rxEntries.map(([em, users]) => (
                                  <button key={em} className="react-pill" onClick={() => handleReact(msg.id,em)}
                                    style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:99, background:users.includes(identity.pubkeyHex)?'rgba(99,102,241,.18)':'rgba(255,255,255,.07)', border:`1px solid ${users.includes(identity.pubkeyHex)?'rgba(99,102,241,.3)':'rgba(255,255,255,.1)'}`, fontSize:13, color:users.includes(identity.pubkeyHex)?'rgba(139,92,246,.9)':'rgba(255,255,255,.6)', transition:'all .15s' }}>
                                    <span>{em}</span><span style={{ fontSize:10.5, fontWeight:600 }}>{users.length}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef}/>
                </div>
              )}
            </div>

            {/* Relay warning */}
            {relayStatus !== 'connected' && (
              <div style={{ margin:'0 20px 6px', display:'flex', alignItems:'center', gap:8, padding:'7px 13px', background:'rgba(245,158,11,.04)', border:'1px solid rgba(245,158,11,.1)', borderRadius:9 }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:relayColor, flexShrink:0 }}/>
                <p style={{ color:'rgba(245,158,11,.55)', fontSize:11.5, flex:1 }}>{relayStatus==='connecting'?'Connecting to relays…':'Relay disconnected'}</p>
                {relayStatus==='disconnected' && <button onClick={() => connectRelays(getRelays())} style={{ padding:'3px 9px', borderRadius:6, background:'rgba(245,158,11,.08)', color:'rgba(245,158,11,.7)', fontSize:10.5, border:'1px solid rgba(245,158,11,.14)', fontWeight:500 }}>Retry</button>}
              </div>
            )}

            {/* Media sending indicator */}
            {mediaSending && (
              <div style={{ margin:'0 20px 6px', display:'flex', alignItems:'center', gap:8, padding:'7px 13px', background:'rgba(99,102,241,.04)', border:'1px solid rgba(99,102,241,.12)', borderRadius:9 }}>
                <div style={{ width:10, height:10, border:'1.5px solid rgba(255,255,255,.1)', borderTop:'1.5px solid #6366f1', borderRadius:'50%', animation:'spin .8s linear infinite', flexShrink:0 }}/>
                <p style={{ color:'rgba(139,92,246,.7)', fontSize:11.5 }}>Encrypting &amp; sending media…</p>
              </div>
            )}

            {/* ── Input ── */}
            <div className="input-area" style={{ padding:'8px 20px 16px', flexShrink:0 }}>

              {/* Reply / Edit bar */}
              {(replyTo || editingMsg) && (
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'rgba(99,102,241,.07)', border:'1px solid rgba(99,102,241,.15)', borderRadius:10, marginBottom:8, borderLeft:'3px solid rgba(99,102,241,.6)' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ color:'rgba(99,102,241,.8)', fontSize:10.5, fontWeight:600, marginBottom:2 }}>{editingMsg?'Editing message':'Replying to'}</p>
                    <p style={{ color:'rgba(255,255,255,.4)', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{editingMsg?.text||replyTo?.text||'media'}</p>
                  </div>
                  <button onClick={() => { setReplyTo(null); setEditingMsg(null); setInput(''); }}
                    style={{ color:'rgba(255,255,255,.35)', display:'flex', alignItems:'center', justifyContent:'center', width:22, height:22, borderRadius:6, background:'rgba(255,255,255,.06)' }}
                    onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,.7)'} onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.35)'}>{Icon.close}</button>
                </div>
              )}

              {canChat ? (
                <div className="input-box" style={{ display:'flex', alignItems:'flex-end', gap:8, background:'rgba(255,255,255,.04)', border:'1.5px solid rgba(255,255,255,.07)', borderRadius:16, padding:'8px 8px 8px 14px', transition:'border-color .2s,box-shadow .2s' }}>

                  {/* Media buttons */}
                  <div style={{ display:'flex', gap:2, alignSelf:'flex-end', marginBottom:1 }}>
                    {/* Image */}
                    <button onClick={() => fileImgRef.current?.click()} className="med-btn" title="Send image (auto-compressed)"
                      style={{ width:30, height:30, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.35)', background:'transparent' }} disabled={mediaSending}>
                      {Icon.image}
                    </button>
                    {/* Voice — hold to record */}
                    <button
                      onMouseDown={startRecording} onMouseUp={stopRecording}
                      onTouchStart={startRecording} onTouchEnd={stopRecording}
                      className="med-btn" title="Hold to record voice (max ~20s)"
                      disabled={mediaSending}
                      style={{ width:30, height:30, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', color:recording?'#ef4444':'rgba(255,255,255,.35)', background:recording?'rgba(239,68,68,.12)':'transparent', position:'relative' }}>
                      {Icon.mic}
                      {recording && (
                        <span style={{ position:'absolute', top:-20, left:'50%', transform:'translateX(-50%)', fontSize:9, color:'#ef4444', fontWeight:700, whiteSpace:'nowrap', animation:'recPulse 1s ease infinite', background:'rgba(15,15,17,.9)', padding:'2px 6px', borderRadius:6, border:'1px solid rgba(239,68,68,.2)' }}>
                          ● {recordSeconds}s
                        </span>
                      )}
                    </button>
                  </div>

                  <div style={{ width:1, height:20, background:'rgba(255,255,255,.07)', alignSelf:'flex-end', marginBottom:5 }}/>

                  <textarea ref={inputRef} value={input}
                    onChange={e => { setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,130)+'px'; }}
                    onKeyDown={handleKeyDown}
                    placeholder={editingMsg?'Edit message…':replyTo?'Reply…':`Message ${peerName(peerPubkey)}…`}
                    rows={1}
                    style={{ flex:1, background:'transparent', border:'none', color:'rgba(255,255,255,.85)', fontSize:14, lineHeight:1.55, minHeight:26, maxHeight:130, overflowY:'auto' }}/>

                  <button onClick={handleSend} disabled={sending||!input.trim()} className="send-btn"
                    style={{ width:36, height:36, borderRadius:11, background:input.trim()&&!sending?'linear-gradient(135deg,#6366f1,#7c3aed)':'rgba(255,255,255,.05)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:input.trim()&&!sending?'0 4px 14px rgba(99,102,241,.4)':'none', border:'none', color:input.trim()&&!sending?'#fff':'rgba(255,255,255,.2)' }}>
                    {sending ? <div style={{ width:12, height:12, border:'1.5px solid rgba(255,255,255,.2)', borderTop:'1.5px solid #fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/> : Icon.send}
                  </button>
                </div>
              ) : (
                <div style={{ padding:'13px 18px', background:'rgba(255,255,255,.025)', border:'1px solid rgba(255,255,255,.05)', borderRadius:14, textAlign:'center' }}>
                  <p style={{ color:'rgba(255,255,255,.2)', fontSize:12.5 }}>
                    {currentReqState==='pending_sent'    && '⏳ Waiting for them to accept…'}
                    {currentReqState==='pending_incoming'&& 'Accept the request above to start chatting'}
                    {currentReqState==='declined'        && '🚫 This conversation is unavailable'}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* ── Incoming call banner ── */}
        {incomingCall && (
          <IncomingCallBanner
            callerName={contacts[incomingCall.fromPubkey]?.displayName || incomingCall.fromPubkey.slice(0,12)}
            callerPubkey={incomingCall.fromPubkey}
            isVideo={incomingCall.payload.video ?? false}
            onAccept={acceptCall}
            onDecline={declineCall}
          />
        )}

        {/* ── Active call overlay ── */}
        {callState && callState !== null && (
          <CallOverlay
            callSession={callSession}
            callState={callState}
            peerName={peerPubkey ? peerName(peerPubkey) : ''}
            peerPubkey={peerPubkey}
            isVideo={callIsVideo}
            onHangup={hangup}
            localStream={localStream}
            remoteStream={remoteStream}
          />
        )}
      </div>

      <style>{`
        /* ── Responsive sidebar & layout ── */
        .sidebar-panel {
          transition: transform .25s cubic-bezier(.4,0,.2,1);
        }

        /* Tablet+ : sidebar always visible */
        @media (min-width: 640px) {
          .sidebar-panel        { position: relative !important; transform: none !important; }
          .sidebar-close-btn    { display: none !important; }
          .mobile-menu-btn      { display: none !important; }
          .mobile-topbar        { display: none !important; }
          .mobile-overlay       { display: none !important; }
          .msg-bubble-wrap      { max-width: 60% !important; }
        }

        /* Mobile: sidebar is a slide-in drawer */
        @media (max-width: 639px) {
          .sidebar-panel {
            position: fixed !important;
            top: 0; left: 0; bottom: 0;
            width: min(82vw, 300px) !important;
            transform: translateX(-105%);
            z-index: 51 !important;
            box-shadow: 12px 0 48px rgba(0,0,0,.7);
          }
          .sidebar-panel.sidebar-open {
            transform: translateX(0) !important;
            animation: slideInLeft .22s cubic-bezier(.34,1.1,.64,1);
          }
          .sidebar-close-btn    { display: flex !important; }
          .mobile-menu-btn      { display: flex !important; }
          .mobile-topbar        { display: flex !important; }
          .msg-bubble-wrap      { max-width: 85% !important; }
          .messages-area        { padding: 12px 12px 6px !important; }
          .input-area           { padding: 6px 10px 14px !important; }
          .enc-badge span:last-child { display: none; }
          .enc-badge            { padding: 5px 8px !important; }
          .npub-sub             { display: none !important; }
        }

        /* Very small phones */
        @media (max-width: 380px) {
          .sidebar-panel        { width: 90vw !important; }
          .msg-bubble-wrap      { max-width: 90% !important; }
        }
      `}</style>
    </>
  );
}
