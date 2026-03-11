'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { subscribeToUserChats, getUser, initChat } from '@/lib/db';
import { decryptMessage } from '@/lib/crypto';

export default function ChatSidebar({ activeChatId }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [chats, setChats] = useState([]);
  const [previews, setPreviews] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [newChat, setNewChat] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUserChats(user.username, (updatedChats) => {
      setChats(updatedChats);
      updatedChats.forEach(async (chat) => {
        if (!chat.lastMsg?.body) return;
        try {
          const otherUserData = await getUser(chat.otherUser);
          if (!otherUserData?.publicKey) return;
          const plain = await decryptMessage(chat.lastMsg.body, otherUserData.publicKey);
          setPreviews((prev) => ({ ...prev, [chat.chatId]: plain }));
        } catch { /* ignore */ }
      });
    });
    return unsub;
  }, [user]);

  const startNewChat = async (e) => {
    e.preventDefault();
    setSearchError('');
    const target = newChat.trim().toLowerCase();
    if (target === user.username) { setSearchError("That's you."); return; }
    setSearching(true);
    try {
      const targetUser = await getUser(target);
      if (!targetUser) { setSearchError('User not found.'); return; }
      const chatId = await initChat(user.username, target);
      setNewChat(''); setShowNew(false);
      router.push(`/chat/${chatId}`);
    } catch { setSearchError('Something went wrong.'); }
    finally { setSearching(false); }
  };

  const filteredChats = chats
    .filter(c => c.otherUser?.toLowerCase().includes(searchInput.toLowerCase()))
    .sort((a, b) => (b.lastMsg?.ts || 0) - (a.lastMsg?.ts || 0));

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getPreviewText = (chat) => {
    if (!chat.lastMsg) return 'No messages yet';
    const plain = previews[chat.chatId];
    if (!plain) return 'decrypting…';
    if (plain.startsWith('[')) return '🔒 encrypted';
    const prefix = chat.lastMsg.from === user.username ? 'You: ' : '';
    return prefix + plain;
  };

  if (!user) return null;

  return (
    <div className="w-[300px] xl:w-[340px] flex-shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0a0a0a]">

      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.05]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-white/8 border border-white/10 flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C4.134 1 1 4.134 1 8c0 1.19.308 2.31.848 3.286L1 15l3.786-.821A6.98 6.98 0 008 15c3.866 0 7-3.134 7-7s-3.134-7-7-7z" fill="white" fillOpacity=".3" stroke="white" strokeWidth="1" strokeLinejoin="round"/>
                <circle cx="5.5" cy="8" r=".75" fill="white"/>
                <circle cx="8" cy="8" r=".75" fill="white"/>
                <circle cx="10.5" cy="8" r=".75" fill="white"/>
              </svg>
            </div>
            <span className="text-white/80 font-semibold text-sm tracking-tight">abrigo</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNew(!showNew)} title="New chat"
              className="w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/6 transition-all">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button onClick={logout} title="Sign out"
              className="w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/6 transition-all">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9.5 7H3m3-3L3 7l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 3V2a1 1 0 011-1h4a1 1 0 011 1v10a1 1 0 01-1 1H7a1 1 0 01-1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {showNew && (
          <form onSubmit={startNewChat} className="mb-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 text-xs font-mono">@</span>
                <input autoFocus value={newChat}
                  onChange={(e) => setNewChat(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username"
                  className="w-full bg-white/[0.04] border border-white/[0.09] rounded-md pl-6 pr-3 py-2 text-white placeholder-white/20 text-xs focus:outline-none focus:border-white/25 transition-all"/>
              </div>
              <button type="submit" disabled={searching || !newChat}
                className="px-3 py-2 bg-white/10 hover:bg-white/15 text-white/70 text-xs rounded-md disabled:opacity-30 transition-all">
                {searching ? '…' : 'Go'}
              </button>
            </div>
            {searchError && <p className="text-red-400/70 text-[11px] mt-1.5 px-0.5">{searchError}</p>}
          </form>
        )}

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M8 8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search conversations"
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-md pl-7 pr-3 py-2 text-white placeholder-white/20 text-xs focus:outline-none focus:border-white/20 transition-all"/>
        </div>
      </div>

      {/* User strip */}
      <div className="px-5 py-3 flex items-center gap-3 border-b border-white/[0.04]">
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
          {user.username[0].toUpperCase()}
        </div>
        <p className="text-white/60 text-xs font-medium truncate flex-1">@{user.username}</p>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-white/20 text-[10px]">online</span>
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <div className="w-10 h-10 rounded-xl bg-white/4 border border-white/6 flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2C5.134 2 2 5.134 2 9c0 1.19.308 2.31.848 3.286L2 16l3.786-.821A6.98 6.98 0 009 16c3.866 0 7-3.134 7-7s-3.134-7-7-7z" stroke="white" strokeOpacity=".2" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-white/30 text-xs">{searchInput ? 'No matches' : 'No conversations yet'}</p>
            {!searchInput && <p className="text-white/15 text-[11px] mt-1">Click + to start one</p>}
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isActive = chat.chatId === activeChatId;
            const preview = getPreviewText(chat);
            return (
              <button key={chat.chatId}
                onClick={() => router.push(`/chat/${chat.chatId}`)}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${isActive ? 'bg-white/20' : 'bg-white/8 border border-white/8'}`}>
                  {chat.otherUser?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-white/70'}`}>@{chat.otherUser}</p>
                    <p className="text-white/20 text-[10px] flex-shrink-0 ml-2">{formatTime(chat.lastMsg?.ts)}</p>
                  </div>
                  <p className={`text-xs truncate ${
                    preview === 'No messages yet' ? 'text-white/20 italic' :
                    preview.startsWith('You:') ? 'text-white/30' :
                    isActive ? 'text-white/50' : 'text-white/40'
                  }`}>
                    {preview}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* E2E badge */}
      <div className="px-5 py-3 border-t border-white/[0.04]">
        <div className="flex items-center gap-1.5 text-white/20">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="1.5" y="4" width="7" height="5.5" rx="1" stroke="currentColor" strokeWidth="1"/>
            <path d="M3 4V3a2 2 0 014 0v1" stroke="currentColor" strokeWidth="1"/>
          </svg>
          <span className="text-[10px]">End-to-end encrypted</span>
        </div>
      </div>
    </div>
  );
}
