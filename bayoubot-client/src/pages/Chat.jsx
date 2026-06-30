import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../lib/api.js';

const QUICK_QUESTIONS = [
  'How much did all crew spend on payroll deductions today?',
  'Give me a full employee breakdown for today',
  'Which BB employees spent the most this week?',
  'Compare BB vs GI payroll totals for today',
  'What were the most ordered items yesterday?',
  'Show me GI employees with cash/card payments today',
];

const GREETING = {
  role: 'assistant',
  content: `Hi, I'm **BayouBot** — your AI assistant for RocketRez order data.\n\nI can answer questions like:\n- *"How much did BB employees spend on payroll deductions today?"*\n- *"Give me a breakdown of crew meals this week"*\n- *"Which GI employees ordered the most yesterday?"*\n\nWhat would you like to know?`,
};

export default function Chat() {
  const { user, logout } = useAuth();
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text) => {
    const userMsg = text.trim();
    if (!userMsg || loading) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Build API history from conversation so far (skip the static greeting)
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
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    setInput(e.target.value);
  }

  function handleNewChat() {
    setMessages([GREETING]);
    setInput('');
    inputRef.current?.focus();
  }

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 bg-bot-bg flex flex-col text-white">

        {/* Brand */}
        <div className="px-5 pt-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-bot/30 border border-bot/50 flex items-center justify-center shrink-0">
              <BotIcon className="w-5 h-5 text-bot-light" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">BayouBot</h1>
              <p className="text-xs text-indigo-400">Order Intelligence</p>
            </div>
          </div>
          <button
            onClick={handleNewChat}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-white/20 text-xs font-semibold text-indigo-200 hover:bg-white/10 transition-colors"
          >
            <PlusIcon />
            New Chat
          </button>
        </div>

        {/* Quick questions */}
        <div className="flex-1 px-4 py-4 overflow-y-auto">
          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-3">Quick Questions</p>
          <div className="space-y-1">
            {QUICK_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                disabled={loading}
                className="w-full text-left text-xs text-indigo-200 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-colors leading-snug"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-bot/30 border border-bot/50 flex items-center justify-center text-xs font-bold text-bot-light shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-indigo-400 truncate">{user?.position || user?.role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-indigo-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <LogoutIcon />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Chat area ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 bg-white border-t border-gray-200 px-6 py-4">
          <form onSubmit={handleSubmit} className="flex gap-3 items-end">
            <textarea
              ref={el => { inputRef.current = el; textareaRef.current = el; }}
              value={input}
              onInput={handleTextareaInput}
              onChange={() => {}}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
              placeholder="Ask BayouBot about your order data…"
              className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bot/40 focus:border-bot/50 transition-colors disabled:opacity-50 leading-relaxed"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-4 py-3 bg-bot text-white rounded-xl hover:bg-bot-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <SendIcon />
            </button>
          </form>
          <p className="text-center text-xs text-gray-400 mt-2">
            BayouBot can make mistakes — verify important figures in RocketRez.
          </p>
        </div>
      </main>
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl bg-bot text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 max-w-3xl">
      <div className="w-8 h-8 rounded-full bg-bot-bg border border-bot/40 flex items-center justify-center shrink-0 mt-0.5">
        <BotIcon className="w-4 h-4 text-bot-light" />
      </div>
      <div className={`flex-1 bg-white rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed shadow-sm border ${
        message.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-100'
      }`}>
        <div className="bot-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-bot-bg border border-bot/40 flex items-center justify-center shrink-0">
        <BotIcon className="w-4 h-4 text-bot-light" />
      </div>
      <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100">
        <div className="flex gap-1.5 items-center h-5">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────
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

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
