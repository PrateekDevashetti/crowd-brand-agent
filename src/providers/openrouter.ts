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

const API = "https://openrouter.ai/api/v1";
// Image-output model on OpenRouter (billed to OpenRouter credits, bypasses the
// Gemini free-tier quota). Override with OPENROUTER_IMAGE_MODEL.
const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-2.5-flash-image";
const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL ?? "openai/gpt-4o-mini";

function dataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * OpenRouter provider. Images come back through the chat-completions API with
 * `modalities: ["image","text"]` (message.images[].image_url.url is a data URL),
 * which is why this is a separate provider from the OpenAI /images one.
 */
export class OpenRouterProvider implements ImageProvider {
  readonly name = "openrouter";

  constructor(private apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
      "HTTP-Referer": env.baseUrl,
      "X-Title": "Canopy Brand Agent",
    };
  }

  private async imageFromChat(content: unknown, context: string): Promise<ImageResult> {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: IMAGE_MODEL,
        modalities: ["image", "text"],
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text();
      let message = body.slice(0, 300);
      try { message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message; } catch { /* keep raw */ }
      throw new Error(`OpenRouter ${context} failed (HTTP ${res.status}): ${message}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    };
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const m = url?.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) throw new Error(`OpenRouter ${context} returned no image data`);
    return { data: Buffer.from(m[2], "base64"), mimeType: m[1] };
  }

  async generate(input: GenerateInput): Promise<ImageResult> {
    const text = `${input.prompt}${input.aspectRatio ? ` — aspect ratio ${input.aspectRatio}` : ""}${input.resolution ? `, ${input.resolution}` : ""}`;
    const content: unknown[] = [{ type: "text", text }];
    for (const ref of input.referenceImages ?? []) {
      content.push({ type: "image_url", image_url: { url: dataUrl(ref.data, ref.mimeType) } });
    }
    return this.imageFromChat(content, "generation");
  }

  async edit(input: EditInput): Promise<ImageResult> {
    return this.imageFromChat(
      [
        { type: "text", text: `${input.prompt}. Preserve everything not mentioned in the edit instruction.` },
        { type: "image_url", image_url: { url: dataUrl(input.image, input.mimeType) } },
      ],
      "edit",
    );
  }

  async resize(input: ResizeInput): Promise<ImageResult> {
    return this.imageFromChat(
      [
        { type: "text", text: `Recompose this exact image to a ${input.aspectRatio} aspect ratio. Extend backgrounds naturally (outpaint) instead of stretching or cropping the subject. Keep all colors, style, and subject identical.` },
        { type: "image_url", image_url: { url: dataUrl(input.image, input.mimeType) } },
      ],
      "resize",
    );
  }

  async extractBrandProfile(signalsJson: string): Promise<BrandProfile> {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: TEXT_MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: BRAND_EXTRACTION_PROMPT + signalsJson }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter brand extraction failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as BrandProfile;
  }
}

export function maybeOpenRouterProvider(): ImageProvider | undefined {
  return env.openrouterApiKey ? new OpenRouterProvider(env.openrouterApiKey) : undefined;
}
