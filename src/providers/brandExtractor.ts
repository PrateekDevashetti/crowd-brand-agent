import * as cheerio from "cheerio";
import type { BrandProfile } from "./imageProvider.js";

export interface ScrapedAssets {
  /** Best logo candidate, in priority order of discovery. */
  logo?: string;
  /** Up to ~6 content images found on the page (absolute URLs). */
  images: string[];
}

export interface ScrapeResult {
  /** JSON string of brand signals, fed to the LLM. */
  signals: string;
  /** Downloadable asset URLs discovered on the page. */
  assets: ScrapedAssets;
}

/**
 * Scrape brand signals + assets from a website's HTML.
 *
 * Production upgrade (handoff item 8): render the page with Playwright,
 * screenshot it, and send the screenshot to a vision model instead of
 * relying on raw HTML signals.
 */
export async function scrapeSite(url: string): Promise<ScrapeResult> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; BrandLayer/0.1; +http://localhost:3000)",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content")?.trim() ??
    $('meta[property="og:description"]').attr("content")?.trim() ??
    "";
  const ogImage = $('meta[property="og:image"]').attr("content") ?? "";
  const themeColor = $('meta[name="theme-color"]').attr("content") ?? "";
  const siteName = $('meta[property="og:site_name"]').attr("content") ?? "";

  const headings = $("h1, h2")
    .slice(0, 12)
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .join(" | ");

  // Hex colors from inline <style> blocks and raw HTML (style="" attrs etc.)
  const hexRe = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
  const colorCounts = new Map<string, number>();
  const tally = (text: string) => {
    for (const m of text.match(hexRe) ?? []) {
      const c = m.toLowerCase();
      colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
    }
  };
  $("style").each((_, el) => tally($(el).text()));
  tally(html);
  const colors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([hex, count]) => ({ hex, count }));

  // Font families from Google Fonts links and font-family declarations
  const fonts = new Set<string>();
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    for (const m of href.matchAll(/family=([^&:|]+)/g)) {
      fonts.add(decodeURIComponent(m[1]).replace(/\+/g, " "));
    }
  });
  for (const m of html.matchAll(/font-family:\s*['"]?([^;'",}]+)/g)) {
    const fam = m[1].trim();
    if (fam && !/^(inherit|sans-serif|serif|monospace|var\()/i.test(fam)) {
      fonts.add(fam);
    }
    if (fonts.size > 12) break;
  }

  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

  /* ---- assets ---- */
  const abs = (href?: string): string | undefined => {
    if (!href) return undefined;
    try {
      const u = new URL(href, res.url || url);
      return /^https?:$/.test(u.protocol) ? u.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  // Logo: explicit "logo" imgs > apple-touch-icon > og:image > largest icon
  const logoCandidates: (string | undefined)[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
    const hint = `${src} ${$(el).attr("class") ?? ""} ${$(el).attr("alt") ?? ""} ${$(el).attr("id") ?? ""}`;
    if (/logo/i.test(hint)) logoCandidates.push(abs(src));
  });
  logoCandidates.push(abs($('link[rel="apple-touch-icon"]').attr("href")));
  logoCandidates.push(abs($('link[rel="apple-touch-icon-precomposed"]').attr("href")));
  logoCandidates.push(abs(ogImage));
  $('link[rel="icon"], link[rel="shortcut icon"]').each((_, el) => {
    logoCandidates.push(abs($(el).attr("href")));
  });
  const logo = logoCandidates.find(Boolean);

  // Content images: og:image + page <img>s, deduped, skipping data-URIs/trackers
  const imageSet = new Set<string>();
  const pushImg = (u?: string) => {
    if (!u) return;
    if (/\.(svg|gif)(\?|$)/i.test(u)) return; // favor raster content imagery
    if (/(pixel|tracking|sprite|spacer|1x1)/i.test(u)) return;
    imageSet.add(u);
  };
  pushImg(abs(ogImage));
  $("img").each((_, el) => {
    if (imageSet.size >= 12) return;
    pushImg(abs($(el).attr("src") ?? $(el).attr("data-src") ?? ""));
  });
  const images = [...imageSet].filter((u) => u !== logo).slice(0, 6);

  return {
    signals: JSON.stringify({
      url,
      title,
      siteName,
      description,
      themeColor,
      ogImage,
      headings,
      colors,
      fonts: [...fonts].slice(0, 12),
      bodyText,
    }),
    assets: { logo, images },
  };
}

/**
 * The brand-profile prompt. Better extraction = better everything downstream.
 */
export const BRAND_EXTRACTION_PROMPT = `You are a senior brand designer. Below are raw signals scraped from a company's website (title, meta description, headings, hex colors ordered by frequency, font families, and body text).

Distill them into a brand profile JSON object with EXACTLY this shape:

{
  "name": "Brand name",
  "description": "One-sentence summary of what the company does",
  "tagline": "A short tagline in the brand's own voice (use the site's actual tagline if one is evident)",
  "colors": [{ "hex": "#xxxxxx", "role": "primary | secondary | accent | background | text" }],
  "fonts": [{ "name": "Font name", "role": "heading | body" }],
  "tone": "3-6 adjectives describing the brand voice, comma-separated",
  "styleKeywords": ["5-8 visual style keywords, e.g. 'minimal', 'gradient-heavy', 'photographic'"],
  "imageryGuidelines": "2-3 sentences describing what on-brand imagery looks like: subjects, composition, lighting, mood",
  "doNots": ["2-4 things to avoid in imagery for this brand"]
}

Rules:
- Pick at most 5 colors. Ignore near-duplicates and generic grays unless clearly part of the palette.
- Infer roles from frequency and context (theme-color is usually primary).
- If fonts are unknown, suggest plausible categories (e.g. "geometric sans-serif").
- Respond with ONLY the JSON object, no markdown fences, no commentary.

SIGNALS:
`;

/**
 * Inject the brand profile into every generation — the core mechanic.
 * One-line user prompt in, fully on-brand prompt out.
 *
 * Production upgrade: also pass the brand logo as a reference image.
 */
export function buildBrandedPrompt(
  profile: BrandProfile,
  userPrompt: string,
): string {
  const colors = profile.colors
    ?.map((c) => `${c.hex}${c.role ? ` (${c.role})` : ""}`)
    .join(", ");
  const fonts = profile.fonts
    ?.map((f) => `${f.name}${f.role ? ` (${f.role})` : ""}`)
    .join(", ");
  const lines = [
    `Create an image for the brand "${profile.name}".`,
    profile.description ? `About the brand: ${profile.description}` : "",
    colors ? `Brand color palette (use these dominantly): ${colors}` : "",
    fonts ? `Brand typography (if any text appears): ${fonts}` : "",
    profile.tone ? `Brand tone: ${profile.tone}` : "",
    profile.styleKeywords?.length
      ? `Visual style: ${profile.styleKeywords.join(", ")}`
      : "",
    profile.imageryGuidelines
      ? `Imagery guidelines: ${profile.imageryGuidelines}`
      : "",
    profile.doNots?.length ? `Avoid: ${profile.doNots.join("; ")}` : "",
    "",
    `REQUEST: ${userPrompt}`,
    "",
    "The result must look like it was produced by this brand's in-house design team: consistent palette, consistent mood, professional finish. No watermarks.",
  ];
  return lines.filter(Boolean).join("\n");
}
