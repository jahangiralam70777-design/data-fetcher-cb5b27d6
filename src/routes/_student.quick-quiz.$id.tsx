import { createFileRoute } from "@tanstack/react-router";
import { QuickQuizSession } from "@/components/dashboard/QuickQuizSession";

export const Route = createFileRoute("/_student/quick-quiz/$id")({
  component: QuickQuizSessionPage,
  head: () => ({ meta: [{ title: "Quick Quiz · Session" }] }),
});

function QuickQuizSessionPage() {
  const { id } = Route.useParams();
  return <QuickQuizSession id={id} />;
}
