UPDATE public.subjects SET level = '' WHERE level IS NULL;
ALTER TABLE public.subjects ALTER COLUMN level SET DEFAULT '';
ALTER TABLE public.subjects ALTER COLUMN level SET NOT NULL;

UPDATE public.quizzes SET level = '' WHERE level IS NULL;
ALTER TABLE public.quizzes ALTER COLUMN level SET DEFAULT '';
ALTER TABLE public.quizzes ALTER COLUMN level SET NOT NULL;

UPDATE public.exam_attempts SET kind = 'mcq_practice' WHERE kind IS NULL;
ALTER TABLE public.exam_attempts ALTER COLUMN kind SET DEFAULT 'mcq_practice';
ALTER TABLE public.exam_attempts ALTER COLUMN kind SET NOT NULL;