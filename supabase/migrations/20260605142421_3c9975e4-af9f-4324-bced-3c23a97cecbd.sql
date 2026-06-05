-- Add 'student' to app_role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'student';

-- profiles: add status + referral_source
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','pending')),
  ADD COLUMN IF NOT EXISTS referral_source text;

-- notifications: open_count
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;

-- mcq_bookmarks: switch composite PK to (id PK + unique (user_id, mcq_id))
ALTER TABLE public.mcq_bookmarks DROP CONSTRAINT IF EXISTS mcq_bookmarks_pkey;
ALTER TABLE public.mcq_bookmarks
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.mcq_bookmarks ADD PRIMARY KEY (id);
DO $$ BEGIN
  ALTER TABLE public.mcq_bookmarks ADD CONSTRAINT mcq_bookmarks_user_mcq_key UNIQUE (user_id, mcq_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- mcq_wrong_questions: same shape
ALTER TABLE public.mcq_wrong_questions DROP CONSTRAINT IF EXISTS mcq_wrong_questions_pkey;
ALTER TABLE public.mcq_wrong_questions
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.mcq_wrong_questions ADD PRIMARY KEY (id);
DO $$ BEGIN
  ALTER TABLE public.mcq_wrong_questions ADD CONSTRAINT mcq_wrong_questions_user_mcq_key UNIQUE (user_id, mcq_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- Relax NOT NULLs that the app code does not always provide
ALTER TABLE public.subjects ALTER COLUMN level DROP NOT NULL;
ALTER TABLE public.quizzes ALTER COLUMN level DROP NOT NULL;
ALTER TABLE public.exam_attempts ALTER COLUMN kind DROP NOT NULL;