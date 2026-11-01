import fs from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import * as dotenv from "dotenv";

dotenv.config();

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface EmailAttachmentPayload {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  pdfAttachmentPath: string;
  attachmentFilename?: string;
  replyTo?: string;
}

export interface EmailDispatchResult {
  success: boolean;
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
  sentAt: string;
}

/**
 * Resolves and validates SMTP configuration from environment variables.
 * Requires EMAIL_USER and EMAIL_PASS in `.env`.
 */
export function resolveSmtpConfig(overrides?: Partial<SmtpConfig>): SmtpConfig {
  const user = overrides?.user ?? process.env.EMAIL_USER;
  const pass = overrides?.pass ?? process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error(
      "Missing SMTP credentials: EMAIL_USER and EMAIL_PASS must be configured in .env"
    );
  }

  const host = overrides?.host ?? process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port =
    overrides?.port ??
    (process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : 465);
  const secure =
    overrides?.secure ??
    (process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === "true"
      : port === 465);

  return { host, port, secure, user, pass };
}

/**
 * Creates a reusable Nodemailer SMTP transporter.
 */
export function createSmtpTransporter(
  configOverrides?: Partial<SmtpConfig>
): Transporter<SMTPTransport.SentMessageInfo> {
  const config = resolveSmtpConfig(configOverrides);

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

/**
 * Dispatches an application email to a recruiter with a local PDF resume attachment via standard SMTP.
 */
export async function sendApplicationEmail(
  payload: EmailAttachmentPayload,
  smtpOverrides?: Partial<SmtpConfig>
): Promise<EmailDispatchResult> {
  const resolvedPdfPath = path.resolve(payload.pdfAttachmentPath);

  // Verify the local PDF exists and is readable before connecting to SMTP
  try {
    await fs.access(resolvedPdfPath, fs.constants.R_OK);
  } catch {
    throw new Error(
      `Resume PDF attachment not found or unreadable at path: ${resolvedPdfPath}`
    );
  }

  const config = resolveSmtpConfig(smtpOverrides);
  const transporter = createSmtpTransporter(config);

  // Verify SMTP connection & credentials
  await transporter.verify();

  const attachmentName =
    payload.attachmentFilename ?? path.basename(resolvedPdfPath);

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? config.user,
    to: payload.to,
    replyTo: payload.replyTo ?? config.user,
    subject: payload.subject,
    text: payload.bodyText,
    html:
      payload.bodyHtml ??
      payload.bodyText
        .split("\n\n")
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
        .join(""),
    attachments: [
      {
        filename: attachmentName,
        path: resolvedPdfPath,
        contentType: "application/pdf",
      },
    ],
  });

  const accepted = (info.accepted ?? []).map((entry) =>
    typeof entry === "string" ? entry : String(entry)
  );
  const rejected = (info.rejected ?? []).map((entry) =>
    typeof entry === "string" ? entry : String(entry)
  );

  return {
    success: accepted.length > 0 && rejected.length === 0,
    messageId: info.messageId,
    accepted,
    rejected,
    response: info.response,
    sentAt: new Date().toISOString(),
  };
}
