import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractKey, resolveUserId } from "../lib/auth.js";
import { ApiError } from "../lib/errors.js";
import * as brandService from "../services/brands.js";
import * as imageService from "../services/images.js";

/**
 * MCP endpoint: POST /api/mcp (Streamable HTTP, stateless — one transport per request).
 * Auth: Authorization: Bearer <api key>. OAuth/PKCE parity is a TODO.
 * Tools are thin wrappers over the same src/services/ functions REST uses.
 */

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: "brandlayer", version: "0.1.0" });

  server.tool(
    "bloom_onboard_brand",
    "Onboard a brand from a website URL. Returns a brand session ID; analysis runs async — poll bloom_get_brand until status is 'ready'.",
    { url: z.string().describe("The brand's website URL, e.g. https://stripe.com") },
    async ({ url }) => text(await brandService.createBrand(userId, url)),
  );

  server.tool(
    "bloom_get_brand",
    "Get a brand session, including the extracted brand profile (palette, fonts, tone, style) once status is 'ready'.",
    { brandSessionId: z.string() },
    async ({ brandSessionId }) => text(await brandService.getBrand(userId, brandSessionId)),
  );

  server.tool(
    "bloom_list_brands",
    "List all onboarded brand sessions for this account.",
    {},
    async () => text(await brandService.listBrands(userId)),
  );

  server.tool(
    "bloom_update_brand",
    "Update a brand's profile (seamless brand updates) — e.g. tweak palette, tone, or imagery guidelines. Changes apply to every future generation.",
    {
      brandSessionId: z.string(),
      name: z.string().optional(),
      profile: z
        .object({
          description: z.string().optional(),
          tagline: z.string().optional(),
          tone: z.string().optional(),
          imageryGuidelines: z.string().optional(),
          styleKeywords: z.array(z.string()).optional(),
          colors: z.array(z.object({ hex: z.string(), role: z.string().optional() })).optional(),
          fonts: z.array(z.object({ name: z.string(), role: z.string().optional() })).optional(),
          doNots: z.array(z.string()).optional(),
        })
        .optional(),
    },
    async ({ brandSessionId, name, profile }) =>
      text(await brandService.updateBrand(userId, brandSessionId, { name, profile })),
  );

  server.tool(
    "bloom_search_images",
    "Search the image library in plain English (matches against generation prompts). Returns matching images with URLs.",
    {
      query: z.string().describe("e.g. 'spring launch hero'"),
      brandSessionId: z.string().optional(),
    },
    async ({ query, brandSessionId }) =>
      text(await imageService.listImages(userId, { q: query, brandSessionId, limit: 20 })),
  );

  server.tool(
    "bloom_generate_image",
    "Generate an on-brand image. The brand profile is injected automatically — keep the prompt short (e.g. 'Hero image for a spring launch'). Returns pending image IDs; poll bloom_get_image with wait=true.",
    {
      brandSessionId: z.string().optional().describe("Brand session to stay on-brand. Omit for unbranded generation."),
      prompt: z.string(),
      aspectRatio: z.string().optional().describe("e.g. 1:1, 16:9, 9:16. Default 1:1"),
      resolution: z.enum(["1K", "2K", "4K"]).optional(),
      variants: z.number().int().min(1).max(4).optional(),
    },
    async (args) =>
      text(
        await imageService.createGeneration(userId, {
          brandSessionId: args.brandSessionId,
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          resolution: args.resolution,
          variants: args.variants,
        }),
      ),
  );

  server.tool(
    "bloom_edit_image",
    "Edit an existing completed image with a natural-language instruction. Returns a new pending image ID.",
    { imageId: z.string(), prompt: z.string() },
    async ({ imageId, prompt }) => text(await imageService.editImage(userId, imageId, prompt)),
  );

  server.tool(
    "bloom_resize_image",
    "Resize/recompose a completed image to a new aspect ratio (generative outpaint, not a crop). Returns a new pending image ID.",
    { imageId: z.string(), aspectRatio: z.string().describe("e.g. 16:9") },
    async ({ imageId, aspectRatio }) => text(await imageService.resizeImage(userId, imageId, aspectRatio)),
  );

  server.tool(
    "bloom_get_image",
    "Get an image's status and URL. Set wait=true to long-poll until it completes (up to 55s).",
    { imageId: z.string(), wait: z.boolean().optional() },
    async ({ imageId, wait }) => text(await imageService.getImage(userId, imageId, wait ?? false)),
  );

  server.tool(
    "bloom_upload_image",
    "Import an image from a URL into the library (e.g. to use as a reference or edit source).",
    { url: z.string(), brandSessionId: z.string().optional() },
    async ({ url, brandSessionId }) => text(await imageService.uploadFromUrl(userId, url, brandSessionId)),
  );

  return server;
}

export async function registerMcp(app: FastifyInstance): Promise<void> {
  app.post("/api/mcp", async (req, reply) => {
    let userId: string;
    try {
      userId = await resolveUserId(extractKey(req.headers as Record<string, unknown>));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 401;
      return reply.status(status).send({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: pass the API key as 'Authorization: Bearer <key>'." },
        id: null,
      });
    }

    const server = buildServer(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  /* Stateless server: GET/DELETE (SSE resume / session teardown) not supported. */
  const methodNotAllowed = async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. POST only (stateless mode)." },
      id: null,
    });
  app.get("/api/mcp", methodNotAllowed);
  app.delete("/api/mcp", methodNotAllowed);
}
