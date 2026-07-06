import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProject } from "@/lib/manga.functions";
import { MangaPlayer } from "@/components/manga-player";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/project/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Project ${params.id.slice(0, 6)} — Inkframe` }],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getProject);
  const { data } = useSuspenseQuery({
    queryKey: ["project", id],
    queryFn: () => getFn({ data: { projectId: id } }),
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 backdrop-blur-md bg-background/60 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="font-display text-2xl tracking-widest text-primary">
            INKFRAME
          </Link>
          <Link to="/library">
            <Button size="sm" variant="ghost">
              <ArrowLeft className="h-4 w-4 mr-2" /> Library
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="font-display text-4xl md:text-5xl tracking-wide mb-2">
          {data.project.title.toUpperCase()}
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          {data.pages.length} pages · press Play to watch, or Export video to download.
        </p>

        {data.pages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
            No pages yet. Try uploading again.
          </div>
        ) : (
          <MangaPlayer pages={data.pages} title={data.project.title} />
        )}

        <details className="mt-10 rounded-lg border border-border bg-card/60 p-6">
          <summary className="cursor-pointer font-display text-xl tracking-wide">
            SCRIPT
          </summary>
          <ol className="mt-6 space-y-4 list-decimal list-inside">
            {data.pages.map((p) => (
              <li key={p.pageNumber} className="text-sm leading-relaxed">
                <span className="text-primary font-medium">Page {p.pageNumber}.</span>{" "}
                {p.narration}
              </li>
            ))}
          </ol>
        </details>
      </main>
    </div>
  );
}