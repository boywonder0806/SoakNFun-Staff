import { Resend } from 'resend';

const resend        = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM          = process.env.RESEND_FROM_EMAIL || 'system@bluebayoustaff.com';
const APP_URL       = process.env.CLIENT_URL       || 'http://localhost:5173';
const RECEPTION_URL = process.env.RECEPTION_URL    || 'http://localhost:5174';

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

export async function sendWelcomeEmail({ toEmail, toName, tempPassword }) {
  if (!resend || !toEmail) return;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: 'Welcome to the Blue Bayou Staff Portal',
      html:    buildWelcomeEmail({ toName, toEmail, tempPassword, loginUrl: `${APP_URL}/login` }),
    });
  } catch (err) {
    console.error('Welcome email failed:', err.message);
  }
}

export async function resendStaffWelcomeEmail({ toEmail, toName }) {
  if (!resend || !toEmail) return;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: 'Your Blue Bayou Staff Portal Account',
      html:    buildStaffWelcomeResendEmail({ toName, toEmail, loginUrl: `${APP_URL}/login` }),
    });
  } catch (err) {
    console.error('Staff welcome resend failed:', err.message);
  }
}

export async function sendReceptionWelcomeEmail({ toEmail, toName }) {
  if (!resend || !toEmail) return;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: 'You now have access to the Blue Bayou Reception Portal',
      html:    buildReceptionWelcomeEmail({ toName, loginUrl: `${RECEPTION_URL}/login` }),
    });
  } catch (err) {
    console.error('Reception welcome email failed:', err.message);
  }
}

export async function sendPasswordResetEmail({ toEmail, toName, resetToken }) {
  if (!resend || !toEmail) return;
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
  try {
    await resend.emails.send({
      from:    FROM,
      to:      toEmail,
      subject: 'Reset Your Password — Blue Bayou Staff Portal',
      html:    buildPasswordResetEmail({ toName, resetUrl }),
    });
  } catch (err) {
    console.error('Password reset email failed:', err.message);
  }
}

function buildWelcomeEmail({ toName, toEmail, tempPassword, loginUrl }) {
  const row = (label, value) =>
    `<tr><td style="padding:8px 0;color:#9ca3af;font-size:13px;width:120px;vertical-align:top">${label}</td>
         <td style="padding:8px 0;color:#111827;font-weight:600">${value}</td></tr>`;
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#0077B6;padding:24px 28px;border-radius:12px 12px 0 0">
        <p style="color:#90e0ff;margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Blue Bayou Water Park</p>
        <h1 style="color:#fff;margin:4px 0 0;font-size:20px">Welcome to the Staff Portal</h1>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;margin:0 0 20px">Hi ${toName || 'there'}, your account has been created. Use the credentials below to sign in.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          ${row('Email', toEmail)}
          ${row('Password', `<span style="font-family:monospace;background:#f3f4f6;padding:2px 8px;border-radius:4px">${tempPassword}</span>`)}
        </table>
        <p style="color:#6b7280;font-size:13px;margin:0 0 20px">You will be asked to set a new password the first time you sign in.</p>
        <a href="${loginUrl}" style="display:inline-block;background:#0077B6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Sign In to Staff Portal</a>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">Blue Bayou Water Park · Baton Rouge, LA</p>
      </div>
    </div>
  `;
}

function buildStaffWelcomeResendEmail({ toName, toEmail, loginUrl }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#0077B6;padding:24px 28px;border-radius:12px 12px 0 0">
        <p style="color:#90e0ff;margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Blue Bayou Water Park</p>
        <h1 style="color:#fff;margin:4px 0 0;font-size:20px">Staff Portal Access</h1>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;margin:0 0 16px">Hi ${toName || 'there'}, here are your Blue Bayou Staff Portal login details.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:8px 0;color:#9ca3af;font-size:13px;width:120px">Email</td>
              <td style="padding:8px 0;color:#111827;font-weight:600">${toEmail}</td></tr>
          <tr><td style="padding:8px 0;color:#9ca3af;font-size:13px">Password</td>
              <td style="padding:8px 0;color:#6b7280;font-size:13px">Your existing password (use Forgot Password if needed)</td></tr>
        </table>
        <a href="${loginUrl}" style="display:inline-block;background:#0077B6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Sign In to Staff Portal</a>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">Blue Bayou Water Park · Baton Rouge, LA</p>
      </div>
    </div>
  `;
}

function buildPasswordResetEmail({ toName, resetUrl }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#0077B6;padding:24px 28px;border-radius:12px 12px 0 0">
        <p style="color:#90e0ff;margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Blue Bayou Water Park</p>
        <h1 style="color:#fff;margin:4px 0 0;font-size:20px">Password Reset</h1>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;margin:0 0 20px">Hi ${toName || 'there'}, we received a request to reset your Staff Portal password. Click the button below to set a new one.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#0077B6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Reset Password</a>
        <p style="color:#6b7280;font-size:13px;margin:20px 0 0">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.</p>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">Blue Bayou Water Park · Baton Rouge, LA</p>
      </div>
    </div>
  `;
}

function buildReceptionWelcomeEmail({ toName, loginUrl }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#0077B6;padding:24px 28px;border-radius:12px 12px 0 0">
        <p style="color:#90e0ff;margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Blue Bayou Water Park</p>
        <h1 style="color:#fff;margin:4px 0 0;font-size:20px">Reception Portal Access</h1>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;margin:0 0 16px">Hi ${toName || 'there'}, you've been granted access to the Blue Bayou Reception Portal.</p>
        <p style="color:#6b7280;font-size:13px;margin:0 0 20px">Sign in using your existing staff portal credentials (same email and password).</p>
        <a href="${loginUrl}" style="display:inline-block;background:#0077B6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Open Reception Portal</a>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">Blue Bayou Water Park · Baton Rouge, LA</p>
      </div>
    </div>
  `;
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
