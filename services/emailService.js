const nodemailer = require("nodemailer");

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() || user;
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !password || !fromEmail || !Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error("SMTP email configuration is missing or invalid.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE.toLowerCase() === "true"
      : port === 465,
    auth: { user, pass: password },
    from: `"${(process.env.SMTP_FROM_NAME || "SuvYatra").replace(/["\r\n]/g, "")}" <${fromEmail}>`,
  };
}

let cachedTransporter = null;
let cachedTransporterKey = "";

function getTransporterKey(config) {
  return `${config.host}:${config.port}:${config.secure}:${config.auth.user}`;
}

function buildOtpHtml(otp, kind) {
  const isRegister = kind === "register";
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #102a43; margin: 0 0 8px;">${isRegister ? "Verify your SuvYatra account" : "SuvYatra password reset"}</h2>
      <p style="color: #475569; font-size: 14px;">${isRegister
        ? "Use this one-time code to verify your Gmail address. It expires in 10 minutes."
        : "Use this one-time code to reset your password. It expires in 10 minutes."}</p>
      <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; text-align: center; background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">${otp}</div>
      <p style="color: #94a3b8; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
    </div>
  `;
}

function getTransporter(config) {
  const key = getTransporterKey(config);
  if (!cachedTransporter || cachedTransporterKey !== key) {
    if (cachedTransporter) {
      try { cachedTransporter.close(); } catch { /* ignore */ }
    }
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    cachedTransporterKey = key;
  }
  return cachedTransporter;
}

async function sendPasswordResetOtp(email, otp) {
  const config = getSmtpConfig();
  const transporter = getTransporter(config);

  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: "Your SuvYatra password reset code",
    text: `Your SuvYatra password reset code is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: buildOtpHtml(otp, "reset"),
  });
}

async function sendRegistrationOtp(email, otp) {
  const config = getSmtpConfig();
  const transporter = getTransporter(config);

  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: "Verify your SuvYatra account",
    text: `Your SuvYatra verification code is ${otp}. It expires in 10 minutes. If you did not create an account, you can ignore this email.`,
    html: buildOtpHtml(otp, "register"),
  });
}

async function verifyEmailConfig() {
  try {
    const config = getSmtpConfig();
    const transporter = getTransporter(config);
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code || "EMAIL_NOT_CONFIGURED", message: error.message };
  }
}

module.exports = { sendPasswordResetOtp, sendRegistrationOtp, verifyEmailConfig, getSmtpConfig };
