-- ============================================================
-- Crear tablas de Metas de Ahorro en Supabase
-- ============================================================
-- 1. Entrá a https://supabase.com/dashboard y abrí tu proyecto.
-- 2. En el menú izquierdo: SQL Editor > New query.
-- 3. Pegá todo este archivo y hacé clic en Run (o Cmd+Enter).
-- 4. Deberías ver "Success". Después recargá la app.
-- ============================================================

-- Tabla principal de metas de ahorro
CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deadline DATE NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Aportes a cada meta (manuales o por retención)
CREATE TABLE IF NOT EXISTS public.savings_goal_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL, -- 'manual' | 'retention'
  movement_id BIGINT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_savings_goal_contributions_goal_id
  ON public.savings_goal_contributions (goal_id);

ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goal_contributions ENABLE ROW LEVEL SECURITY;

-- Quitar políticas viejas si existen (para poder re-ejecutar el script)
DROP POLICY IF EXISTS "Allow read savings_goals" ON public.savings_goals;
DROP POLICY IF EXISTS "Allow insert savings_goals" ON public.savings_goals;
DROP POLICY IF EXISTS "Allow update savings_goals" ON public.savings_goals;
DROP POLICY IF EXISTS "Allow delete savings_goals" ON public.savings_goals;

DROP POLICY IF EXISTS "Allow read savings_goal_contributions" ON public.savings_goal_contributions;
DROP POLICY IF EXISTS "Allow insert savings_goal_contributions" ON public.savings_goal_contributions;
DROP POLICY IF EXISTS "Allow update savings_goal_contributions" ON public.savings_goal_contributions;
DROP POLICY IF EXISTS "Allow delete savings_goal_contributions" ON public.savings_goal_contributions;

-- Políticas abiertas (igual estilo que salary_entries)
CREATE POLICY "Allow read savings_goals"
  ON public.savings_goals FOR SELECT TO anon USING (true);

CREATE POLICY "Allow insert savings_goals"
  ON public.savings_goals FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow update savings_goals"
  ON public.savings_goals FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow delete savings_goals"
  ON public.savings_goals FOR DELETE TO anon USING (true);

CREATE POLICY "Allow read savings_goal_contributions"
  ON public.savings_goal_contributions FOR SELECT TO anon USING (true);

CREATE POLICY "Allow insert savings_goal_contributions"
  ON public.savings_goal_contributions FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow update savings_goal_contributions"
  ON public.savings_goal_contributions FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow delete savings_goal_contributions"
  ON public.savings_goal_contributions FOR DELETE TO anon USING (true);

