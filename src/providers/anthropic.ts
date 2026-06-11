import { env } from "../lib/env.js";
import { BRAND_EXTRACTION_PROMPT } from "./brandExtractor.js";
import type { BrandProfile } from "./imageProvider.js";

/**
 * Claude as the brand-extraction brain.
 *
 * Image generation stays on OpenAI/Gemini; Claude handles the language step:
 * distilling scraped site signals into the brand profile. This is the
 * highest-leverage LLM call in the product — better extraction improves
 * every downstream generation.
 */

const API = "https://api.anthropic.com/v1/messages";

export function anthropicConfigured(): boolean {
  return Boolean(env.anthropicApiKey);
}

export async function extractBrandProfileWithClaude(
  signalsJson: string,
): Promise<BrandProfile> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 1500,
      messages: [
        { role: "user", content: BRAND_EXTRACTION_PROMPT + signalsJson },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body.slice(0, 300);
    try {
      message =
        (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* keep raw slice */
    }
    throw new Error(`Claude brand extraction failed (HTTP ${res.status}): ${message}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text =
    json.content?.find((b) => b.type === "text")?.text ?? "{}";
  // Claude sometimes wraps JSON in fences despite instructions — strip them.
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned) as BrandProfile;
}
