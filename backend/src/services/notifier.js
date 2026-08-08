const config = require('../config');

// Both channels degrade gracefully: if SMTP/Twilio credentials aren't set,
// this logs to console instead of throwing, so the rest of the alert
// pipeline (dashboard, DB, sprinkler) keeps working with zero config.

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

async function sendEmail(subject, body) {
  if (!config.alerts.emailTo) return;

  const transport = getMailer();
  if (!transport) {
    console.log(`[notifier] SMTP not configured — would have emailed "${subject}" to ${config.alerts.emailTo}`);
    return;
  }

  try {
    await transport.sendMail({
      from: config.smtp.from,
      to: config.alerts.emailTo,
      subject,
      text: body,
    });
  } catch (err) {
    console.error('[notifier] Email send failed:', err.message);
  }
}

async function sendSms(body) {
  if (!config.alerts.smsTo) return;

  if (!config.twilio.enabled) {
    console.log(`[notifier] Twilio not configured — would have texted "${body}" to ${config.alerts.smsTo}`);
    return;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: config.alerts.smsTo,
        From: config.twilio.fromNumber,
        Body: body,
      }),
    });

    if (!res.ok) {
      console.error('[notifier] SMS send failed:', await res.text());
    }
  } catch (err) {
    console.error('[notifier] SMS send failed:', err.message);
  }
}

// Fires both channels in parallel; a failure in one doesn't block the other.
async function sendCriticalAlert({ subject, message }) {
  await Promise.allSettled([sendEmail(subject, message), sendSms(message)]);
}

module.exports = { sendCriticalAlert, sendEmail, sendSms };
