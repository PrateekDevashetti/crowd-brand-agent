import { env } from "../lib/env.js";
import { BRAND_EXTRACTION_PROMPT } from "./brandExtractor.js";
import type {
  BrandProfile,
  EditInput,
  GenerateInput,
  ImageProvider,
  ImageResult,
  ResizeInput,
} from "./imageProvider.js";

const API = "https://api.openai.com/v1";
/**
 * gpt-image-1 deprecates 2026-10-23. Current lineup: gpt-image-2 (flagship),
 * gpt-image-1.5, gpt-image-1-mini (cheapest). Default to mini for low-cost
 * testing; set OPENAI_IMAGE_MODEL=gpt-image-2 for production quality.
 */
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1-mini";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-4o-mini";

/**
 * gpt-image-1 supports exactly three sizes. Map any requested aspect ratio
 * to the nearest one (landscape → 1536x1024, portrait → 1024x1536, else square).
 * 4K is not available; resolution is effectively capped at these sizes.
 */
function nearestSize(aspectRatio = "1:1"): "1024x1024" | "1536x1024" | "1024x1536" {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h || w === h) return "1024x1024";
  return w > h ? "1536x1024" : "1024x1536";
}

export class OpenAIProvider implements ImageProvider {
  readonly name = "openai/gpt-image-1";

  constructor(private apiKey: string) {}

  private async parseImageResponse(res: Response, context: string): Promise<ImageResult> {
    if (!res.ok) {
      const body = await res.text();
      let message = body.slice(0, 300);
      try {
        message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        /* keep raw slice */
      }
      throw new Error(`OpenAI ${context} failed (HTTP ${res.status}): ${message}`);
    }
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error(`OpenAI ${context} returned no image data`);
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }

  async generate(input: GenerateInput): Promise<ImageResult> {
    // Note: gpt-image-1 has no reference-image support on /generations.
    // If reference images are provided, fall through to /edits with the first one.
    if (input.referenceImages?.length) {
      return this.editWithImages(
        input.referenceImages,
        `Using the attached image(s) as style/content reference: ${input.prompt}`,
        nearestSize(input.aspectRatio),
      );
    }
    const res = await fetch(`${API}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: input.prompt,
        size: nearestSize(input.aspectRatio),
        quality: input.resolution === "4K" ? "high" : "medium",
        n: 1,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    return this.parseImageResponse(res, "generation");
  }

  private async editWithImages(
    images: { data: Buffer; mimeType: string }[],
    prompt: string,
    size: string,
  ): Promise<ImageResult> {
    const form = new FormData();
    form.append("model", IMAGE_MODEL);
    form.append("prompt", prompt);
    form.append("size", size);
    for (const [i, img] of images.entries()) {
      form.append(
        "image[]",
        new Blob([new Uint8Array(img.data)], { type: img.mimeType }),
        `image-${i}.png`,
      );
    }
    const res = await fetch(`${API}/images/edits`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    return this.parseImageResponse(res, "edit");
  }

  async edit(input: EditInput): Promise<ImageResult> {
    return this.editWithImages(
      [{ data: input.image, mimeType: input.mimeType }],
      `${input.prompt}. Preserve everything not mentioned in the edit instruction.`,
      "1024x1024",
    );
  }

  async resize(input: ResizeInput): Promise<ImageResult> {
    // Generative recompose to the nearest supported size for the target ratio.
    return this.editWithImages(
      [{ data: input.image, mimeType: input.mimeType }],
      `Recompose this exact image to a ${input.aspectRatio} aspect ratio. Extend backgrounds naturally (outpaint) instead of stretching or cropping the subject. Keep all colors, style, and subject identical.`,
      nearestSize(input.aspectRatio),
    );
  }

  async extractBrandProfile(signalsJson: string): Promise<BrandProfile> {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: BRAND_EXTRACTION_PROMPT + signalsJson }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`OpenAI brand extraction failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as BrandProfile;
  }
}

export function maybeOpenAIProvider(): ImageProvider | undefined {
  return env.openaiApiKey ? new OpenAIProvider(env.openaiApiKey) : undefined;
}
