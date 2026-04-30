const nodemailer = require('nodemailer')

// ================== TRANSPORTER ==================
const smtpPort = Number(process.env.SMTP_PORT || 587)
const smtpFrom = process.env.SMTP_FROM || `"TimeBound" <${process.env.SMTP_USER}>`
const rejectUnauthorized = String(process.env.SMTP_REJECT_UNAUTHORIZED || 'true').trim().toLowerCase() !== 'false'
const emailProvider = String(process.env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase()
const brevoApiUrl = 'https://api.brevo.com/v3/smtp/email'

const parseSender = (from) => {
  const match = from.match(/^(.*?)\s*<(.+)>$/)
  if (!match) return { email: from.trim() }

  return {
    name: match[1].replace(/^"|"$/g, '').trim(),
    email: match[2].trim(),
  }
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized,
  },
})

// Verify SMTP connection (run once at startup)
if (emailProvider === 'brevo') {
  if (process.env.BREVO_API_KEY) {
    console.log('Email provider: brevo api')
  } else {
    console.warn('BREVO_API_KEY is missing. Brevo emails will fail until it is set.')
  }
} else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  console.log(`SMTP config: host=${process.env.SMTP_HOST}, port=${smtpPort}, secure=${smtpPort === 465}, rejectUnauthorized=${rejectUnauthorized}`)

  transporter.verify((err) => {
    if (err) {
      console.error('SMTP Error:', err.message)
    } else {
      console.log('SMTP Server is ready')
    }
  })
} else {
  console.warn('SMTP env vars are missing. Emails will fail until SMTP_HOST, SMTP_USER, and SMTP_PASS are set.')
}

// ================== BRAND CONFIG ==================
const brandColor = '#C8FF00'

// ================== HTML TEMPLATE ==================
const htmlTemplate = (title, body) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
body {
  font-family: 'DM Sans', Arial, sans-serif;
  background: #0A0A0F;
  color: #E4E4EE;
  margin: 0;
  padding: 0;
}
.wrap {
  max-width: 520px;
  margin: 40px auto;
  background: #0E0E1C;
  border: 1px solid rgba(200,255,0,0.12);
  border-radius: 16px;
  overflow: hidden;
}
.head {
  background: linear-gradient(135deg, ${brandColor}, #85A800);
  padding: 32px;
  text-align: center;
}
.head h1 {
  margin: 0;
  color: #0A0A0F;
  font-size: 24px;
  font-weight: 800;
}
.body {
  padding: 32px;
}
.stat {
  background: rgba(200,255,0,0.05);
  border: 1px solid rgba(200,255,0,0.12);
  border-radius: 12px;
  padding: 16px;
  margin: 8px 0;
  display: flex;
  justify-content: space-between;
}
.stat-val {
  color: ${brandColor};
  font-size: 20px;
  font-weight: bold;
}
.foot {
  padding: 16px;
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-size: 12px;
  color: #606089;
}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>⚡ TimeBound</h1>
    <p style="margin-top:6px;font-size:14px;color:#0A0A0F;opacity:0.7">${title}</p>
  </div>
  <div class="body">${body}</div>
  <div class="foot">TimeBound · Smart Daily Task Tracker</div>
</div>
</body>
</html>
`

// ================== GENERIC SEND FUNCTION ==================
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    if (emailProvider === 'brevo') {
      const response = await fetch(brevoApiUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: parseSender(smtpFrom),
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(result.message || `Brevo API failed with status ${response.status}`)
      }

      console.log(`📩 Email sent to ${to} | ID: ${result.messageId || result.messageIds?.[0] || 'brevo-api'}`)
      return true
    }

    const info = await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html,
      text,
    })

    console.log(`📩 Email sent to ${to} | ID: ${info.messageId}`)
    return true
  } catch (error) {
    console.error(`❌ Email failed to ${to}:`, error.message)
    return false
  }
}

// ================== OTP EMAIL ==================
exports.sendOTPEmail = async (email, otp) => {
  return sendEmail({
    to: email,
    subject: 'Your TimeBound Login Code',
    text: `Your OTP is ${otp}. It expires in 5 minutes.`,
    html: htmlTemplate(
      'Your OTP Code',
      `
      <p style="color:#9494BA;margin-bottom:20px">
        Use this code to log in. It expires in 5 minutes.
      </p>

      <div style="text-align:center;background:rgba(200,255,0,0.08);
      border:1px solid rgba(200,255,0,0.2);border-radius:12px;padding:24px">
        <div style="font-size:38px;font-weight:800;letter-spacing:10px;color:${brandColor}">
          ${otp}
        </div>
      </div>

      <p style="color:#606089;font-size:12px;text-align:center;margin-top:20px">
        If you didn't request this, ignore this email.
      </p>
      `
    ),
  })
}

// ================== DAILY REPORT ==================
exports.sendDailyReport = async (email, { total, completed, pending, pct }) => {
  return sendEmail({
    to: email,
    subject: 'Your TimeBound Daily Report',
    text: `Total: ${total}, Completed: ${completed}, Missed: ${pending}, Progress: ${pct}%`,
    html: htmlTemplate(
      'Daily Summary',
      `
      <div class="stat"><span>Total Tasks</span><span class="stat-val">${total}</span></div>
      <div class="stat"><span>Completed</span><span class="stat-val">${completed}</span></div>
      <div class="stat"><span>Missed</span><span class="stat-val" style="color:#FF6B6B">${pending}</span></div>
      <div class="stat"><span>Progress</span><span class="stat-val">${pct}%</span></div>
      `
    ),
  })
}

// ================== DEADLINE WARNING ==================
exports.sendDeadlineWarning = async (email, tasks) => {
  const list = tasks
    .map(
      (t) => `
      <div class="stat">
        <span>${t.title}</span>
        <span class="stat-val" style="color:#FFB347">${t.priority}</span>
      </div>`
    )
    .join('')

  return sendEmail({
    to: email,
    subject: '⚠️ 2 hours left for your tasks!',
    text: `You have ${tasks.length} tasks expiring soon.`,
    html: htmlTemplate(
      'Deadline Warning',
      `
      <p style="color:#FFB347;margin-bottom:16px">
        These tasks expire in 2 hours:
      </p>
      ${list}
      `
    ),
  })
}
