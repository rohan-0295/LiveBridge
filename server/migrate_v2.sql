-- ============================================================
-- LiveBridge DB Migration — v2
-- Run this against your existing database to support JWT auth
-- ============================================================

-- 1. Add password_hash column to users (nullable so existing rows don't break)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Add updated_at to medical_vaults if not already there
ALTER TABLE medical_vaults
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Ensure unique constraint on user_id in medical_vaults
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medical_vaults_user_id_key'
  ) THEN
    ALTER TABLE medical_vaults ADD CONSTRAINT medical_vaults_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 4. Create index on emergencies.user_id for vault lookups
CREATE INDEX IF NOT EXISTS idx_emergencies_user_id ON emergencies(user_id);

-- Done!
SELECT 'Migration v2 complete ✅' AS status;
