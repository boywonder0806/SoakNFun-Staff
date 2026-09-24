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
import { getSharedReport, recordView, verifyPin, getActiveRecipients, matchRecipientPin, recordViewDetail } from '../services/sharedReports.js';

const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_MAX_FAILS = 5, PIN_WINDOW_MS = 15 * 60 * 1000;
const pinAttempts = new Map(); // `${ip}|${token}` -> { fails, windowStart, lockedUntil }

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// nginx sets X-Real-IP to the connecting address and APPENDS it to any
// X-Forwarded-For the client sent, so trust X-Real-IP first and otherwise the
// last forwarded entry — never the first, which the caller controls.
const clientIp = (req) => {
  const real = (req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const xff = (req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff[xff.length - 1] || req.socket.remoteAddress || 'unknown';
};
// Bound to the unlocking recipient (0 = the report's general PIN) and to that
// recipient's stored PIN, so a regenerated PIN invalidates their old unlock.
const unlockSig = (token, rid, binding, exp) => createHmac('sha256', process.env.JWT_SECRET).update(`${token}|${rid}|${binding}|${exp}`).digest('base64url');
const cookieName = (token) => `sr_unlock_${token}`;

function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

// Returns the unlocking recipient id (0 = general PIN), or null if not unlocked.
function validUnlock(req, report, recipients) {
  const raw = readCookie(req, cookieName(report.token));
  if (!raw) return null;
  const [rid, exp, sig] = raw.split('.');
  if (!rid || !exp || !sig || Number(exp) < Date.now()) return null;
  let binding;
  if (rid === '0') { if (!report.pin_hash) return null; binding = report.pin_hash; }
  else { const r = recipients.find(x => String(x.id) === rid); if (!r) return null; binding = r.pin_enc; }
  const expected = unlockSig(report.token, rid, binding, exp);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? Number(rid) : null;
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

function pinPage(res, report, { error = '', status = 200, agreed = false } = {}) {
  const locked = status === 429;
  const dis = locked ? 'disabled' : '';
  res.status(status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{color-scheme:light dark;--page:#f4f4f1;--surface:#ffffff;--ink:#0b0b0b;--ink-2:#4f4e4a;--muted:#8a8882;--border:rgba(11,11,11,.10);--ring:rgba(42,120,214,.35);--blue:#2a78d6;--blue-2:#1f63b6;--err:#c8463c;--field:#f7f7f4}
  @media (prefers-color-scheme:dark){:root{--page:#0b0b0b;--surface:#161615;--ink:#f5f5f3;--ink-2:#c3c2b7;--muted:#8a8882;--border:rgba(255,255,255,.10);--ring:rgba(57,135,229,.45);--blue:#3987e5;--blue-2:#2f76cc;--err:#e06b62;--field:#0f0f0e}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 20px;background:var(--page);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:400px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:34px 30px 26px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 24px 60px -30px rgba(0,0,0,.45);text-align:center}
  .lock{width:44px;height:44px;border-radius:14px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--blue) 14%,transparent);color:var(--blue)}
  .eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
  h1{font-size:19px;font-weight:800;letter-spacing:-.01em;line-height:1.25;margin:0 0 10px;text-wrap:balance}
  .notice{font-size:13px;line-height:1.55;color:var(--ink-2);margin:0 0 22px}
  .agree{display:flex;gap:11px;align-items:flex-start;text-align:left;font-size:13px;line-height:1.5;color:var(--ink-2);padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--field);margin:0 0 16px;cursor:pointer;transition:border-color .15s}
  .agree:has(input:checked){border-color:var(--blue)}
  .agree input{width:17px;height:17px;margin:1px 0 0;flex:none;accent-color:var(--blue);cursor:pointer}
  .field{display:block;text-align:left;margin:0 0 14px}
  .flabel{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 7px}
  .pin{font:inherit;font-size:26px;font-weight:700;letter-spacing:.45em;text-indent:.45em;text-align:center;width:100%;height:58px;padding:0 12px;border:1px solid var(--border);border-radius:12px;background:var(--field);color:var(--ink);font-variant-numeric:tabular-nums;transition:border-color .15s,box-shadow .15s}
  .pin::placeholder{color:var(--muted);opacity:.45;letter-spacing:.45em}
  .pin:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 4px var(--ring)}
  button{font:inherit;font-size:14.5px;font-weight:700;width:100%;height:50px;border:0;border-radius:12px;background:var(--blue);color:#fff;cursor:pointer;transition:background .15s,transform .05s}
  button:hover:not(:disabled){background:var(--blue-2)} button:active:not(:disabled){transform:translateY(1px)}
  button:disabled{background:color-mix(in srgb,var(--ink) 12%,transparent);color:var(--muted);cursor:not-allowed}
  input:disabled{opacity:.5}
  .err{display:flex;gap:8px;align-items:flex-start;text-align:left;color:var(--err);font-size:13px;font-weight:600;line-height:1.45;margin:14px 0 0}
  .err svg{flex:none;margin-top:1px}
  .fine{font-size:12px;color:var(--muted);margin:18px 0 0}
  .brand{text-align:center;font-size:11.5px;color:var(--muted);margin:18px 0 0;letter-spacing:.02em}
</style></head>
<body><main class="wrap"><form class="card" method="post" action="/shared/${escapeHtml(report.token)}/unlock" autocomplete="off">
  <div class="lock" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg></div>
  <p class="eyebrow">Internal &middot; Confidential</p>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="notice">Access is restricted to authorized Blue Bayou &amp; Gulf Islands staff. Do not share this link or the PIN.</p>
  <label class="agree"><input type="checkbox" name="agree" value="yes" id="agree" ${agreed ? 'checked' : ''} ${dis}><span>I confirm that I am authorized to view this report and will not share or distribute it.</span></label>
  <label class="field"><span class="flabel">PIN</span><input class="pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="&bull;&bull;&bull;&bull;" autofocus autocomplete="one-time-code" aria-label="PIN" ${dis}></label>
  <button type="submit" id="open" disabled>Open report</button>
  ${error ? `<p class="err"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><span>${escapeHtml(error)}</span></p>` : ''}
  <p class="fine">Don't have the PIN? Ask the person who sent you this link.</p>
</form><p class="brand">Blue Bayou &amp; Gulf Islands Waterparks &middot; Analytics</p></main>
<script>(function(){var a=document.getElementById('agree'),b=document.getElementById('open');if(!a||!b)return;function s(){b.disabled=${locked ? 'true' : '!a.checked'};}a.addEventListener('change',s);s();})();</script>
</body></html>`);
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
    const recipients = await getActiveRecipients(report.token);
    let rid = 0;
    if (report.pin_hash || recipients.length) {
      rid = validUnlock(req, report, recipients);
      if (rid === null) {
        const t = pinThrottle(req, report.token);
        return pinPage(res, report, t.locked ? { error: lockedMsg(t), status: 429 } : {});
      }
    }
    recordView(req.params.token).catch(() => {});
    recordViewDetail({ token: report.token, recipientId: rid || null, recipientEmail: rid ? recipients.find(x => x.id === rid)?.email : null, ip: clientIp(req), userAgent: req.headers['user-agent'] }).catch(() => {});
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
    const recipients = await getActiveRecipients(report.token);
    if (!report.pin_hash && !recipients.length) return res.redirect(303, `/shared/${report.token}`);
    const t = pinThrottle(req, report.token);
    if (t.locked) return pinPage(res, report, { error: lockedMsg(t), status: 429 });
    // The acknowledgement is required server-side too; a missing one is not a PIN attempt.
    if (req.body?.agree !== 'yes') return pinPage(res, report, { error: 'Please confirm that you are authorized to view this report.', status: 400 });
    const pin = String(req.body?.pin || '').trim();
    const recipient = matchRecipientPin(recipients, pin);
    const general = !recipient && !!report.pin_hash && verifyPin(pin, report.pin_hash);
    if (!recipient && !general) {
      t.fail();
      return pinPage(res, report, { error: 'That PIN isn’t right.', status: 401, agreed: true });
    }
    t.clear();
    const rid = recipient ? recipient.id : 0;
    const binding = recipient ? recipient.pin_enc : report.pin_hash;
    const exp = String(Date.now() + UNLOCK_TTL_MS);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `${cookieName(report.token)}=${rid}.${exp}.${unlockSig(report.token, rid, binding, exp)}; Path=/shared/${report.token}; Max-Age=${UNLOCK_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`);
    res.redirect(303, `/shared/${report.token}`);
  } catch (err) {
    console.error('shared report unlock error:', err.message);
    res.status(500).send('Something went wrong.');
  }
});

export default router;
