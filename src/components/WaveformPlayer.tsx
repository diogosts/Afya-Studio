import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { formatTimecode } from "../utils/audio";

export interface AudioTake {
  id: string;
  title: string;
  voiceName: string;
  styleLabel: string;
  blob: Blob;
  url: string;
  peaks: number[];
  duration: number;
  createdAt: string;
  filename: string;
}

interface WaveformPlayerProps {
  take: AudioTake | null;
  isGenerating: boolean;
  onGenerateMaster: () => void;
}

const SPEED_OPTIONS = [0.9, 1.0, 1.1] as const;

export function WaveformPlayer({ take, isGenerating, onGenerateMaster }: WaveformPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(take?.duration ?? 0);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.playbackRate = playbackRate;
    }
  }, [take?.id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !take) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const skipBy = (delta: number) => {
    const audio = audioRef.current;
    if (!audio || !take) return;
    const target = Math.max(0, Math.min(duration || take.duration, audio.currentTime + delta));
    audio.currentTime = target;
    setCurrentTime(target);
  };

  const seekToRatio = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !take) return;
    const total = duration || take.duration;
    if (total <= 0) return;
    const target = Math.max(0, Math.min(total, ratio * total));
    audio.currentTime = target;
    setCurrentTime(target);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextMuted = !isMuted;
    audio.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const handleDownload = () => {
    if (!take) return;
    const link = document.createElement("a");
    link.href = take.url;
    link.download = take.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const totalDuration = duration || take?.duration || 0;
  const progressRatio = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;

  if (!take) {
    return (
      <div className="border border-slate-200 bg-white rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Player Master de Áudio</h3>
            <p className="mt-1 text-sm text-slate-600">
              Nenhuma locução gerada ainda. Clique no botão abaixo para sintetizar a narração completa em voz masculina.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">00:00.0</span>
        </div>

        <div className="mt-5 h-20 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center px-4">
          <div className="flex items-center gap-1.5 w-full max-w-md justify-center opacity-40" aria-hidden="true">
            {Array.from({ length: 42 }).map((_, idx) => {
              const height = 16 + Math.round(Math.abs(Math.sin(idx * 0.45)) * 34);
              return (
                <div
                  key={idx}
                  className="w-1 rounded-full bg-slate-300"
                  style={{ height: `${height}px` }}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-500">Saída WAV 24 kHz · 16-bit Mono</span>
          <button
            type="button"
            onClick={onGenerateMaster}
            disabled={isGenerating}
            className="px-4 py-2 text-sm font-medium text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isGenerating ? "Gerando locução..." : "Gerar Narração Agora"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 bg-white rounded-xl p-6">
      <audio
        ref={audioRef}
        src={take.url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
          }
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 truncate">{take.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Voz {take.voiceName}</span>
            <span aria-hidden="true">·</span>
            <span>{take.styleLabel}</span>
            <span aria-hidden="true">·</span>
            <span>WAV 24 kHz</span>
          </div>
        </div>
        <div className="font-mono text-xs text-slate-700 tabular-nums shrink-0 pt-0.5">
          {formatTimecode(currentTime)} / {formatTimecode(totalDuration)}
        </div>
      </div>

      {/* Interactive Waveform Scrub Bar */}
      <div
        className="mt-5 relative h-20 rounded-lg bg-slate-50 border border-slate-200 px-3 flex items-center gap-[3px] cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
        role="slider"
        tabIndex={0}
        aria-label="Linha do tempo do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalDuration)}
        aria-valuenow={Math.round(currentTime)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          seekToRatio(ratio);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            skipBy(2);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            skipBy(-2);
          } else if (e.key === " ") {
            e.preventDefault();
            void togglePlay();
          }
        }}
      >
        {take.peaks.map((peak, index) => {
          const barRatio = (index + 0.5) / take.peaks.length;
          const isPlayed = barRatio <= progressRatio;
          const heightPct = Math.max(14, Math.round(peak * 86));
          return (
            <div
              key={index}
              className={`flex-1 rounded-full transition-colors duration-100 ${
                isPlayed ? "bg-rose-700" : "bg-slate-300 hover:bg-slate-400"
              }`}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>

      {/* Playback & Export Controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void togglePlay()}
            aria-label={isPlaying ? "Pausar narração" : "Reproduzir narração"}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer shrink-0"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => skipBy(-5)}
            title="Voltar 5 segundos"
            aria-label="Voltar 5 segundos"
            className="inline-flex items-center gap-1 px-2.5 h-10 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-mono tabular-nums transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>-5s</span>
          </button>

          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? "Ativar som" : "Silenciar"}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer shrink-0"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-0.5 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Velocidade de reprodução">
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setPlaybackRate(rate)}
                className={`px-2 py-1 text-xs font-mono tabular-nums rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  playbackRate === rate
                    ? "bg-white text-slate-900 shadow-sm font-medium"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {rate.toFixed(1)}x
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-rose-700 hover:bg-rose-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Baixar WAV</span>
        </button>
      </div>
    </div>
  );
}
