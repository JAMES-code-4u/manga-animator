import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1";

function apiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ title: z.string().min(1).max(200), pageCount: z.number().int().min(1).max(60) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .insert({ user_id: userId, title: data.title, page_count: data.pageCount, status: "processing" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { projectId: row.id as string };
  });

export const finalizeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ projectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ status: "ready" })
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const processPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        pageNumber: z.number().int().min(1).max(500),
        imagePath: z.string().min(1),
        imageDataUrl: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ask Gemini for narration + subtitle from the page image.
    const geminiRes = await fetch(`${LOVABLE_AI}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are an anime narrator. Given a single manga page, write ONE short cinematic narration line (12-28 words) that captures the scene, mood, and any spoken dialogue in an anime-narrator voice. Also produce a concise on-screen subtitle (max 90 chars) that reads well as burned-in text. Respond ONLY as strict JSON: {\"narration\":\"...\",\"subtitle\":\"...\"}. No preamble, no code fences.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Manga page ${data.pageNumber}. Narrate it.` },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!geminiRes.ok) {
      const body = await geminiRes.text().catch(() => "");
      throw new Error(`Narration failed [${geminiRes.status}]: ${body.slice(0, 300)}`);
    }
    const geminiJson = (await geminiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = geminiJson.choices?.[0]?.message?.content ?? "{}";
    let narration = "";
    let subtitle = "";
    try {
      const parsed = JSON.parse(raw);
      narration = String(parsed.narration ?? "").trim();
      subtitle = String(parsed.subtitle ?? narration).trim();
    } catch {
      narration = raw.slice(0, 200);
      subtitle = narration.slice(0, 90);
    }
    if (!narration) narration = `Page ${data.pageNumber}.`;
    if (!subtitle) subtitle = narration.slice(0, 90);

    // Generate TTS audio (MP3).
    const ttsRes = await fetch(`${LOVABLE_AI}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: narration,
        voice: "onyx",
        response_format: "mp3",
        instructions:
          "Deep, calm anime-narrator voice. Slight cinematic gravitas. Speak clearly at a measured pace.",
      }),
    });
    if (!ttsRes.ok) {
      const body = await ttsRes.text().catch(() => "");
      throw new Error(`TTS failed [${ttsRes.status}]: ${body.slice(0, 300)}`);
    }
    const audioBuf = await ttsRes.arrayBuffer();

    // Upload audio to storage (same folder as user for RLS).
    const audioPath = `${userId}/${data.projectId}/audio-${String(data.pageNumber).padStart(4, "0")}.mp3`;
    const { error: upErr } = await supabase.storage
      .from("manga")
      .upload(audioPath, new Uint8Array(audioBuf), { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error(`Audio upload failed: ${upErr.message}`);

    // Approximate duration: ~155 wpm speech = ~2.6 words/sec.
    const words = narration.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(2500, Math.round((words / 2.6) * 1000) + 600);

    const { error: insErr } = await supabase.from("pages").upsert(
      {
        project_id: data.projectId,
        user_id: userId,
        page_number: data.pageNumber,
        image_path: data.imagePath,
        audio_path: audioPath,
        narration,
        subtitle,
        duration_ms: durationMs,
      },
      { onConflict: "project_id,page_number" },
    );
    if (insErr) throw new Error(`Row insert failed: ${insErr.message}`);

    return { narration, subtitle, audioPath, durationMs };
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, title, status, page_count, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ projectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: proj, error: pErr } = await supabase
      .from("projects")
      .select("id, title, status, page_count")
      .eq("id", data.projectId)
      .single();
    if (pErr) throw new Error(pErr.message);

    const { data: pages, error: pgErr } = await supabase
      .from("pages")
      .select("page_number, image_path, audio_path, narration, subtitle, duration_ms")
      .eq("project_id", data.projectId)
      .order("page_number", { ascending: true });
    if (pgErr) throw new Error(pgErr.message);

    // Sign URLs for each asset (1h).
    const paths: string[] = [];
    for (const p of pages ?? []) {
      paths.push(p.image_path);
      if (p.audio_path) paths.push(p.audio_path);
    }
    const signedMap: Record<string, string> = {};
    if (paths.length) {
      const { data: signed, error: sErr } = await supabase.storage
        .from("manga")
        .createSignedUrls(paths, 3600);
      if (sErr) throw new Error(sErr.message);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
    }

    return {
      project: proj,
      pages: (pages ?? []).map((p) => ({
        pageNumber: p.page_number,
        narration: p.narration ?? "",
        subtitle: p.subtitle ?? "",
        durationMs: p.duration_ms ?? 3500,
        imageUrl: signedMap[p.image_path] ?? "",
        audioUrl: p.audio_path ? signedMap[p.audio_path] ?? "" : "",
      })),
    };
  });