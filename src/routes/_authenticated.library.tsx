import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects } from "@/lib/manga.functions";
import { Button } from "@/components/ui/button";
import { Film, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Library — Inkframe" }] }),
  component: Library,
});

function Library() {
  const listFn = useServerFn(listProjects);
  const { data } = useSuspenseQuery({
    queryKey: ["projects"],
    queryFn: () => listFn(),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl tracking-wide">YOUR LIBRARY</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Every manga you've turned into anime.
          </p>
        </div>
        <Link to="/">
          <Button>
            <Plus className="h-4 w-4 mr-2" /> New project
          </Button>
        </Link>
      </div>

      {data.projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Film className="mx-auto h-10 w-10 text-primary mb-4" />
          <p className="font-display text-2xl mb-2 tracking-wide">NO PROJECTS YET</p>
          <p className="text-sm text-muted-foreground mb-6">
            Upload your first manga PDF to get started.
          </p>
          <Link to="/">
            <Button>Upload a PDF</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Link
              key={p.id}
              to="/project/$id"
              params={{ id: p.id }}
              className="group rounded-lg border border-border bg-card p-6 transition hover:border-primary hover:shadow-lg hover:shadow-primary/10"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-widest text-primary">
                  {p.status}
                </span>
                <span className="text-xs text-muted-foreground">{p.page_count} pages</span>
              </div>
              <h3 className="font-display text-2xl tracking-wide group-hover:text-primary transition">
                {p.title}
              </h3>
              <p className="text-xs text-muted-foreground mt-3">
                {new Date(p.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}