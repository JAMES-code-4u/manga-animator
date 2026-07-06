import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { renderPdfPages } from "@/lib/pdf-render";
import { createProject, processPage, finalizeProject } from "@/lib/manga.functions";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Sparkles, Wand2, Film, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const [authed, setAuthed] = useState(false);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);

  const createProjectFn = useServerFn(createProject);
  const processPageFn = useServerFn(processPage);
  const finalizeFn = useServerFn(finalizeProject);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleFile = async (file: File) => {
    if (!authed) {
      toast.info("Sign in to start a project.");
      navigate({ to: "/auth" });
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF.");
      return;
    }
    setProcessing(true);
    try {
      setProgress({ step: "Rasterizing pages…", pct: 0 });
      const rendered = await renderPdfPages(file, {
        targetWidth: 1024,
        maxPages: 20,
        onPage: (_p, total) =>
          setProgress({ step: `Rasterizing pages… ${_p.pageNumber}/${total}`, pct: (_p.pageNumber / total) * 20 }),
      });

      if (!rendered.length) throw new Error("PDF had no readable pages.");

      const title = file.name.replace(/\.pdf$/i, "").slice(0, 80) || "Untitled";
      setProgress({ step: "Creating project…", pct: 22 });
      const { projectId } = await createProjectFn({
        data: { title, pageCount: rendered.length },
      });

      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session!.user.id;

      for (let i = 0; i < rendered.length; i++) {
        const page = rendered[i];
        const path = `${userId}/${projectId}/page-${String(page.pageNumber).padStart(4, "0")}.jpg`;
        setProgress({
          step: `Uploading & narrating page ${page.pageNumber}/${rendered.length}…`,
          pct: 25 + ((i + 1) / rendered.length) * 70,
        });
        const { error: upErr } = await supabase.storage
          .from("manga")
          .upload(path, page.blob, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw new Error(upErr.message);

        await processPageFn({
          data: {
            projectId,
            pageNumber: page.pageNumber,
            imagePath: path,
            imageDataUrl: page.dataUrl,
          },
        });
      }

      await finalizeFn({ data: { projectId } });
      setProgress({ step: "Done!", pct: 100 });
      toast.success("Your anime is ready.");
      navigate({ to: "/project/$id", params: { id: projectId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-6">
        <div className="font-display text-3xl tracking-widest text-primary">INKFRAME</div>
        <div className="flex items-center gap-3">
          {authed ? (
            <>
              <Link to="/library" className="text-sm text-muted-foreground hover:text-foreground">
                Library
              </Link>
              <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm" variant="ghost">
                Sign in
              </Button>
            </Link>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-10 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs uppercase tracking-widest text-primary mb-8">
          <Sparkles className="h-3 w-3" /> AI motion-comic engine
        </div>
        <h1 className="font-display text-6xl md:text-8xl leading-none mb-6">
          MANGA IN.<br />
          <span className="text-primary">ANIME OUT.</span>
        </h1>
        <p className="max-w-xl mx-auto text-lg text-muted-foreground mb-10">
          Drop a manga PDF. Inkframe reads every page, writes cinematic narration,
          voices it, and stitches a downloadable motion-comic anime — in minutes.
        </p>

        <UploadCard
          disabled={processing}
          progress={progress}
          onSelect={(f) => handleFile(f)}
          fileRef={fileRef}
        />

        <p className="mt-4 text-xs text-muted-foreground">
          Up to 20 pages per project. Your PDF stays private.
        </p>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border/60">
        <h2 className="font-display text-3xl mb-10 text-center tracking-widest">HOW IT WORKS</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: Upload,
              title: "Upload",
              body: "Drop any manga PDF. We rasterize each page at high resolution.",
            },
            {
              icon: Wand2,
              title: "Narrate",
              body: "Gemini reads every panel and writes an anime-narrator script per page.",
            },
            {
              icon: Film,
              title: "Watch & export",
              body: "Cinematic pan/zoom, voiced narration, burned-in subs. Export .webm.",
            },
          ].map((s) => (
            <div key={s.title} className="rounded-lg border border-border bg-card/60 p-6">
              <s.icon className="h-6 w-6 text-primary mb-4" />
              <h3 className="font-display text-2xl mb-2 tracking-wide">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-10 text-center text-xs text-muted-foreground border-t border-border/60">
        Made for readers who wish their manga could talk.
      </footer>
    </div>
  );
}

function UploadCard({
  onSelect,
  disabled,
  progress,
  fileRef,
}: {
  onSelect: (f: File) => void;
  disabled: boolean;
  progress: { step: string; pct: number } | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onSelect(f);
      }}
      className={`mx-auto max-w-xl rounded-xl border-2 border-dashed p-10 transition ${
        drag ? "border-primary bg-primary/10" : "border-border bg-card/40"
      }`}
    >
      {progress ? (
        <div className="space-y-4">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium">{progress.step}</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <Upload className="mx-auto h-10 w-10 text-primary mb-4" />
          <p className="font-display text-2xl mb-2 tracking-wide">DROP YOUR MANGA PDF</p>
          <p className="text-sm text-muted-foreground mb-6">or</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSelect(f);
            }}
          />
          <Button
            size="lg"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            Choose PDF
          </Button>
        </>
      )}
    </div>
  );
}
