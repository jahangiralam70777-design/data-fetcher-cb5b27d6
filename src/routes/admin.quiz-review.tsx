import { createFileRoute } from "@tanstack/react-router";
import { QuizReviewQueueFlow } from "@/components/admin/QuizReviewQueueFlow";

export const Route = createFileRoute("/admin/quiz-review")({
  component: () => <QuizReviewQueueFlow />,
  head: () => ({ meta: [{ title: "Quiz Review Queue · Admin" }] }),
});
