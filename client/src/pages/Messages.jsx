import { useState, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const TERMS_KEY = 'bb_msg_terms_v1';

export default function Messages() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId]           = useState(null);
  const [messages, setMessages]           = useState([]);
  const [text, setText]                   = useState('');
  const [sending, setSending]             = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(() => !!localStorage.getItem(TERMS_KEY));
  const [showTerms, setShowTerms]         = useState(false);
  const [pendingConvoId, setPendingConvoId] = useState(null);
  const [showSearch, setShowSearch]       = useState(false);
  const [searchQ, setSearchQ]             = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]         = useState(false);
  const endRef   = useRef(null);
  const searchRef = useRef(null);
  const { user } = useAuth();

  useEffect(() => {
    api.get('/messages/conversations')
      .then(r => setConversations(r.data.conversations ?? []))
      .catch(() => {});
    const poll = setInterval(() => {
      api.get('/messages/conversations')
        .then(r => setConversations(r.data.conversations ?? []))
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    api.get(`/messages/conversations/${activeId}`).then(r => setMessages(r.data.messages));
    const poll = setInterval(() => {
      api.get(`/messages/conversations/${activeId}`)
        .then(r => setMessages(r.data.messages))
        .catch(() => {});
    }, 5_000);
    return () => clearInterval(poll);
  }, [activeId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Employee search
  useEffect(() => {
    if (!showSearch) { setSearchResults([]); setSearchQ(''); return; }
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 50);
  }, [showSearch]);

  useEffect(() => {
    if (!showSearch) return;
    const timer = setTimeout(() => {
      setSearching(true);
      api.get('/messages/employees', { params: { q: searchQ } })
        .then(r => setSearchResults(r.data.employees))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQ, showSearch]);

  function openConversation(id) {
    if (!termsAccepted) {
      setPendingConvoId(id);
      setShowTerms(true);
    } else {
      setActiveId(id);
      setShowSearch(false);
    }
  }

  function acceptTerms() {
    localStorage.setItem(TERMS_KEY, '1');
    setTermsAccepted(true);
    setShowTerms(false);
    if (pendingConvoId) {
      setActiveId(pendingConvoId);
      setPendingConvoId(null);
      setShowSearch(false);
    }
  }

  async function startDirect(emp) {
    try {
      const { data } = await api.post('/messages/direct', { targetId: emp.id });
      // Add to conversations list if not already there
      setConversations(prev => {
        if (prev.find(c => c.id === data.conversationId)) return prev;
        return [{
          id: data.conversationId,
          type: 'direct',
          name: null,
          lastMessage: '',
          memberDetails: [{ id: user.id, name: user.name, avatar: user.avatar }, { id: emp.id, name: emp.name, avatar: emp.avatar }],
        }, ...prev];
      });
      openConversation(data.conversationId);
    } catch (err) {
      console.error(err);
    }
  }

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/messages/conversations/${activeId}`, { text });
      setMessages(p => [...p, data.message]);
      setText('');
      setConversations(p => p.map(c =>
        c.id === activeId ? { ...c, lastMessage: text.trim(), lastMessageTime: new Date().toISOString() } : c
      ));
    } finally { setSending(false); }
  }

  const active = conversations.find(c => c.id === activeId);

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 3rem)' }}>

      {/* Terms modal */}
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-deep border border-rim/60 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-rim/40 bg-shell/40 flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center shrink-0">
                <ShieldIcon className="w-4 h-4 text-gold" />
              </span>
              <div>
                <h2 className="font-heading font-black text-ink text-base leading-tight">Business Messaging Platform</h2>
                <p className="text-10 text-fog tracking-wide mt-0.5">Please read before continuing</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-fog-hi leading-relaxed">
                This messaging system is provided for <span className="text-ink font-semibold">work-related communication only</span>.
                By continuing, you acknowledge and agree to the following:
              </p>
              <ul className="space-y-3">
                {[
                  'You will remain respectful and professional in all communications.',
                  'You will use this platform for business purposes only.',
                  'All messages are subject to review and monitoring by your employer.',
                  'Any misuse may result in disciplinary action.',
                ].map((term, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-cyan/10 border border-cyan/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-10 font-bold text-cyan">{i + 1}</span>
                    </span>
                    <span className="text-sm text-fog-hi leading-snug">{term}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowTerms(false); setPendingConvoId(null); }}
                  className="btn-ghost border border-rim/60 rounded-md flex-1 py-2.5"
                >
                  Cancel
                </button>
                <button
                  onClick={acceptTerms}
                  className="btn-primary flex-1 py-2.5"
                >
                  I Agree — Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="w-64 panel flex flex-col shrink-0 overflow-hidden">

        {/* Sidebar header */}
        <div className="px-4 py-3.5 border-b border-rim/40 shrink-0 flex items-center justify-between gap-2">
          <p className="label-xs">Messages</p>
          <button
            onClick={() => setShowSearch(s => !s)}
            title="New message"
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors
              ${showSearch ? 'bg-cyan text-void' : 'bg-shell text-fog hover:text-fog-hi hover:bg-rim/40'}`}
          >
            <ComposeIcon />
          </button>
        </div>

        {/* Employee search */}
        {showSearch && (
          <div className="border-b border-rim/40 shrink-0">
            <div className="px-3 py-2">
              <input
                ref={searchRef}
                className="field w-full py-1.5 text-xs"
                placeholder="Search employees…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
              />
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-rim/20">
              {searching ? (
                <p className="px-4 py-3 text-10 text-fog">Searching…</p>
              ) : searchResults.length === 0 ? (
                <p className="px-4 py-3 text-10 text-fog">{searchQ ? 'No results' : 'Type to search'}</p>
              ) : (
                searchResults.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => startDirect(emp)}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-shell/60 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-shell border border-rim flex items-center justify-center shrink-0 text-10 font-heading font-bold text-fog-hi">
                      {emp.avatar}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{emp.name}</p>
                      <p className="text-10 text-fog truncate">{emp.position || emp.department}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-4 py-6 text-10 text-fog text-center">No conversations yet.<br />Use the compose button to start one.</p>
          ) : (
            conversations.map(c => {
              const isActive = c.id === activeId;
              const name = convoName(c, user);
              const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={`w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors border-l-2
                    ${isActive ? 'bg-shell border-l-cyan' : 'border-l-transparent hover:bg-shell/50'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-heading font-bold
                    ${isActive ? 'bg-cyan text-void' : 'bg-shell text-fog-hi'}`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate leading-tight ${isActive ? 'text-ink' : 'text-fog-hi'}`}>
                      {name}
                    </p>
                    <p className="text-10 text-fog truncate mt-0.5">{c.lastMessage}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 panel flex flex-col overflow-hidden">
        {active ? (
          <>
            <div className="px-5 py-3.5 border-b border-rim/40 shrink-0 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-cyan/20 border border-cyan/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-heading font-bold text-cyan">
                  {convoName(active, user).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-heading font-bold text-ink text-sm leading-tight">{convoName(active, user)}</p>
                <p className="text-10 text-fog tracking-wide">
                  {active.type === 'group' ? `${active.memberDetails?.length ?? 0} members` : 'Direct message'}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {messages.map(m => {
                const isMe = m.senderId === user.id;
                return (
                  <div key={m.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                    {!isMe && (
                      <div className="w-7 h-7 rounded-full bg-shell border border-rim flex items-center justify-center shrink-0 text-10 font-bold text-fog-hi">
                        {m.senderAvatar}
                      </div>
                    )}
                    <div className={`flex flex-col gap-1 max-w-sm ${isMe ? 'items-end' : 'items-start'}`}>
                      {!isMe && (
                        <p className="text-10 text-fog font-bold tracking-wide">{m.senderName}</p>
                      )}
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                        ${isMe
                          ? 'bg-cyan text-void rounded-tr-sm font-medium'
                          : 'bg-shell text-ink border border-rim/60 rounded-tl-sm'
                        }`}>
                        {m.text}
                      </div>
                      <p className="text-10 text-fog">{format(parseISO(m.time), 'h:mm a')}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <form onSubmit={send} className="px-4 py-3 border-t border-rim/40 flex gap-3 items-center shrink-0">
              <input
                className="field flex-1 py-2"
                placeholder="Message…"
                value={text}
                onChange={e => setText(e.target.value)}
                autoComplete="off"
              />
              <button type="submit" disabled={sending || !text.trim()} className="btn-primary px-5 py-2">
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-fog">
            <ComposeIcon className="w-8 h-8 opacity-30" />
            <p className="text-sm">Select a conversation or start a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}

function convoName(c, user) {
  if (c.type === 'group') return c.name ?? 'Group';
  const other = c.memberDetails?.find(m => m.id !== user.id);
  return other?.name ?? 'Direct Message';
}

function ComposeIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function ShieldIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
