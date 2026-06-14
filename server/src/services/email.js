import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM   = process.env.RESEND_FROM_EMAIL || 'reception@bluebayoustaff.com';

export async function sendCallbackNotification({ toEmail, toName, callerName, callerPhone, reason, notes, loggedBy }) {
  if (!resend || !toEmail) return;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: `Callback Request — ${callerName}`,
      html:    buildCallbackEmail({ toName, callerName, callerPhone, reason, notes, loggedBy }),
    });
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }
}

function buildCallbackEmail({ toName, callerName, callerPhone, reason, notes, loggedBy }) {
  const row = (label, value) => value
    ? `<tr style="border-bottom:1px solid #f3f4f6">
         <td style="padding:10px 0;color:#9ca3af;font-size:13px;width:110px">${label}</td>
         <td style="padding:10px 0;color:#111827">${value}</td>
       </tr>`
    : '';

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#0077B6;padding:24px 28px;border-radius:12px 12px 0 0">
        <p style="color:#90e0ff;margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Blue Bayou Water Park</p>
        <h1 style="color:#fff;margin:4px 0 0;font-size:20px">Callback Request</h1>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;margin:0 0 20px">Hi ${toName || 'there'}, you have a new callback request from reception.</p>
        <table style="width:100%;border-collapse:collapse">
          ${row('Caller',    callerName)}
          ${row('Phone',     callerPhone)}
          ${row('Reason',    reason)}
          ${notes ? `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:10px 0;color:#9ca3af;font-size:13px;width:110px">Notes</td><td style="padding:10px 0;color:#374151;font-style:italic">${notes}</td></tr>` : ''}
          ${row('Logged by', loggedBy)}
        </table>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">Blue Bayou Reception Portal</p>
      </div>
    </div>
  `;
}
