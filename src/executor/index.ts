import type { Page } from "playwright";
import {
  sendApplicationEmail,
  createSmtpTransporter,
  resolveSmtpConfig,
  type SmtpConfig,
  type EmailAttachmentPayload,
  type EmailDispatchResult,
} from "./email.js";

export {
  sendApplicationEmail,
  createSmtpTransporter,
  resolveSmtpConfig,
  type SmtpConfig,
  type EmailAttachmentPayload,
  type EmailDispatchResult,
};

export interface RecruiterEmailPayload {
  recruiterEmail: string;
  subject: string;
  proposalText: string;
  resumePdfPath: string;
  companyName: string;
  jobTitle: string;
}

export interface CandidateFormProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedInUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

export interface PortalFormSelectors {
  fullNameInput?: string;
  firstNameInput?: string;
  lastNameInput?: string;
  emailInput: string;
  phoneInput?: string;
  coverLetterTextarea?: string;
  resumeFileInput: string;
  submitButton: string;
}

export interface PortalApplicationPayload {
  page: Page;
  applicationUrl: string;
  candidate: CandidateFormProfile;
  proposalText: string;
  resumePdfPath: string;
  selectors: PortalFormSelectors;
}

export interface PortalExecutionResult {
  success: boolean;
  submittedAt: Date;
  confirmationUrl: string;
  confirmationPage: Page;
}

/**
 * Function A: Sends an application email directly to a recruiter with a local PDF attachment via SMTP.
 */
export async function sendRecruiterEmailWithPdf(
  payload: RecruiterEmailPayload
): Promise<EmailDispatchResult> {
  return sendApplicationEmail({
    to: payload.recruiterEmail,
    subject: payload.subject,
    bodyText: payload.proposalText,
    pdfAttachmentPath: payload.resumePdfPath,
  });
}

/**
 * Function B: Uses Playwright to navigate a job application DOM, auto-fill text inputs,
 * upload a local PDF, and click submit.
 */
export async function submitJobApplicationPortal(
  payload: PortalApplicationPayload
): Promise<PortalExecutionResult> {
  const { page, applicationUrl, candidate, proposalText, resumePdfPath, selectors } =
    payload;

  await page.goto(applicationUrl, { waitUntil: "domcontentloaded" });

  if (selectors.fullNameInput) {
    await page.fill(selectors.fullNameInput, candidate.fullName);
  }
  if (selectors.firstNameInput) {
    await page.fill(selectors.firstNameInput, candidate.firstName);
  }
  if (selectors.lastNameInput) {
    await page.fill(selectors.lastNameInput, candidate.lastName);
  }

  await page.fill(selectors.emailInput, candidate.email);

  if (selectors.phoneInput) {
    await page.fill(selectors.phoneInput, candidate.phone);
  }
  if (selectors.coverLetterTextarea) {
    await page.fill(selectors.coverLetterTextarea, proposalText);
  }

  await page.setInputFiles(selectors.resumeFileInput, resumePdfPath);
  await page.click(selectors.submitButton);
  await page.waitForLoadState("networkidle").catch(() => undefined);

  return {
    success: true,
    submittedAt: new Date(),
    confirmationUrl: page.url(),
    confirmationPage: page,
  };
}
