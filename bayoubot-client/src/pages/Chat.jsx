import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../lib/api.js';

function buildGreeting(user) {
  const hour      = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = user?.name?.split(' ')[0] || 'there';
  return `Good ${timeOfDay}, **${firstName}!** I'm **BayouBot** — your AI assistant for all RocketRez order data.\n\nI have real-time access to everything: ticket sales, food & beverage, online orders, crew meals, and more. Ask me things like:\n- *"Give me a full revenue summary for today"*\n- *"Compare ticket sales vs food revenue this week"*\n- *"What were our busiest hours yesterday?"*\n- *"Which crew employees had the most payroll deductions today?"*\n- *"Look up order #12345"*\n\nWhat would you like to know?`;
}

const QUICK_QUESTIONS = [
  'Give me a full revenue summary for today',
  'How much did we make in ticket sales today?',
  'What were the most popular items sold today?',
  'Compare food & beverage vs ticket revenue today',
  'What were our busiest hours today?',
  'How much crew payroll deduction happened today?',
  'Break down revenue by sales office for today',
  'How does today compare to yesterday in total revenue?',
];

export default function Chat() {
  const { user, logout } = useAuth();
  const [messages, setMessages]     = useState(() => [{ role: 'assistant', content: buildGreeting(user) }]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef   = useRef(null);
  const inputRef    = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text) => {
    const userMsg = text.trim();
    if (!userMsg || loading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const apiHistory = messages.slice(1).map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const { data } = await api.post('/bayoubot/chat', {
        messages: apiHistory,
        message:  userMsg,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Something went wrong. Please try again.';
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg, error: true }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [messages, loading]);

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleTextareaInput(e) {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
    setInput(e.target.value);
  }

  function handleNewChat() {
    setMessages([{ role: 'assistant', content: buildGreeting(user) }]);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div className="flex h-screen bg-[#030712] overflow-hidden text-white">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside
        className="shrink-0 flex flex-col transition-all duration-300 border-r border-white/5"
        style={{
          width: sidebarOpen ? '260px' : '0',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #08091a 0%, #050816 100%)',
        }}
      >
        <div className="flex flex-col h-full w-[260px]">

          {/* Brand */}
          <div className="px-5 pt-6 pb-5 border-b border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
                <div className="absolute inset-0 rounded-xl bg-indigo-500/20 animate-pulse" style={{ animationDuration: '2s' }} />
                <div className="relative w-8 h-8 rounded-xl bg-[#0d1117] border border-indigo-500/40 flex items-center justify-center">
                  <BotIcon className="w-4 h-4 text-indigo-400" />
                </div>
              </div>
              <div>
                <h1 className="text-sm font-bold text-white leading-tight gradient-text">BayouBot</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-emerald-400/80 font-medium">Online · RocketRez live</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 text-xs font-semibold text-slate-300 hover:bg-white/5 hover:border-indigo-500/30 transition-all"
            >
              <PlusIcon />
              New Conversation
            </button>
          </div>

          {/* Quick questions */}
          <div className="flex-1 px-3 py-4 overflow-y-auto">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-3">
              Quick Queries
            </p>
            <div className="space-y-0.5">
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="w-full text-left text-xs text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-colors leading-snug"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* User */}
          <div className="px-4 py-4 border-t border-white/5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0 border border-indigo-500/30"
                style={{ background: 'rgba(99,102,241,0.15)' }}>
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
                <p className="text-xs text-slate-500 truncate">{user?.position || user?.role}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <LogoutIcon />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main chat ─────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Header */}
        <div className="relative shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-white/5"
          style={{ background: 'rgba(5,8,22,0.8)', backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(p => !p)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
            >
              <MenuIcon />
            </button>
            <div>
              <p className="text-sm font-bold text-white">BayouBot</p>
              <p className="text-[11px] text-slate-500">Powered by Claude · RocketRez live data</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-emerald-400/70 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </div>
        </div>

        {/* Messages */}
        <div className="relative flex-1 overflow-y-auto px-4 py-6 space-y-6">

          {/* Empty state gradient blobs (show before any real convo) */}
          {messages.length <= 1 && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-indigo-900/20 blur-[80px] animate-blob" />
              <div className="absolute bottom-1/3 right-1/4 w-48 h-48 rounded-full bg-violet-900/15 blur-[60px] animate-blob-2" />
            </div>
          )}

          <div className="max-w-3xl mx-auto w-full space-y-6">
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input area */}
        <div
          className="relative shrink-0 px-4 py-4 border-t border-white/5"
          style={{ background: 'rgba(5,8,22,0.9)', backdropFilter: 'blur(12px)' }}
        >
          <div className="max-w-3xl mx-auto">
            {/* Glowing wrapper */}
            <div className="relative rounded-2xl" style={{ boxShadow: '0 0 0 1px rgba(99,102,241,0.2), 0 0 30px rgba(99,102,241,0.05)' }}>
              <form onSubmit={handleSubmit} className="flex items-end gap-3 bg-[#0d1117] rounded-2xl p-3 border border-white/8">
                <textarea
                  ref={el => { inputRef.current = el; textareaRef.current = el; }}
                  value={input}
                  onInput={handleTextareaInput}
                  onChange={() => {}}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={loading}
                  placeholder="Ask BayouBot anything about your order data…"
                  className="flex-1 resize-none bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none leading-relaxed disabled:opacity-50"
                  style={{ minHeight: '36px', maxHeight: '140px' }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: input.trim() && !loading
                      ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
                      : 'rgba(99,102,241,0.1)',
                    boxShadow: input.trim() && !loading ? '0 0 20px rgba(99,102,241,0.4)' : 'none',
                  }}
                >
                  <SendIcon />
                </button>
              </form>
            </div>
            <p className="text-center text-[11px] text-slate-600 mt-2.5">
              BayouBot can make mistakes — verify critical figures in RocketRez.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Message bubble ─────────────────────────────────────────────────────────── */
function MessageBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-xl rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white leading-relaxed"
          style={{
            background: 'linear-gradient(135deg, #4338ca, #6d28d9)',
            boxShadow: '0 4px 20px rgba(99,102,241,0.25)',
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      {/* Bot avatar */}
      <div className="shrink-0 mt-0.5">
        <div className="w-8 h-8 rounded-xl bg-[#0d1117] border border-indigo-500/30 flex items-center justify-center"
          style={{ boxShadow: '0 0 12px rgba(99,102,241,0.15)' }}>
          <BotIcon className="w-4 h-4 text-indigo-400" />
        </div>
      </div>

      <div
        className={`flex-1 min-w-0 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed ${
          message.error
            ? 'bg-red-950/50 border border-red-500/20 text-red-300'
            : 'bg-[#0d1117]/80 border border-white/6 text-slate-200'
        }`}
        style={!message.error ? { boxShadow: '0 4px 20px rgba(0,0,0,0.3)' } : {}}
      >
        <div className="bot-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

/* ── Typing indicator ───────────────────────────────────────────────────────── */
const THINKING_PHRASES = [
  'Thinking…',
  'Pulling order data…',
  'Crunching the numbers…',
  'Checking RocketRez…',
  'Almost there…',
];

function TypingIndicator() {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIdx(i => (i + 1) % THINKING_PHRASES.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-xl bg-[#0d1117] border border-indigo-500/30 flex items-center justify-center"
        style={{ boxShadow: '0 0 12px rgba(99,102,241,0.15)' }}>
        <BotIcon className="w-4 h-4 text-indigo-400" />
      </div>
      <div className="bg-[#0d1117]/80 border border-white/6 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2.5"
        style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
        <div className="flex gap-1.5 items-center h-5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '160ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '320ms' }} />
        </div>
        <span className="text-xs text-slate-500 transition-opacity duration-300">
          {THINKING_PHRASES[phraseIdx]}
        </span>
      </div>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */
function BotIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="9" width="18" height="12" rx="3" />
      <circle cx="8.5" cy="15" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9 19.5h6" />
      <path d="M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
      <line x1="12" y1="7" x2="12" y2="9" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
