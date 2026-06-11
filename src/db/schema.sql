CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  credits INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,        -- sha256 hex of the raw key
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'analyzing',  -- analyzing | ready | failed
  profile JSONB,                             -- the "visual DNA": palette, fonts, tone, style rules
  logo_path TEXT,                            -- TODO: PUT /brands/{id}/logo
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'generation',   -- generation | edit | resize | background-removal | vectorize | upload
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | processing | completed | failed
  prompt TEXT,
  aspect_ratio TEXT,
  resolution TEXT NOT NULL DEFAULT '2K',     -- 1K | 2K | 4K
  parent_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  storage_path TEXT,
  mime_type TEXT,
  error TEXT,
  embedding TEXT,                            -- stub: swap for pgvector vector(512) + CLIP
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brands_user ON brands(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,                   -- negative = deduction
  reason TEXT NOT NULL,
  image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent column additions (run safely on existing databases)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo_image_id UUID REFERENCES images(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;

-- Dev seed: DEV_API_KEY in .env maps requests to this user (see src/lib/auth.ts)
INSERT INTO users (id, email, credits)
VALUES ('00000000-0000-0000-0000-000000000001', 'dev@local', 1000)
ON CONFLICT (id) DO NOTHING;
