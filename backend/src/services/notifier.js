const config = require('../config');

// ── External notification backend (crop-disease-detector) ────────────────────
// This backend provides SMS (Termii) and Email notification endpoints that are
// already configured with credentials server-side — AgriEyes just calls them.
// No Twilio or SMTP keys needed on our end.
//
// POST /user/api/sms/send        → { to, message }
// POST /gas-detectors/sendemail/{email} → { message } (or body)
//
// If NOTIFY_API_URL is not set, falls back to local SMTP/Twilio config.

const NOTIFY_API_URL = process.env.NOTIFY_API_URL || 'https://crop-disease-detector-8nqt.onrender.com';
const NOTIFY_API_TOKEN = process.env.NOTIFY_API_TOKEN || ''; // JWT from /user/auth/login

let _jwtToken = null;
let _jwtExpiry = 0;

// Auto-login to get a fresh JWT if NOTIFY_API_PHONE + NOTIFY_API_PASSWORD are set
async function getAuthToken() {
  const phone = process.env.NOTIFY_API_PHONE;
  const password = process.env.NOTIFY_API_PASSWORD;

  // Static token provided — use it
  if (NOTIFY_API_TOKEN) return NOTIFY_API_TOKEN;
  // No credentials configured
  if (!phone || !password) return null;

  // Reuse cached token if still valid (tokens typically last 24h, we refresh every 23h)
  if (_jwtToken && Date.now() < _jwtExpiry) return _jwtToken;

  try {
    const res = await fetch(`${NOTIFY_API_URL}/user/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Exact schema from Swagger: { phoneNumber, password }
      body: JSON.stringify({ phoneNumber: phone, password }),
    });
    if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    // Accept any common JWT field name the backend might return
    _jwtToken = data.token || data.accessToken || data.jwt || data.jwtToken;
    _jwtExpiry = Date.now() + 23 * 60 * 60 * 1000; // refresh every 23 h
    console.log('[notifier] External API: JWT refreshed ✓');
    return _jwtToken;
  } catch (err) {
    console.error('[notifier] External API auth failed:', err.message);
    return null;
  }
}

// ── External SMS ──────────────────────────────────────────────────────────────
async function sendExternalSms(to, message) {
  const token = await getAuthToken();
  if (!token) {
    console.log('[notifier] External SMS: no auth token — skipping');
    return false;
  }

  try {
    // SMS endpoint uses query params: POST /user/api/sms/send?to=&message=
    const params = new URLSearchParams({ to, message });
    const res = await fetch(`${NOTIFY_API_URL}/user/api/sms/send?${params}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('[notifier] External SMS failed:', res.status, await res.text());
      return false;
    }
    console.log(`[notifier] External SMS sent to ${to} ✓`);
    return true;
  } catch (err) {
    console.error('[notifier] External SMS error:', err.message);
    return false;
  }
}

// ── External Email ────────────────────────────────────────────────────────────
async function sendExternalEmail(email, message) {
  const token = await getAuthToken();
  if (!token) {
    console.log('[notifier] External email: no auth token — skipping');
    return false;
  }

  try {
    // Email endpoint: POST /gas-detectors/sendemail/{email}?name=AgriEyes
    const encodedEmail = encodeURIComponent(email);
    const params = new URLSearchParams({ name: 'AgriEyes AI Alert' });
    const res = await fetch(`${NOTIFY_API_URL}/gas-detectors/sendemail/${encodedEmail}?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Include message as body in case the endpoint accepts it
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      console.error('[notifier] External email failed:', res.status, await res.text());
      return false;
    }
    console.log(`[notifier] External email sent to ${email} ✓`);
    return true;
  } catch (err) {
    console.error('[notifier] External email error:', err.message);
    return false;
  }
}

// ── Local SMTP fallback ───────────────────────────────────────────────────────
let nodemailer = null;
function getMailer() {
  if (!config.smtp.enabled) return null;
  if (!nodemailer) nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

async function sendLocalEmail(subject, body) {
  if (!config.alerts.emailTo) return;
  const transport = getMailer();
  if (!transport) {
    console.log(`[notifier] SMTP not configured — would email "${subject}" to ${config.alerts.emailTo}`);
    return;
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to: config.alerts.emailTo, subject, text: body });
  } catch (err) {
    console.error('[notifier] Local email failed:', err.message);
  }
}

// ── Local Twilio SMS fallback ─────────────────────────────────────────────────
async function sendLocalSms(body) {
  if (!config.alerts.smsTo) return;
  if (!config.twilio.enabled) {
    console.log(`[notifier] Twilio not configured — would SMS "${body}" to ${config.alerts.smsTo}`);
    return;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: config.alerts.smsTo, From: config.twilio.fromNumber, Body: body }),
    });
    if (!res.ok) console.error('[notifier] Twilio SMS failed:', await res.text());
  } catch (err) {
    console.error('[notifier] Twilio SMS error:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
// Tries external API first; if it fails or isn't configured, falls back to
// local SMTP/Twilio. A failure in one channel never blocks the other.
async function sendCriticalAlert({ subject, message }) {
  const emailTo = config.alerts.emailTo;
  const smsTo   = config.alerts.smsTo;

  const tasks = [];

  // Email — try external first, then SMTP
  if (emailTo) {
    tasks.push(
      sendExternalEmail(emailTo, `${subject}\n\n${message}`)
        .then((ok) => { if (!ok) return sendLocalEmail(subject, message); })
        .catch(() => sendLocalEmail(subject, message))
    );
  }

  // SMS — try external first, then Twilio
  if (smsTo) {
    tasks.push(
      sendExternalSms(smsTo, `${subject}: ${message}`)
        .then((ok) => { if (!ok) return sendLocalSms(message); })
        .catch(() => sendLocalSms(message))
    );
  }

  if (tasks.length === 0) {
    console.log(`[notifier] No recipients configured — alert: ${subject}`);
  }

  await Promise.allSettled(tasks);
}

module.exports = { sendCriticalAlert, sendExternalSms, sendExternalEmail };
