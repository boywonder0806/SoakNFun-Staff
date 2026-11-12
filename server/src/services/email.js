import { Resend } from 'resend';
import pool from '../db/index.js';

const resend        = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM          = process.env.RESEND_FROM_EMAIL
  ? `BayouNet <${process.env.RESEND_FROM_EMAIL}>`
  : 'BayouNet <system@bluebayoustaff.com>';
const APP_URL       = process.env.CLIENT_URL       || 'http://localhost:5173';
const RECEPTION_URL = process.env.RECEPTION_URL    || 'http://localhost:5174';

async function logEmail({ type, toEmail, toName, subject, htmlBody, triggeredBy }) {
  try {
    await pool.query(
      `INSERT INTO reception_email_log (type, to_email, to_name, subject, html_body, triggered_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [type, toEmail, toName || null, subject, htmlBody || null, triggeredBy || null]
    );
  } catch (e) {
    console.error('Email log insert failed:', e.message);
  }
}

export async function sendCallbackDigestEmail({ toEmail, toName, pendingCount, callbacks, digestUrl, triggeredBy }) {
  if (!resend || !toEmail) return;
  const subject = `You have ${pendingCount} pending callback${pendingCount === 1 ? '' : 's'} — Blue Bayou`;
  const html    = buildCallbackDigestEmail({ toName, pendingCount, callbacks, digestUrl });
  try {
    await resend.emails.send({ from: FROM, to: toEmail, subject, html });
    logEmail({ type: 'callback_digest', toEmail, toName, subject, htmlBody: html, triggeredBy });
  } catch (err) {
    console.error('Callback digest email failed:', err.message);
  }
}

export async function sendCallbackNotification({ toEmail, toName, callerName, callerPhone, reason, notes, loggedBy, triggeredBy }) {
  if (!resend || !toEmail) return;
  const subject = `Callback Request — ${callerName}`;
  const html    = buildCallbackEmail({ toName, callerName, callerPhone, reason, notes, loggedBy });
  try {
    await resend.emails.send({ from: FROM, to: toEmail, subject, html });
    logEmail({ type: 'callback_notification', toEmail, toName, subject, htmlBody: html, triggeredBy });
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }
}

export async function sendAccountSetupEmail({ toEmail, toName, setupToken }) {
  if (!resend || !toEmail) return;
  const setupUrl = `${APP_URL}/reset-password?token=${setupToken}`;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: 'Welcome to the Staff Portal — Set Up Your Account',
      html:    buildAccountSetupEmail({ toName, toEmail, setupUrl }),
    });
  } catch (err) {
    console.error('Account setup email failed:', err.message);
  }
}

export async function sendReceptionWelcomeEmail({ toEmail, toName, triggeredBy }) {
  if (!resend || !toEmail) return;
  const subject = 'You now have access to the Blue Bayou Reception Portal';
  const html    = buildReceptionWelcomeEmail({ toName, loginUrl: `${RECEPTION_URL}/login` });
  try {
    await resend.emails.send({ from: FROM, to: toEmail, subject, html });
    logEmail({ type: 'reception_welcome', toEmail, toName, subject, htmlBody: html, triggeredBy });
  } catch (err) {
    console.error('Reception welcome email failed:', err.message);
  }
}

export async function sendPasswordResetEmail({ toEmail, toName, resetToken, expiresIn = '24 hours' }) {
  if (!resend || !toEmail) return;
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: 'Reset Your Password — Blue Bayou Staff Portal',
      html:    buildPasswordResetEmail({ toName, resetUrl, expiresIn }),
    });
  } catch (err) {
    console.error('Password reset email failed:', err.message);
  }
}
// ─── Shared email layout ────────────────────────────────────────────────────
// Table-based with inline styles so it renders consistently in Outlook, Gmail
// and Apple Mail. Web fonts load where the client allows (Apple Mail, iOS,
// most Android); everything else falls back to the system sans stack.

const FONT_BODY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_HEAD = "'Plus Jakarta Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_MONO = "'JetBrains Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

const C = {
  deep:   '#0a2540',  // header — deep water
  ocean:  '#0077b6',  // primary actions
  lagoon: '#00b4d8',  // accents
  sun:    '#ffb703',  // waterline highlight
  foam:   '#f0f8fb',  // panels
  mist:   '#d6ecf3',  // panel borders
  page:   '#eaf2f6',
  ink:    '#0f172a',
  body:   '#334155',
  muted:  '#64748b',
  faint:  '#94a3b8',
  line:   '#e2e8f0',
};

const DEFAULT_FOOTER = 'Blue Bayou &amp; Gulf Islands Waterparks';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Served from the staff portal's public folder (client/public/images/email).
// Must be absolute, public https URLs — mail clients can't reach anything else.
const ASSET_URL = process.env.EMAIL_ASSET_URL || 'https://bluebayoustaff.com/images/email';
const LOGOS = {
  bb: { src: `${ASSET_URL}/blue-bayou-logo.png`,   width: 80,  height: 76, alt: 'Blue Bayou Waterpark' },
  gi: { src: `${ASSET_URL}/gulf-islands-logo.png`, width: 160, height: 53, alt: 'Gulf Islands Waterpark' },
};

function layout({ preheader, eyebrow, title, body, footer = DEFAULT_FOOTER, brand = 'Staff Portal', parks = ['bb', 'gi'] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@700;800&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  a { color:${C.ocean}; }
  @media (max-width:620px) {
    .bb-wrap { padding:0 !important; }
    .bb-pad  { padding-left:24px !important; padding-right:24px !important; }
    .bb-btn a { display:block !important; text-align:center !important; }
    .bb-label { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
  <tr><td class="bb-wrap" align="center" style="padding:40px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${C.mist}">
      <tr><td class="bb-pad" style="background:#ffffff;padding:22px 40px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle">${parks.map((p, i) => `<img src="${LOGOS[p].src}" width="${LOGOS[p].width}" height="${LOGOS[p].height}" alt="${LOGOS[p].alt}" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none${i ? ';margin-left:20px' : ''}">`).join('')}</td>
          <td class="bb-label" valign="middle" align="right" style="font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:.16em;color:${C.muted};text-transform:uppercase">${esc(brand)}</td>
        </tr></table>
      </td></tr>
      <tr><td style="font-size:0;line-height:0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="62%" height="4" style="background:${C.lagoon};font-size:0;line-height:0">&nbsp;</td>
          <td width="26%" height="4" style="background:${C.ocean};font-size:0;line-height:0">&nbsp;</td>
          <td width="12%" height="4" style="background:${C.sun};font-size:0;line-height:0">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td class="bb-pad" style="padding:40px 40px 8px;font-family:${FONT_BODY}">
        <p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${C.ocean}">${esc(eyebrow)}</p>
        <h1 style="margin:0 0 24px;font-family:${FONT_HEAD};font-size:26px;line-height:1.25;font-weight:800;color:${C.ink};letter-spacing:-.01em">${esc(title)}</h1>
        ${body}
      </td></tr>
      <tr><td class="bb-pad" style="padding:32px 40px 36px;font-family:${FONT_BODY}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-top:1px solid ${C.line};padding-top:20px;font-size:12px;line-height:1.6;color:${C.faint}">
            ${footer}<br>This is an automated message from BayouNet.
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const para = (html, { size = 15, color = C.body, mb = 16 } = {}) =>
  `<p style="margin:0 0 ${mb}px;font-family:${FONT_BODY};font-size:${size}px;line-height:1.65;color:${color}">${html}</p>`;

const greeting = name => para(`Hi ${esc(name || 'there')},`, { mb: 12 });

const fineprint = html => para(html, { size: 13, color: C.muted, mb: 0 });

function button(href, label) {
  return `
    <table role="presentation" class="bb-btn" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px">
      <tr><td style="background:${C.ocean}">
        <a href="${esc(href)}" style="display:inline-block;padding:14px 30px;font-family:${FONT_BODY};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(label)}&nbsp;&rarr;</a>
      </td></tr>
    </table>`;
}

// Label/value rows in a soft "pool" panel. Values are raw HTML — escape before passing.
function details(rows) {
  const body = rows.filter(([, v]) => v).map(([label, value], i) => `
    <tr>
      <td valign="top" style="padding:12px 0;${i ? `border-top:1px solid ${C.mist};` : ''}width:120px;font-family:${FONT_BODY};font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${label}</td>
      <td valign="top" style="padding:12px 0;${i ? `border-top:1px solid ${C.mist};` : ''}font-family:${FONT_BODY};font-size:15px;line-height:1.5;color:${C.ink}">${value}</td>
    </tr>`).join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${C.foam};border:1px solid ${C.mist}">
      <tr><td style="padding:6px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
      </td></tr>
    </table>`;
}

const code = (value, size = 15) =>
  `<span style="font-family:${FONT_MONO};font-size:${size}px;font-weight:600;color:${C.ink};background:#ffffff;border:1px solid ${C.mist};padding:4px 10px;letter-spacing:.04em">${esc(value)}</span>`;

// ─── Templates ──────────────────────────────────────────────────────────────

function buildAccountSetupEmail({ toName, toEmail, setupUrl }) {
  return layout({
    preheader: 'Your Staff Portal account is ready. Set your password to get started — this link expires in 48 hours.',
    eyebrow:   'New Account',
    title:     'Welcome to the team',
    body: `
      ${greeting(toName)}
      ${para('An account has been created for you on the Staff Portal. To get started, set your password using the button below.')}
      ${details([
        ['Sign-in email', esc(toEmail)],
      ])}
      ${button(setupUrl, 'Set your password')}
      ${fineprint('This link expires in <strong>48 hours</strong> and can only be used once. If it expires, ask your manager to resend your welcome email. If you weren&rsquo;t expecting this, you can safely ignore it.')}`,
  });
}

function buildCallbackDigestEmail({ toName, pendingCount, callbacks, digestUrl }) {
  const fmt = iso => new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago',
  });
  const items = callbacks.map(c => `
    <tr><td style="padding:0 0 10px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.foam};border:1px solid ${C.mist};border-left:3px solid ${C.lagoon}">
        <tr><td style="padding:14px 18px;font-family:${FONT_BODY}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:15px;font-weight:600;color:${C.ink}">${esc(c.callerName || 'Unknown caller')}</td>
            <td align="right" style="font-size:12px;color:${C.faint};white-space:nowrap">${esc(fmt(c.createdAt))}</td>
          </tr></table>
          <p style="margin:3px 0 0;font-size:14px;color:${C.ocean}">${esc(c.callerPhone || 'No number provided')}</p>
          ${c.reason ? `<p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:${C.body}">${esc(c.reason)}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>`).join('');
  const plural = pendingCount === 1 ? '' : 's';

  return layout({
    preheader: `${pendingCount} callback${plural} still waiting on you.`,
    eyebrow:   'Daily Digest',
    brand:     'Reception Portal',
    title:     `${pendingCount} pending callback${plural}`,
    body: `
      ${greeting(toName)}
      ${para(`The following caller${plural} ${pendingCount === 1 ? 'is' : 'are'} still waiting to hear back. Mark each one as handled once you&rsquo;ve followed up.`, { mb: 20 })}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">${items}</table>
      ${button(digestUrl, 'Review & update callbacks')}
      ${fineprint('This link expires in <strong>48 hours</strong>.')}`,
  });
}

function buildPasswordResetEmail({ toName, resetUrl, expiresIn }) {
  return layout({
    preheader: 'Use the link inside to choose a new Staff Portal password. It expires in 24 hours.',
    eyebrow:   'Account Security',
    title:     'Reset your password',
    body: `
      ${greeting(toName)}
      ${para('We received a request to reset the password for your Staff Portal account. Click the button below to choose a new one.')}
      ${button(resetUrl, 'Reset password')}
      ${fineprint('This link expires in <strong>${esc(expiresIn)}</strong>. If you didn&rsquo;t request a reset, you can safely ignore this email &mdash; your password won&rsquo;t change.')}`,
  });
}

function buildReceptionWelcomeEmail({ toName, loginUrl }) {
  return layout({
    preheader: 'You now have access to the Reception Portal. Sign in with your staff credentials.',
    eyebrow:   'Access Granted',
    brand:     'Reception Portal',
    title:     "You've been granted access",
    body: `
      ${greeting(toName)}
      ${para('You now have access to the Blue Bayou Reception Portal.')}
      ${para('Sign in with your existing Staff Portal credentials &mdash; the same email and password you already use.')}
      ${button(loginUrl, 'Open the Reception Portal')}`,
  });
}

function buildCallbackEmail({ toName, callerName, callerPhone, reason, notes, loggedBy }) {
  return layout({
    preheader: `${callerName || 'A caller'} is waiting for a call back${reason ? ` — ${reason}` : ''}.`,
    eyebrow:   'Callback Request',
    brand:     'Reception Portal',
    title:     `Please call back ${callerName || 'this caller'}`,
    body: `
      ${greeting(toName)}
      ${para('Reception has logged a new callback request for you.')}
      ${details([
        ['Caller',    esc(callerName)],
        ['Phone',     callerPhone && `<a href="tel:${esc(String(callerPhone).replace(/[^\d+]/g, ''))}" style="color:${C.ocean};text-decoration:none;font-weight:600">${esc(callerPhone)}</a>`],
        ['Reason',    esc(reason)],
        ['Notes',     notes && `<span style="color:${C.body};font-style:italic">${esc(notes)}</span>`],
        ['Logged by', esc(loggedBy)],
      ])}`,
    footer: 'Blue Bayou &amp; Gulf Islands Waterparks &middot; Reception Portal',
  });
}

export async function sendSharedReportInvite({ toEmail, toName, reportTitle, url, pin, invitedBy, triggeredBy }) {
  if (!resend || !toEmail) return false;
  const subject = `${reportTitle} — your access PIN`;
  const html    = buildSharedReportInviteEmail({ toName, reportTitle, url, pin, invitedBy });
  try {
    await resend.emails.send({ from: FROM, to: toEmail, subject, html });
    logEmail({ type: 'shared_report_invite', toEmail, toName, subject, htmlBody: html, triggeredBy });
    return true;
  } catch (err) {
    console.error('Shared report invite email failed:', err.message);
    return false;
  }
}

function buildSharedReportInviteEmail({ toName, reportTitle, url, pin, invitedBy }) {
  return layout({
    preheader: `${invitedBy || 'Someone'} shared “${reportTitle}” with you. Your personal access PIN is inside.`,
    eyebrow:   'Confidential · Shared Report',
    title:     reportTitle,
    brand:     'Analytics',
    body: `
      ${greeting(toName)}
      ${para(`${invitedBy ? `<strong style="color:${C.ink}">${esc(invitedBy)}</strong> has` : 'You have been'} shared a confidential report with you. Open the report and enter your personal PIN to view it.`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${C.foam};border:1px solid ${C.mist}">
        <tr><td align="center" style="padding:22px 16px">
          <p style="margin:0 0 10px;font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${C.muted}">Your access PIN</p>
          <p style="margin:0;font-family:${FONT_MONO};font-size:30px;font-weight:600;letter-spacing:.3em;color:${C.deep}">${esc(pin)}</p>
        </td></tr>
      </table>
      ${button(url, 'Open the report')}
      ${fineprint('This PIN is unique to you and every view is logged. Please don&rsquo;t forward the link or PIN. If you weren&rsquo;t expecting this, you can ignore this email.')}`,
    footer: 'Blue Bayou &amp; Gulf Islands Waterparks &middot; Analytics',
  });
}
