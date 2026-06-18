import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { env } from "../lib/env.js";
import { BRAND_EXTRACTION_PROMPT } from "./brandExtractor.js";
import { maybeOpenAIProvider } from "./openai.js";
import { maybeOpenRouterProvider } from "./openrouter.js";
import type {
  BrandProfile,
  EditInput,
  GenerateInput,
  ImageProvider,
  ImageResult,
  ResizeInput,
} from "./imageProvider.js";

const IMAGE_MODEL = "gemini-2.5-flash-image";
const TEXT_MODEL = "gemini-2.5-flash";

function aspectToSize(aspectRatio = "1:1", resolution = "2K"): { width: number; height: number } {
  const [w, h] = aspectRatio.split(":").map(Number);
  const base = resolution === "4K" ? 3840 : resolution === "1K" ? 1024 : 2048;
  if (!w || !h) return { width: base, height: base };
  if (w >= h) return { width: base, height: Math.round((base * h) / w) };
  return { width: Math.round((base * w) / h), height: base };
}

/* ------------------------------------------------------------------ */
/* Gemini implementation                                               */
/* ------------------------------------------------------------------ */

class GeminiProvider implements ImageProvider {
  readonly name = "gemini-2.5-flash-image";
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private extractImage(res: unknown): ImageResult {
    const candidates =
      (res as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] })
        .candidates ?? [];
    for (const part of candidates[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          data: Buffer.from(part.inlineData.data, "base64"),
          mimeType: part.inlineData.mimeType ?? "image/png",
        };
      }
    }
    throw new Error("Gemini response contained no image data");
  }

  async generate(input: GenerateInput): Promise<ImageResult> {
    const parts: Record<string, unknown>[] = [{ text: input.prompt }];
    for (const ref of input.referenceImages ?? []) {
      parts.push({
        inlineData: { mimeType: ref.mimeType, data: ref.data.toString("base64") },
      });
    }
    const res = await this.ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts }],
      // imageConfig.aspectRatio is supported by gemini-2.5-flash-image;
      // cast keeps us resilient to SDK type-lag.
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: input.aspectRatio ?? "1:1" },
      } as never,
    });
    return this.extractImage(res);
  }

  async edit(input: EditInput): Promise<ImageResult> {
    const res = await this.ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.image.toString("base64") } },
            { text: `Edit this image: ${input.prompt}. Preserve everything not mentioned in the edit instruction.` },
          ],
        },
      ],
      config: { responseModalities: ["TEXT", "IMAGE"] } as never,
    });
    return this.extractImage(res);
  }

  async resize(input: ResizeInput): Promise<ImageResult> {
    // Generative resize: outpaint to the new aspect ratio rather than crop.
    const res = await this.ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.image.toString("base64") } },
            {
              text: `Recompose this exact image to a ${input.aspectRatio} aspect ratio. Extend backgrounds naturally (outpaint) instead of stretching or cropping the subject. Keep all colors, style, and subject identical.`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: input.aspectRatio },
      } as never,
    });
    return this.extractImage(res);
  }

  async extractBrandProfile(signalsJson: string): Promise<BrandProfile> {
    const res = await this.ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: BRAND_EXTRACTION_PROMPT + signalsJson }] }],
      config: { responseMimeType: "application/json" } as never,
    });
    const text =
      (res as { text?: string }).text ??
      (res as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
        .candidates?.[0]?.content?.parts?.[0]?.text ??
      "{}";
    return JSON.parse(text.replace(/^```json?\s*|```\s*$/g, "")) as BrandProfile;
  }
}

/* ------------------------------------------------------------------ */
/* Mock fallback (no GEMINI_API_KEY) — solid-color placeholders so the */
/* whole pipeline is testable offline.                                 */
/* ------------------------------------------------------------------ */

class MockProvider implements ImageProvider {
  readonly name = "mock";

  private async solid(width: number, height: number, hex = "#D97757"): Promise<ImageResult> {
    const data = await sharp({
      create: { width, height, channels: 3, background: hex },
    })
      .png()
      .toBuffer();
    return { data, mimeType: "image/png" };
  }

  async generate(input: GenerateInput): Promise<ImageResult> {
    const { width, height } = aspectToSize(input.aspectRatio, "1K");
    const hex = /#(?:[0-9a-fA-F]{3}){1,2}\b/.exec(input.prompt)?.[0] ?? "#D97757";
    return this.solid(width, height, hex);
  }

  async edit(input: EditInput): Promise<ImageResult> {
    const data = await sharp(input.image).negate({ alpha: false }).png().toBuffer();
    return { data, mimeType: "image/png" };
  }

  async resize(input: ResizeInput): Promise<ImageResult> {
    const meta = await sharp(input.image).metadata();
    const { width, height } = aspectToSize(
      input.aspectRatio,
      (meta.width ?? 1024) >= 3000 ? "4K" : "2K",
    );
    const data = await sharp(input.image)
      .resize(width, height, { fit: "cover", position: "attention" })
      .png()
      .toBuffer();
    return { data, mimeType: "image/png" };
  }

  async extractBrandProfile(signalsJson: string): Promise<BrandProfile> {
    let signals: { title?: string; siteName?: string; description?: string; themeColor?: string; colors?: { hex: string }[]; fonts?: string[] } = {};
    try {
      signals = JSON.parse(signalsJson);
    } catch {
      /* ignore */
    }
    const palette = (signals.colors ?? []).slice(0, 4).map((c, i) => ({
      hex: c.hex,
      role: i === 0 ? "primary" : i === 1 ? "secondary" : "accent",
    }));
    if (signals.themeColor) palette.unshift({ hex: signals.themeColor, role: "primary" });
    const seen = new Set<string>();
    const deduped = palette.filter((c) => {
      const k = c.hex.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return {
      name: signals.siteName || signals.title || "Unknown Brand",
      description: signals.description || "No description available.",
      tagline: signals.description?.split(".")[0] || "Make it on-brand.",
      colors: deduped.length ? deduped.slice(0, 5) : [{ hex: "#635bff", role: "primary" }],
      fonts: (signals.fonts ?? []).slice(0, 2).map((name, i) => ({
        name,
        role: i === 0 ? "heading" : "body",
      })),
      tone: "clean, modern, professional",
      styleKeywords: ["minimal", "high-contrast", "geometric"],
      imageryGuidelines:
        "Clean compositions with generous negative space, brand-primary color dominant, soft studio lighting.",
      doNots: ["clutter", "clip-art styling", "off-palette colors"],
    };
  }
}

/* ------------------------------------------------------------------ */

let provider: ImageProvider | undefined;

function selectProvider(): ImageProvider {
  switch (env.imageProvider) {
    case "gemini":
      if (!env.geminiApiKey) throw new Error("IMAGE_PROVIDER=gemini but GEMINI_API_KEY is empty");
      return new GeminiProvider(env.geminiApiKey);
    case "openai": {
      const p = maybeOpenAIProvider();
      if (!p) throw new Error("IMAGE_PROVIDER=openai but OPENAI_API_KEY is empty");
      return p;
    }
    case "openrouter": {
      const p = maybeOpenRouterProvider();
      if (!p) throw new Error("IMAGE_PROVIDER=openrouter but OPENROUTER_API_KEY is empty");
      return p;
    }
    case "mock":
      return new MockProvider();
    default: // auto
      if (env.geminiApiKey) return new GeminiProvider(env.geminiApiKey);
      return maybeOpenAIProvider() ?? new MockProvider();
  }
}

export function getImageProvider(): ImageProvider {
  if (!provider) {
    provider = selectProvider();
    console.log(`[brandlayer] image provider: ${provider.name}`);
  }
  return provider;
}
