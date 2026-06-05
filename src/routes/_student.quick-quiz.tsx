import { createFileRoute } from "@tanstack/react-router";
import { QuickQuizFlow } from "@/components/dashboard/QuickQuizFlow";

export const Route = createFileRoute("/_student/quick-quiz")({
  component: QuickQuizPage,
  head: () => ({
    meta: [
      { title: "Quick Quiz · CA Aspire BD" },
      {
        name: "description",
        content:
          "Generate a chapter-based 10-question, 10-minute quiz. Admin-reviewed for quality before you start.",
      },
    ],
  }),
});

function QuickQuizPage() {
  return <QuickQuizFlow />;
}
