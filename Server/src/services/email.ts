import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  await transporter.sendMail({
    from: process.env.FROM_EMAIL ?? process.env.SMTP_USER,
    to,
    subject: 'Your LeadOps verification code',
    html: `
      <div style="font-family:sans-serif;max-width:440px;margin:0 auto;padding:24px">
        <h2 style="color:#f97316;margin:0 0 8px">LeadOps</h2>
        <p style="color:#374151;margin:0 0 16px">Use the code below to verify your email address.</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center">
          <span style="font-size:36px;font-weight:700;letter-spacing:0.4em;color:#111827">${otp}</span>
        </div>
        <p style="color:#9ca3af;font-size:13px;margin:16px 0 0">This code expires in <strong>10 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}
