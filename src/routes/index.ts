import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyError, FastifyInstance } from "fastify";
import { env } from "../lib/env.js";
import { authenticate } from "../lib/auth.js";
import { ApiError, Errors } from "../lib/errors.js";
import * as accountService from "../services/account.js";
import * as brandService from "../services/brands.js";
import * as imageService from "../services/images.js";

const ok = <T>(data: T) => ({ data });

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  /* Bloom-style error envelope for everything. */
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send(err.toBody());
    }
    const fastifyErr = err as FastifyError;
    if (fastifyErr.validation) {
      const e = Errors.validation(fastifyErr.message);
      return reply.status(e.status).send(e.toBody());
    }
    app.log.error(err);
    const e = Errors.internal(fastifyErr.message ?? "Internal server error.");
    return reply.status(e.status).send(e.toBody());
  });

  /* ---- Marketing site + app shell ---- */
  const sendFile = async (reply: { type: (t: string) => { send: (b: unknown) => unknown } }, rel: string, mime: string) => {
    const body = await readFile(path.resolve(process.cwd(), rel), "utf8");
    return reply.type(mime).send(body);
  };
  app.get("/", async (_req, reply) => sendFile(reply, "public/site/home.html", "text/html"));
  app.get("/brands", async (_req, reply) => sendFile(reply, "public/site/brands.html", "text/html"));
  app.get("/pricing", async (_req, reply) => sendFile(reply, "public/site/pricing.html", "text/html"));
  app.get("/docs", async (_req, reply) => sendFile(reply, "public/site/docs.html", "text/html"));
  app.get("/login", async (_req, reply) => sendFile(reply, "public/site/login.html", "text/html"));
  app.get("/site/site.css", async (_req, reply) => sendFile(reply, "public/site/site.css", "text/css"));
  app.get("/app", async (_req, reply) => sendFile(reply, "public/index.html", "text/html"));

  /* Public client config (which auth mode is active). */
  app.get("/api/config", async () => ({
    clerkPublishableKey: env.clerkPublishableKey || null,
    product: "Crowd",
  }));

  /* ---- Developer sharing: docs, spec, agent skill (no auth) ---- */
  app.get("/docs/llms.txt", async (_req, reply) => {
    return reply.type("text/plain").send(
      [
        "# BrandLayer — the brand layer for agents",
        "",
        "Onboard a brand from a URL, then generate/edit/resize on-brand images.",
        "",
        "## Auth",
        "REST: header `x-api-key: <key>`. MCP: `Authorization: Bearer <key>`.",
        "",
        "## REST (base /api/v1)",
        "POST /brands {url} -> 202 {id,status:'analyzing'}; poll GET /brands/{id} until status 'ready'",
        "GET /brands | GET /brands/{id} | PATCH /brands/{id} {name?,profile?}",
        "POST /images/generations {brandSessionId,prompt,aspectRatio?,resolution?,variants?,referenceImageIds?} -> 202 {ids}",
        "POST /images/{id}/edit {prompt} | /resize {aspectRatio} | /background-removal | /vectorize -> 202 {id}",
        "POST /images/uploads {url,brandSessionId?} -> 202 {id}",
        "GET /images?brandSessionId&status&q&limit | GET /images/{id}?wait=true (55s long-poll)",
        "GET /account | GET /account/credits",
        "Errors: {defined,code,status,message,data}. Credits: 2K=1, 4K=2, per variant.",
        "",
        "## MCP",
        "POST /api/mcp (Streamable HTTP). Tools: bloom_onboard_brand, bloom_get_brand,",
        "bloom_list_brands, bloom_update_brand, bloom_generate_image, bloom_edit_image,",
        "bloom_resize_image, bloom_get_image, bloom_search_images, bloom_upload_image.",
        "",
        "## Agent skill",
        "GET /skills/brandlayer.skill (zip for Claude skills) · source at GET /skills/brandlayer/SKILL.md",
        "## OpenAPI",
        "GET /api/v1/spec.json",
      ].join("\n"),
    );
  });

  app.get("/api/v1/spec.json", async (_req, reply) => {
    const spec = await readFile(path.resolve(process.cwd(), "public/spec.json"), "utf8").catch(() => "{}");
    return reply.type("application/json").send(spec);
  });

  app.get("/skills/brandlayer.skill", async (_req, reply) => {
    const file = path.resolve(process.cwd(), "public/brandlayer.skill");
    return reply
      .type("application/zip")
      .header("content-disposition", 'attachment; filename="brandlayer.skill"')
      .send(createReadStream(file));
  });

  app.get<{ Params: { "*": string } }>("/skills/brandlayer/*", async (req, reply) => {
    const rel = req.params["*"].replace(/\.\./g, "");
    const file = path.resolve(process.cwd(), "skills/brandlayer", rel);
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) return reply.status(404).send({ message: "Not found" });
    return reply.type("text/markdown").send(text);
  });

  /* Public image serving (no auth). */
  app.get<{ Params: { id: string } }>("/img/:id", async (req, reply) => {
    const file = await imageService.getImageFile(req.params.id);
    if (!file) return reply.status(404).send({ defined: true, code: "IMAGE_NOT_FOUND", status: 404, message: "Not found", data: {} });
    return reply.type(file.mimeType).send(createReadStream(file.storagePath));
  });

  app.get("/healthz", async () => ({ ok: true }));

  /* Authenticated API. */
  app.register(async (api) => {
    api.addHook("preHandler", authenticate);

    /* ---- Brands ---- */
    api.post<{ Body: { url?: string } }>("/brands", async (req, reply) => {
      if (!req.body?.url) throw Errors.validation("url is required.");
      const brand = await brandService.createBrand(req.userId, req.body.url);
      return reply.status(202).send(ok(brand));
    });

    api.get("/brands", async (req) => ok(await brandService.listBrands(req.userId)));

    api.get<{ Params: { id: string } }>("/brands/:id", async (req) =>
      ok(await brandService.getBrand(req.userId, req.params.id)),
    );

    api.patch<{ Params: { id: string }; Body: { name?: string; profile?: Record<string, unknown> } }>(
      "/brands/:id",
      async (req) =>
        ok(await brandService.updateBrand(req.userId, req.params.id, {
          name: req.body?.name,
          profile: req.body?.profile,
        })),
    );

    /* TODO: PUT /brands/:id/logo (file + URL variants, @fastify/multipart) */

    /* ---- Image generation ---- */
    api.post<{
      Body: {
        brandSessionId?: string;
        prompt?: string;
        aspectRatio?: string;
        resolution?: string;
        variants?: number;
        referenceImageIds?: string[];
      };
    }>("/images/generations", async (req, reply) => {
      const result = await imageService.createGeneration(req.userId, {
        brandSessionId: req.body?.brandSessionId,
        prompt: req.body?.prompt ?? "",
        aspectRatio: req.body?.aspectRatio,
        resolution: req.body?.resolution,
        variants: req.body?.variants,
        referenceImageIds: req.body?.referenceImageIds,
      });
      return reply.status(202).send(ok(result));
    });

    /* ---- Derived operations ---- */
    api.post<{ Params: { id: string }; Body: { prompt?: string } }>(
      "/images/:id/edit",
      async (req, reply) => {
        const result = await imageService.editImage(req.userId, req.params.id, req.body?.prompt ?? "");
        return reply.status(202).send(ok(result));
      },
    );

    api.post<{ Params: { id: string }; Body: { aspectRatio?: string } }>(
      "/images/:id/resize",
      async (req, reply) => {
        const result = await imageService.resizeImage(req.userId, req.params.id, req.body?.aspectRatio ?? "");
        return reply.status(202).send(ok(result));
      },
    );

    api.post<{ Params: { id: string } }>("/images/:id/background-removal", async (req, reply) => {
      const result = await imageService.removeBackground(req.userId, req.params.id);
      return reply.status(202).send(ok(result));
    });

    api.post<{ Params: { id: string } }>("/images/:id/vectorize", async (req, reply) => {
      const result = await imageService.vectorizeImage(req.userId, req.params.id);
      return reply.status(202).send(ok(result));
    });

    /* ---- Uploads (URL). Multipart file upload: TODO ---- */
    api.post<{ Body: { url?: string; brandSessionId?: string } }>(
      "/images/uploads",
      async (req, reply) => {
        if (!req.body?.url) throw Errors.validation("url is required (multipart file upload not yet implemented).");
        const result = await imageService.uploadFromUrl(req.userId, req.body.url, req.body.brandSessionId);
        return reply.status(202).send(ok(result));
      },
    );

    /* ---- Reads ---- */
    api.get<{
      Querystring: { brandSessionId?: string; status?: string; limit?: string; q?: string };
    }>("/images", async (req) =>
      ok(
        await imageService.listImages(req.userId, {
          brandSessionId: req.query.brandSessionId,
          status: req.query.status,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          q: req.query.q,
        }),
      ),
    );

    api.get<{ Params: { id: string }; Querystring: { wait?: string } }>(
      "/images/:id",
      async (req) =>
        ok(await imageService.getImage(req.userId, req.params.id, req.query.wait === "true")),
    );

    /* ---- Account ---- */
    api.get("/account", async (req) => ok(await accountService.getAccount(req.userId)));
    api.get("/account/credits", async (req) => ok(await accountService.getCredits(req.userId)));
  }, { prefix: "/api/v1" });
}
