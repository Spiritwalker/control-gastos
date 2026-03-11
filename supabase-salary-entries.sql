-- ============================================================
-- Crear tabla salary_entries en Supabase
-- ============================================================
-- 1. Entrá a https://supabase.com/dashboard y abrí tu proyecto.
-- 2. En el menú izquierdo: SQL Editor > New query.
-- 3. Pegá todo este archivo y hacé clic en Run (o Cmd+Enter).
-- 4. Deberías ver "Success". Después recargá la app.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.salary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  hours NUMERIC(10,2) NOT NULL CHECK (hours > 0),
  hourly_rate NUMERIC(10,2) NOT NULL CHECK (hourly_rate >= 0),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_entries_year_month ON public.salary_entries (year, month);

ALTER TABLE public.salary_entries ENABLE ROW LEVEL SECURITY;

-- Quitar políticas viejas si existen (para poder re-ejecutar el script)
DROP POLICY IF EXISTS "Allow read salary_entries" ON public.salary_entries;
DROP POLICY IF EXISTS "Allow insert salary_entries" ON public.salary_entries;
DROP POLICY IF EXISTS "Allow update salary_entries" ON public.salary_entries;
DROP POLICY IF EXISTS "Allow delete salary_entries" ON public.salary_entries;

CREATE POLICY "Allow read salary_entries"
  ON public.salary_entries FOR SELECT TO anon USING (true);

CREATE POLICY "Allow insert salary_entries"
  ON public.salary_entries FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow update salary_entries"
  ON public.salary_entries FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow delete salary_entries"
  ON public.salary_entries FOR DELETE TO anon USING (true);
