import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as dotenv from "dotenv";

dotenv.config();

// Register the stealth plugin once to mask automation fingerprints (navigator.webdriver, WebGL, etc.)
chromium.use(StealthPlugin());

export type ApplicationMethod = "EMAIL" | "PORTAL";

export interface ScraperConfig {
  headless: boolean;
  userAgent: string;
  navigationTimeoutMs: number;
  viewport: {
    width: number;
    height: number;
  };
  proxyUrl?: string;
}

export interface DomSelectors {
  jobTitleSelector: string;
  companyNameSelector: string;
  descriptionSelector: string;
  locationSelector?: string;
}

export interface ExtractedJobMetadata {
  title: string;
  company: string;
  description: string;
  url: string;
  location?: string;
  recruiterEmail?: string;
  applicationMethod: ApplicationMethod;
  scrapedAt: string;
}

export interface ScrapedJobPosting extends ExtractedJobMetadata {
  externalId?: string;
  jobUrl: string;
  companyName: string;
  jobTitle: string;
  compensationRange?: string;
  rawDescription: string;
  scrapedMetadata: Record<string, unknown>;
}

const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  navigationTimeoutMs: 30_000,
  viewport: { width: 1440, height: 900 },
};

const DEFAULT_SELECTORS: DomSelectors = {
  jobTitleSelector:
    "h1, [data-testid='job-title'], .job-title, .posting-headline h2",
  companyNameSelector:
    "[data-testid='company-name'], .company-name, .employer-name, a[href*='company'], meta[property='og:site_name']",
  descriptionSelector:
    "[data-testid='job-description'], #job-description, .job-description, .description, article, main",
  locationSelector:
    "[data-testid='job-location'], .job-location, .location",
};

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Spins up a local Chromium instance augmented with puppeteer-extra-plugin-stealth.
 */
export async function launchStealthBrowser(
  configOverrides?: Partial<ScraperConfig>
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const config: ScraperConfig = {
    ...DEFAULT_SCRAPER_CONFIG,
    ...configOverrides,
    viewport: {
      ...DEFAULT_SCRAPER_CONFIG.viewport,
      ...configOverrides?.viewport,
    },
  };

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: config.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  };

  if (config.proxyUrl) {
    launchOptions.proxy = { server: config.proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: config.viewport,
    locale: "en-US",
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);

  return { browser, context, page };
}

/**
 * Helper to safely extract trimmed text content from the first matching selector in a comma-separated list.
 */
async function extractFirstMatchingText(
  page: Page,
  selectorGroup: string
): Promise<string> {
  const selectors = selectorGroup
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count();
    if (count > 0) {
      if (selector.startsWith("meta[")) {
        const content = await locator.getAttribute("content");
        if (content && content.trim().length > 0) {
          return content.trim();
        }
      } else {
        const text = await locator.innerText().catch(() => "");
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
    }
  }
  return "";
}

/**
 * Navigates an active Playwright page to a target URL and extracts structured job metadata
 * (Title, Company, Description, and detected Recruiter Email).
 */
export async function extractJobPosting(
  page: Page,
  jobUrl: string,
  customSelectors?: Partial<DomSelectors>
): Promise<ScrapedJobPosting> {
  const selectors: DomSelectors = {
    ...DEFAULT_SELECTORS,
    ...customSelectors,
  };

  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => undefined);

  // Extract primary DOM fields with fallback to document title / body text
  const rawTitle = await extractFirstMatchingText(
    page,
    selectors.jobTitleSelector
  );
  const pageTitle = await page.title();
  const title = rawTitle || pageTitle || "Untitled Position";

  const rawCompany = await extractFirstMatchingText(
    page,
    selectors.companyNameSelector
  );
  const company =
    rawCompany ||
    (pageTitle.includes("at ")
      ? (pageTitle.split("at ")[1]?.split("|")[0]?.trim() ?? "Unknown Company")
      : "Unknown Company");

  const rawDescription = await extractFirstMatchingText(
    page,
    selectors.descriptionSelector
  );
  const bodyFallback =
    rawDescription.length > 0
      ? rawDescription
      : await page.locator("body").innerText().catch(() => "");
  const description = bodyFallback.trim();

  const location = selectors.locationSelector
    ? await extractFirstMatchingText(page, selectors.locationSelector)
    : undefined;

  // Detect any recruiter email addresses in the description
  const matchedEmails = description.match(EMAIL_REGEX);
  const recruiterEmail = matchedEmails?.[0];
  const applicationMethod: ApplicationMethod = recruiterEmail
    ? "EMAIL"
    : "PORTAL";

  const scrapedAt = new Date().toISOString();

  return {
    title,
    company,
    description,
    url: jobUrl,
    jobUrl,
    companyName: company,
    jobTitle: title,
    rawDescription: description,
    ...(location ? { location } : {}),
    ...(recruiterEmail ? { recruiterEmail } : {}),
    applicationMethod,
    scrapedAt,
    scrapedMetadata: {
      pageTitle,
      finalUrl: page.url(),
      scrapedAt,
    },
  };
}

/**
 * Standalone end-to-end scraper function: launches stealth Chromium, navigates to targetUrl,
 * extracts (Title, Company, Description), and cleanly closes the browser instance.
 */
export async function scrapeJobUrl(
  targetUrl: string,
  configOverrides?: Partial<ScraperConfig>,
  customSelectors?: Partial<DomSelectors>
): Promise<ScrapedJobPosting> {
  const { browser, page } = await launchStealthBrowser(configOverrides);
  try {
    return await extractJobPosting(page, targetUrl, customSelectors);
  } finally {
    await browser.close();
  }
}
