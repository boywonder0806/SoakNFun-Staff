/**
 * Public shared-report links — no staff login. The token in the URL is the
 * credential; this router must be mounted ahead of the static/SPA catch-all
 * and must never echo anything but the stored HTML (or the PIN screen).
 *
 * A report can additionally carry a PIN. The gate lives here, server-side: an
 * unlocked viewer holds an HttpOnly cookie signed with the server secret and
 * bound to the current pin_hash, so changing the PIN logs everyone out. Wrong
 * guesses are throttled per client IP because a short PIN is cheap to enumerate.
 */
import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSharedReport, recordView, verifyPin } from '../services/sharedReports.js';

const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_MAX_FAILS = 5, PIN_WINDOW_MS = 15 * 60 * 1000;
const pinAttempts = new Map(); // `${ip}|${token}` -> { fails, windowStart, lockedUntil }

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
const unlockSig = (token, pinHash, exp) => createHmac('sha256', process.env.JWT_SECRET).update(`${token}|${pinHash}|${exp}`).digest('base64url');
const cookieName = (token) => `sr_unlock_${token}`;

function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function hasValidUnlock(req, report) {
  const raw = readCookie(req, cookieName(report.token));
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = unlockSig(report.token, report.pin_hash, exp);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function pinThrottle(req, token) {
  const key = `${clientIp(req)}|${token}`;
  const now = Date.now();
  const e = pinAttempts.get(key) || { fails: 0, windowStart: now, lockedUntil: 0 };
  if (e.lockedUntil > now) return { locked: true, retryMin: Math.ceil((e.lockedUntil - now) / 60000) };
  if (now - e.windowStart > PIN_WINDOW_MS) { e.fails = 0; e.windowStart = now; }
  return {
    locked: false,
    fail() { e.fails++; if (e.fails >= PIN_MAX_FAILS) { e.lockedUntil = now + PIN_WINDOW_MS; e.fails = 0; e.windowStart = now; } pinAttempts.set(key, e); },
    clear() { pinAttempts.delete(key); },
  };
}
setInterval(() => { const now = Date.now(); for (const [k, e] of pinAttempts) if (e.lockedUntil < now && now - e.windowStart > PIN_WINDOW_MS) pinAttempts.delete(k); }, 10 * 60 * 1000).unref();

const lockedMsg = (t) => `Too many incorrect attempts. Try again in ${t.retryMin} minute${t.retryMin === 1 ? '' : 's'}.`;

function pinPage(res, report, { error = '', status = 200 } = {}) {
  const disabled = status === 429 ? 'disabled' : '';
  res.status(status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>
  :root{color-scheme:light dark;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--border:rgba(11,11,11,.12);--accent:#0b0b0b;--err:#c8463c}
  @media (prefers-color-scheme:dark){:root{--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink-2:#c3c2b7;--muted:#898781;--border:rgba(255,255,255,.12);--accent:#fff}}
  body{margin:0;background:var(--page);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:32px 28px;max-width:380px;width:100%;text-align:center}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
  h1{font-size:20px;font-weight:800;margin:0 0 6px;letter-spacing:-.01em}
  p{font-size:13.5px;color:var(--ink-2);line-height:1.5;margin:0 0 20px}
  input{font:inherit;font-size:26px;font-weight:700;letter-spacing:.35em;text-align:center;width:100%;padding:12px 10px;border:1px solid var(--border);border-radius:12px;background:var(--page);color:var(--ink);box-sizing:border-box;font-variant-numeric:tabular-nums}
  input:focus{outline:2px solid var(--accent);outline-offset:1px}
  button{margin-top:12px;font:inherit;font-size:14px;font-weight:700;width:100%;padding:12px;border:0;border-radius:12px;background:var(--accent);color:var(--page);cursor:pointer}
  button:disabled,input:disabled{opacity:.5;cursor:default}
  .err{color:var(--err);font-size:13px;font-weight:600;margin:12px 0 0}
</style></head>
<body><form class="card" method="post" action="/shared/${escapeHtml(report.token)}/unlock" autocomplete="off">
  <p class="eyebrow">Protected report</p>
  <h1>${escapeHtml(report.title)}</h1>
  <p>Enter the PIN you were given to open this report.</p>
  <input type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" autofocus autocomplete="one-time-code" aria-label="PIN" ${disabled}>
  <button type="submit" ${disabled}>Open report</button>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
</form></body></html>`);
}

async function loadShared(req, res) {
  const report = await getSharedReport(req.params.token);
  const unavailable = (msg) => res.status(404).send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
     <title>Report unavailable</title>
     <body style="font:15px system-ui,sans-serif;color:#333;max-width:32rem;margin:15vh auto;padding:0 20px;text-align:center">
       <p style="font-size:15px">${msg}</p>
     </body>`
  );
  if (!report) { unavailable('This report link doesn’t exist.'); return null; }
  if (report.revoked) { unavailable('This report link has been revoked.'); return null; }
  if (report.expires_at && new Date(report.expires_at) < new Date()) { unavailable('This report link has expired.'); return null; }
  return report;
}

const router = Router();

router.get('/shared/:token', async (req, res) => {
  try {
    const report = await loadShared(req, res);
    if (!report) return;
    if (report.pin_hash && !hasValidUnlock(req, report)) {
      const t = pinThrottle(req, report.token);
      return pinPage(res, report, t.locked ? { error: lockedMsg(t), status: 429 } : {});
    }
    recordView(req.params.token).catch(() => {});
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', report.pin_hash ? 'private, no-store' : 'no-cache');
    res.send(report.html);
  } catch (err) {
    console.error('shared report view error:', err.message);
    res.status(500).send('Something went wrong loading this report.');
  }
});

router.post('/shared/:token/unlock', async (req, res) => {
  try {
    const report = await loadShared(req, res);
    if (!report) return;
    if (!report.pin_hash) return res.redirect(303, `/shared/${report.token}`);
    const t = pinThrottle(req, report.token);
    if (t.locked) return pinPage(res, report, { error: lockedMsg(t), status: 429 });
    const pin = String(req.body?.pin || '').trim();
    if (!verifyPin(pin, report.pin_hash)) {
      t.fail();
      return pinPage(res, report, { error: 'That PIN isn’t right.', status: 401 });
    }
    t.clear();
    const exp = String(Date.now() + UNLOCK_TTL_MS);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `${cookieName(report.token)}=${exp}.${unlockSig(report.token, report.pin_hash, exp)}; Path=/shared/${report.token}; Max-Age=${UNLOCK_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`);
    res.redirect(303, `/shared/${report.token}`);
  } catch (err) {
    console.error('shared report unlock error:', err.message);
    res.status(500).send('Something went wrong.');
  }
});

export default router;
