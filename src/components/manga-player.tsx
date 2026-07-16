import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, Download, Loader2 } from "lucide-react";

export interface MangaPage {
  pageNumber: number;
  imageUrl: string;
  audioUrl: string;
  narration: string;
  subtitle: string;
  durationMs: number;
}

interface Props {
  pages: MangaPage[];
  title: string;
}

// Ken Burns motion presets per page (deterministic by index)
function motionFor(i: number) {
  const presets = [
    { fromScale: 1.0, toScale: 1.15, fromX: 0, toX: -0.05, fromY: 0, toY: 0.03 },
    { fromScale: 1.15, toScale: 1.0, fromX: 0.05, toX: 0, fromY: -0.03, toY: 0 },
    { fromScale: 1.05, toScale: 1.2, fromX: 0, toX: 0.06, fromY: 0.02, toY: -0.02 },
    { fromScale: 1.2, toScale: 1.05, fromX: -0.06, toX: 0, fromY: 0, toY: 0.04 },
  ];
  return presets[i % presets.length];
}

export function MangaPlayer({ pages, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const imgCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pageStart, setPageStart] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recorderReady, setRecorderReady] = useState<{ url: string } | null>(null);

  // Detect action/SFX intensity from narration text (bigger shake, more speed lines).
  const intensityFor = (text: string): number => {
    const t = text.toLowerCase();
    const kws = [
      "slash", "crash", "boom", "explod", "smash", "punch", "kick", "roar",
      "scream", "shout", "burst", "shatter", "blast", "strike", "attack",
      "run", "fight", "clash", "impact", "rush", "charge", "leap",
    ];
    let score = 0;
    for (const k of kws) if (t.includes(k)) score += 0.35;
    if (/!{1,}/.test(text)) score += 0.25;
    if (/[A-Z]{4,}/.test(text)) score += 0.25;
    return Math.min(1, score);
  };

  const ensureAudioGraph = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioCtxRef.current) return;
    const Ctor: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const src = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const dest = ctx.createMediaStreamDestination();
    src.connect(analyser);
    analyser.connect(ctx.destination);
    analyser.connect(dest);
    audioCtxRef.current = ctx;
    audioSrcRef.current = src;
    analyserRef.current = analyser;
    audioDestRef.current = dest;
    freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
  };

  // Preload images
  useEffect(() => {
    pages.forEach((p) => {
      if (imgCacheRef.current.has(p.pageNumber)) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = p.imageUrl;
      imgCacheRef.current.set(p.pageNumber, img);
    });
  }, [pages]);

  const drawFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const page = pages[currentIdx];
    if (!page) return;
    const img = imgCacheRef.current.get(page.pageNumber);
    const W = canvas.width;
    const H = canvas.height;

    // Audio amplitude (0..1) for shake + pulse
    let amp = 0;
    const analyser = analyserRef.current;
    const freq = freqDataRef.current;
    if (analyser && freq) {
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      for (let i = 0; i < freq.length; i++) sum += freq[i];
      amp = Math.min(1, sum / (freq.length * 180));
    }
    const intensity = intensityFor(`${page.subtitle} ${page.narration}`);
    const shakeMag = (2 + intensity * 14) * (0.4 + amp * 1.4);
    const shakeX = (Math.random() - 0.5) * shakeMag;
    const shakeY = (Math.random() - 0.5) * shakeMag;

    // Background
    ctx.fillStyle = "#0a0608";
    ctx.fillRect(0, 0, W, H);

    if (img && img.complete && img.naturalWidth) {
      const elapsed = performance.now() - pageStart;
      const t = Math.max(0, Math.min(1, elapsed / page.durationMs));
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const m = motionFor(currentIdx);
      // Zoom-punch: extra scale kick at page start (first ~250ms)
      const punchT = Math.min(1, elapsed / 250);
      const punch = (1 - punchT) * (0.08 + intensity * 0.14);
      const scale = m.fromScale + (m.toScale - m.fromScale) * eased + punch;
      const offX = (m.fromX + (m.toX - m.fromX) * eased) * W;
      const offY = (m.fromY + (m.toY - m.fromY) * eased) * H;

      // Fit page image into canvas maintaining aspect, then scale.
      const scaleFit = Math.min(W / img.naturalWidth, H / img.naturalHeight) * scale;
      const dW = img.naturalWidth * scaleFit;
      const dH = img.naturalHeight * scaleFit;
      const dx = (W - dW) / 2 + offX + shakeX;
      const dy = (H - dH) / 2 + offY + shakeY;
      ctx.drawImage(img, dx, dy, dW, dH);

      // Speed lines overlay — radial streaks on action pages
      if (intensity > 0.2) {
        const lineCount = Math.round(30 + intensity * 60);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.strokeStyle = `rgba(255,240,230,${0.08 + intensity * 0.22})`;
        ctx.lineWidth = 1.2;
        const cx = W / 2;
        const cy = H / 2;
        const seed = Math.floor(elapsed / 80);
        for (let i = 0; i < lineCount; i++) {
          const a = ((i * 37 + seed * 13) % 360) * (Math.PI / 180);
          const r0 = W * (0.28 + ((i * 17) % 15) / 100);
          const r1 = W * (0.55 + ((i * 23) % 25) / 100);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Impact flash at page start
      const flashT = Math.min(1, elapsed / 220);
      if (flashT < 1) {
        ctx.fillStyle = `rgba(255,255,255,${(1 - flashT) * 0.55})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Vignette
      const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Subtitle band — bouncy pop-in synced to audio pulse
      const sub = page.subtitle || page.narration;
      const popT = Math.min(1, elapsed / 320);
      const popScale = 0.9 + popT * (1 + Math.sin(popT * Math.PI) * 0.08);
      const bandH = Math.round(H * 0.16);
      const bandY = H - bandH;
      ctx.save();
      ctx.translate(W / 2, bandY + bandH / 2);
      ctx.scale(1, popScale);
      ctx.translate(-W / 2, -(bandY + bandH / 2));
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillRect(0, bandY, W, bandH);
      // Accent bar pulses with audio
      const barH = 3 + amp * 6;
      ctx.fillStyle = `rgba(233,75,60,${0.85 + amp * 0.15})`;
      ctx.fillRect(0, bandY, W, barH);
      ctx.fillStyle = "#f7ede2";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fontSize = Math.round(W * 0.028 * (1 + amp * 0.05));
      ctx.font = `700 ${fontSize}px Inter, sans-serif`;
      wrapText(ctx, sub, W / 2, bandY + bandH / 2, W * 0.86, fontSize * 1.25);
      ctx.restore();

      // "Talking" indicator — small pulsing dot beside the page counter
      const dotR = 6 + amp * 10;
      ctx.fillStyle = `rgba(233,75,60,${0.4 + amp * 0.6})`;
      ctx.beginPath();
      ctx.arc(W - 60, 36, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Page counter
      ctx.fillStyle = "rgba(233,75,60,0.85)";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.font = `${Math.round(W * 0.03)}px 'Bebas Neue', Impact, sans-serif`;
      ctx.fillText(`${page.pageNumber} / ${pages.length}`, W - 84, 22);

      // Title top-left
      ctx.fillStyle = "rgba(247,237,226,0.9)";
      ctx.textAlign = "left";
      ctx.font = `${Math.round(W * 0.028)}px 'Bebas Neue', Impact, sans-serif`;
      ctx.fillText(title.toUpperCase(), 24, 22);
    } else {
      ctx.fillStyle = "#f7ede2";
      ctx.font = "24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading page...", W / 2, H / 2);
    }

    rafRef.current = requestAnimationFrame(drawFrame);
  };

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentIdx, pageStart]);

  // Advance page when audio ends OR duration elapses
  useEffect(() => {
    if (!playing) return;
    const page = pages[currentIdx];
    if (!page) return;
    const audio = audioRef.current;
    if (audio && page.audioUrl) {
      audio.src = page.audioUrl;
      audio.currentTime = 0;
      ensureAudioGraph();
      audioCtxRef.current?.resume().catch(() => {});
      audio.play().catch(() => {});
    }
    setPageStart(performance.now());
    const timer = window.setTimeout(() => {
      if (currentIdx + 1 < pages.length) {
        setCurrentIdx((i) => i + 1);
      } else {
        setPlaying(false);
      }
    }, page.durationMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentIdx]);

  // Initial static frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const page = pages[0];
    if (!page) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgCacheRef.current.set(page.pageNumber, img);
      setPageStart(performance.now());
      // draw one frame
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0a0608";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scaleFit = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const dW = img.naturalWidth * scaleFit;
      const dH = img.naturalHeight * scaleFit;
      ctx.drawImage(img, (canvas.width - dW) / 2, (canvas.height - dH) / 2, dW, dH);
    };
    img.src = page.imageUrl;
  }, [pages]);

  const handlePlay = () => {
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
    } else {
      setCurrentIdx(0);
      setPlaying(true);
    }
  };

  const handleRecord = async () => {
    if (recording) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRecorderReady(null);
    setRecording(true);

    // Combine canvas video + audio element stream (reuse the shared audio graph)
    const canvasStream = canvas.captureStream(30);
    ensureAudioGraph();
    const dest = audioDestRef.current!;

    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      setRecorderReady({ url });
      setRecording(false);
    };

    rec.start(200);
    setCurrentIdx(0);
    setPlaying(true);

    // Total duration = sum of pages + 500ms buffer
    const total = pages.reduce((s, p) => s + p.durationMs, 0) + 600;
    setTimeout(() => {
      rec.stop();
      setPlaying(false);
    }, total);
  };

  function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ) {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    const start = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, start + i * lineHeight));
  }

  return (
    <div className="w-full space-y-4">
      <div className="relative overflow-hidden rounded-lg border border-border bg-black shadow-2xl">
        <canvas ref={canvasRef} width={1280} height={720} className="w-full h-auto block" />
        <audio ref={audioRef} className="hidden" crossOrigin="anonymous" preload="auto" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handlePlay} size="lg" variant="default">
          {playing ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button onClick={handleRecord} disabled={recording} size="lg" variant="secondary">
          {recording ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording…
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" /> Export video
            </>
          )}
        </Button>
        {recorderReady && (
          <a
            href={recorderReady.url}
            download={`${title.replace(/[^a-z0-9]+/gi, "-")}.webm`}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Download .webm
          </a>
        )}
      </div>
    </div>
  );
}