/** The "visual DNA" extracted from a brand's website. Stored as JSONB on brands.profile. */
export interface BrandProfile {
  name: string;
  description?: string;
  tagline?: string;
  colors: { hex: string; role?: string }[];
  fonts?: { name: string; role?: string }[];
  tone?: string;
  styleKeywords?: string[];
  imageryGuidelines?: string;
  doNots?: string[];
}

export type Resolution = "1K" | "2K" | "4K";

export interface GenerateInput {
  prompt: string;
  aspectRatio?: string; // e.g. "1:1", "16:9", "9:16", "4:3", "3:4"
  resolution?: Resolution;
  referenceImages?: { data: Buffer; mimeType: string }[];
}

export interface EditInput {
  image: Buffer;
  mimeType: string;
  prompt: string;
}

export interface ResizeInput {
  image: Buffer;
  mimeType: string;
  aspectRatio: string;
}

export interface ImageResult {
  data: Buffer;
  mimeType: string;
}

/**
 * Swappable provider interface. src/providers/gemini.ts is the default.
 * To map Bloom's fast/standard/pro tiers, implement this with different models
 * (e.g. FLUX schnell / Gemini Flash Image / FLUX pro) and select by tier.
 */
export interface ImageProvider {
  readonly name: string;
  generate(input: GenerateInput): Promise<ImageResult>;
  edit(input: EditInput): Promise<ImageResult>;
  resize(input: ResizeInput): Promise<ImageResult>;
  /** LLM pass: distill scraped site signals into a BrandProfile. */
  extractBrandProfile(signalsJson: string): Promise<BrandProfile>;
}
