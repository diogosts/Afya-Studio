import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from "lucide-react";
import {
  INITIAL_SCENES,
  MALE_VOICES,
  STYLE_PRESETS,
  type MaleVoiceOption,
  type ScriptScene,
} from "./data/scriptData";
import {
  base64ToWavBlob,
  concatWavBlobs,
  countWords,
  estimateSpeechSeconds,
  extractWaveformPeaks,
  formatTimecode,
} from "./utils/audio";
import { WaveformPlayer, type AudioTake } from "./components/WaveformPlayer";

type ScriptViewMode = "scenes" | "full";

interface SceneAudioState {
  url: string;
  blob: Blob;
  duration: number;
  voiceName: string;
}

export default function App() {
  const [scenes, setScenes] = useState<ScriptScene[]>(() =>
    INITIAL_SCENES.map((s) => ({ ...s }))
  );
  const [viewMode, setViewMode] = useState<ScriptViewMode>("scenes");
  const [selectedVoice, setSelectedVoice] = useState<MaleVoiceOption["id"]>("Charon");
  const [selectedPresetId, setSelectedPresetId] = useState<string>(STYLE_PRESETS[0].id);
  const [customStyle, setCustomStyle] = useState<string>(STYLE_PRESETS[0].stylePrompt);
  const [includeBreaths, setIncludeBreaths] = useState<boolean>(true);

  const [isGeneratingMaster, setIsGeneratingMaster] = useState<boolean>(false);
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const [auditioningVoiceId, setAuditioningVoiceId] = useState<string | null>(null);
  const [playingVoiceSampleId, setPlayingVoiceSampleId] = useState<string | null>(null);
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);
  const [isCombiningScenes, setIsCombiningScenes] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [takes, setTakes] = useState<AudioTake[]>([]);
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [sceneAudios, setSceneAudios] = useState<Record<string, SceneAudioState>>({});
  const [voiceSamples, setVoiceSamples] = useState<Record<string, string>>({});

  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);
  const urlsToCleanupRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      urlsToCleanupRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const registerObjectUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    urlsToCleanupRef.current.push(url);
    return url;
  };

  const fullScriptText = useMemo(
    () =>
      scenes
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join("\n\n"),
    [scenes]
  );

  const totalWords = useMemo(() => countWords(fullScriptText), [fullScriptText]);
  const estimatedDuration = useMemo(
    () => estimateSpeechSeconds(fullScriptText, includeBreaths),
    [fullScriptText, includeBreaths]
  );

  const isScriptModified = useMemo(() => {
    if (scenes.length !== INITIAL_SCENES.length) return true;
    return scenes.some((s, idx) => s.text.trim() !== INITIAL_SCENES[idx].text.trim());
  }, [scenes]);

  const activeTake = useMemo(
    () => takes.find((t) => t.id === activeTakeId) ?? takes[0] ?? null,
    [takes, activeTakeId]
  );

  const generatedSceneCount = useMemo(
    () => scenes.filter((s) => Boolean(sceneAudios[s.id])).length,
    [scenes, sceneAudios]
  );

  const stopInlineAudio = () => {
    if (inlineAudioRef.current) {
      inlineAudioRef.current.pause();
      inlineAudioRef.current = null;
    }
    setPlayingVoiceSampleId(null);
    setPlayingSceneId(null);
  };

  const playInlineUrl = async (url: string, kind: "voice" | "scene", id: string) => {
    stopInlineAudio();
    const audio = new Audio(url);
    inlineAudioRef.current = audio;
    if (kind === "voice") {
      setPlayingVoiceSampleId(id);
    } else {
      setPlayingSceneId(id);
    }
    audio.onended = () => {
      setPlayingVoiceSampleId(null);
      setPlayingSceneId(null);
      inlineAudioRef.current = null;
    };
    try {
      await audio.play();
    } catch {
      stopInlineAudio();
    }
  };

  const requestTtsAudio = async (
    text: string,
    voiceName: MaleVoiceOption["id"],
    style: string,
    useBreaths: boolean
  ): Promise<Blob> => {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceName,
        style,
        includeBreaths: useBreaths,
      }),
    });

    const data = (await response.json()) as {
      audioBase64?: string;
      mimeType?: string;
      error?: string;
    };

    if (!response.ok || !data.audioBase64) {
      throw new Error(
        data.error || "Falha ao sintetizar áudio no servidor. Tente novamente."
      );
    }

    return base64ToWavBlob(data.audioBase64, data.mimeType || "audio/wav");
  };

  const buildFallbackPeaks = (count = 84): number[] =>
    Array.from({ length: count }, (_, idx) =>
      Math.max(0.18, Math.min(0.92, 0.45 + Math.sin(idx * 0.4) * 0.3))
    );

  const createTakeFromBlob = async (
    blob: Blob,
    title: string,
    voiceName: string,
    styleLabel: string,
    filename: string
  ): Promise<AudioTake> => {
    const url = registerObjectUrl(blob);
    let peaks = buildFallbackPeaks();
    let duration = estimateSpeechSeconds(fullScriptText, includeBreaths);

    try {
      const extracted = await extractWaveformPeaks(blob, 84);
      peaks = extracted.peaks;
      duration = extracted.duration;
    } catch {
      // Keep fallback peaks if AudioContext decoding is unavailable
    }

    return {
      id: `take-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      voiceName,
      styleLabel,
      blob,
      url,
      peaks,
      duration,
      createdAt: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      filename,
    };
  };

  const handleGenerateMaster = async () => {
    if (!fullScriptText.trim()) {
      setErrorMessage("Adicione texto ao roteiro antes de gerar a narração.");
      return;
    }

    setErrorMessage(null);
    setIsGeneratingMaster(true);
    stopInlineAudio();

    try {
      const preset = STYLE_PRESETS.find((p) => p.id === selectedPresetId);
      const styleLabel =
        preset && customStyle.trim() === preset.stylePrompt
          ? preset.label
          : "Direção personalizada";

      const wavBlob = await requestTtsAudio(
        fullScriptText,
        selectedVoice,
        customStyle,
        includeBreaths
      );

      const takeNumber = takes.length + 1;
      const take = await createTakeFromBlob(
        wavBlob,
        `Take ${String(takeNumber).padStart(2, "0")} · Narração Completa`,
        selectedVoice,
        styleLabel,
        `afya-pato-branco-narracao-${selectedVoice.toLowerCase()}-take-${takeNumber}.wav`
      );

      setTakes((prev) => [take, ...prev]);
      setActiveTakeId(take.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro inesperado ao gerar a narração."
      );
    } finally {
      setIsGeneratingMaster(false);
    }
  };

  const handleGenerateScene = async (scene: ScriptScene, index: number) => {
    const text = scene.text.trim();
    if (!text) {
      setErrorMessage(`O trecho ${index + 1} está vazio.`);
      return;
    }

    setErrorMessage(null);
    setGeneratingSceneId(scene.id);
    stopInlineAudio();

    try {
      const wavBlob = await requestTtsAudio(
        text,
        selectedVoice,
        `${customStyle} Contexto da cena: ${scene.directionHint}`,
        false
      );
      const url = registerObjectUrl(wavBlob);
      let duration = estimateSpeechSeconds(text, false);
      try {
        const extracted = await extractWaveformPeaks(wavBlob, 24);
        duration = extracted.duration;
      } catch {
        // Keep estimated duration
      }

      setSceneAudios((prev) => ({
        ...prev,
        [scene.id]: {
          url,
          blob: wavBlob,
          duration,
          voiceName: selectedVoice,
        },
      }));

      await playInlineUrl(url, "scene", scene.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao gerar o trecho selecionado."
      );
    } finally {
      setGeneratingSceneId(null);
    }
  };

  const handleCombineScenes = async () => {
    const orderedBlobs = scenes
      .map((s) => sceneAudios[s.id]?.blob)
      .filter((b): b is Blob => Boolean(b));

    if (orderedBlobs.length < 2) {
      setErrorMessage("Gere pelo menos 2 trechos individuais para combinar em um único WAV.");
      return;
    }

    setErrorMessage(null);
    setIsCombiningScenes(true);
    try {
      const mergedBlob = await concatWavBlobs(orderedBlobs, includeBreaths ? 0.55 : 0.25);
      const takeNumber = takes.length + 1;
      const take = await createTakeFromBlob(
        mergedBlob,
        `Take ${String(takeNumber).padStart(2, "0")} · Montagem (${orderedBlobs.length} trechos)`,
        selectedVoice,
        "Montagem por cenas",
        `afya-pato-branco-montagem-take-${takeNumber}.wav`
      );
      setTakes((prev) => [take, ...prev]);
      setActiveTakeId(take.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Não foi possível combinar os trechos."
      );
    } finally {
      setIsCombiningScenes(false);
    }
  };

  const handleAuditionVoice = async (voice: MaleVoiceOption) => {
    if (playingVoiceSampleId === voice.id) {
      stopInlineAudio();
      return;
    }

    const cacheKey = `${voice.id}:${selectedPresetId}`;
    if (voiceSamples[cacheKey]) {
      await playInlineUrl(voiceSamples[cacheKey], "voice", voice.id);
      return;
    }

    setErrorMessage(null);
    setAuditioningVoiceId(voice.id);
    stopInlineAudio();

    try {
      const wavBlob = await requestTtsAudio(
        voice.sampleText,
        voice.id,
        customStyle,
        false
      );
      const url = registerObjectUrl(wavBlob);
      setVoiceSamples((prev) => ({ ...prev, [cacheKey]: url }));
      await playInlineUrl(url, "voice", voice.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao reproduzir amostra da voz."
      );
    } finally {
      setAuditioningVoiceId(null);
    }
  };

  const handleSceneTextChange = (id: string, value: string) => {
    setScenes((prev) =>
      prev.map((scene) => (scene.id === id ? { ...scene, text: value } : scene))
    );
  };

  const handleFullTextChange = (value: string) => {
    const blocks = value.split(/\n\s*\n/);
    setScenes((prev) => {
      const updated: ScriptScene[] = blocks.map((blockText, idx) => {
        const existing = prev[idx] ?? INITIAL_SCENES[idx];
        return {
          id: existing?.id ?? `scene-${idx + 1}`,
          label: existing?.label ?? `Trecho ${idx + 1}`,
          directionHint:
            existing?.directionHint ?? "Locução institucional clara e equilibrada.",
          text: blockText,
        };
      });
      return updated.length > 0 ? updated : [{ ...INITIAL_SCENES[0], text: "" }];
    });
  };

  const handleRestoreOriginal = () => {
    setScenes(INITIAL_SCENES.map((s) => ({ ...s })));
  };

  const handleCopyScript = async () => {
    try {
      await navigator.clipboard.writeText(fullScriptText);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 1800);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const handleDownloadUrl = (url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <a
            href="#roteiro"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Afya Pato Branco
          </a>

          {/* Zone 2: Concise single-line navigation links */}
          <nav
            aria-label="Navegação do estúdio"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#roteiro"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Roteiro
            </a>
            <a
              href="#direcao-vocal"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Direção Vocal
            </a>
            <a
              href="#player-master"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Player Master
            </a>
            <a
              href="#takes-salvos"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Takes Salvos
            </a>
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => void handleGenerateMaster()}
              disabled={isGeneratingMaster}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isGeneratingMaster ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
              <span>{isGeneratingMaster ? "Gerando..." : "Gerar Narração"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8">
        {/* Studio Header */}
        <section className="pb-8 border-b border-slate-200">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
                Estúdio de Narração para Vídeo Institucional
              </h1>
              <p className="mt-2 text-base text-slate-600 leading-relaxed">
                Roteiro oficial da Afya Pato Branco pronto para locução em voz masculina.
                Gere o áudio completo em um único take contínuo ou grave trecho por trecho
                em WAV (24 kHz) para sua ilha de edição.
              </p>
            </div>

            {/* Unboxed metadata strip */}
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-slate-600 tabular-nums shrink-0">
              <span>{scenes.length} trechos</span>
              <span aria-hidden="true">·</span>
              <span>{totalWords} palavras</span>
              <span aria-hidden="true">·</span>
              <span>~{Math.round(estimatedDuration)}s estimados</span>
              <span aria-hidden="true">·</span>
              <span>WAV 24 kHz Mono</span>
            </div>
          </div>
        </section>

        {errorMessage && (
          <div
            role="alert"
            className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-xs font-medium text-red-800 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Dispensar
            </button>
          </div>
        )}

        {/* Main 2-Column Workspace */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Script & Scene Editor */}
          <section id="roteiro" className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div
                className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg"
                role="tablist"
                aria-label="Modo de visualização do roteiro"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === "scenes"}
                  onClick={() => setViewMode("scenes")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    viewMode === "scenes"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Por Trechos ({scenes.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === "full"}
                  onClick={() => setViewMode("full")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    viewMode === "full"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Roteiro Completo
                </button>
              </div>

              <div className="flex items-center gap-3">
                {isScriptModified && (
                  <button
                    type="button"
                    onClick={handleRestoreOriginal}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar original</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleCopyScript()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedScript ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar texto</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {viewMode === "scenes" ? (
              <div className="border border-slate-200 bg-white rounded-xl divide-y divide-slate-200">
                {scenes.map((scene, index) => {
                  const sceneWords = countWords(scene.text);
                  const sceneEstSec = estimateSpeechSeconds(scene.text, false);
                  const sceneAudio = sceneAudios[scene.id];
                  const isSceneGenerating = generatingSceneId === scene.id;
                  const isScenePlaying = playingSceneId === scene.id;

                  return (
                    <div key={scene.id} className="p-5 transition-colors hover:bg-slate-50/50">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-mono text-xs font-semibold text-rose-700 tabular-nums shrink-0">
                            {String(index + 1).padStart(2, "0")}.
                          </span>
                          <h2 className="text-sm font-semibold text-slate-900 truncate">
                            {scene.label}
                          </h2>
                          <span className="text-xs text-slate-400 hidden sm:inline" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs text-slate-500 tabular-nums hidden sm:inline">
                            {sceneWords} palavras · ~{Math.round(sceneEstSec)}s
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {sceneAudio && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isScenePlaying) {
                                    stopInlineAudio();
                                  } else {
                                    void playInlineUrl(sceneAudio.url, "scene", scene.id);
                                  }
                                }}
                                aria-label={
                                  isScenePlaying
                                    ? `Pausar trecho ${index + 1}`
                                    : `Ouvir trecho ${index + 1}`
                                }
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                {isScenePlaying ? (
                                  <Pause className="w-3.5 h-3.5" />
                                ) : (
                                  <Play className="w-3.5 h-3.5" />
                                )}
                                <span className="font-mono tabular-nums">
                                  {formatTimecode(sceneAudio.duration)}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleDownloadUrl(
                                    sceneAudio.url,
                                    `afya-pato-branco-trecho-${String(index + 1).padStart(2, "0")}.wav`
                                  )
                                }
                                title="Baixar trecho em WAV"
                                aria-label={`Baixar trecho ${index + 1} em WAV`}
                                className="inline-flex items-center justify-center w-7 h-7 text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 rounded-md transition-colors cursor-pointer shrink-0"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleGenerateScene(scene, index)}
                            disabled={isSceneGenerating || isGeneratingMaster}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-rose-800 border border-slate-200 hover:border-rose-200 bg-white hover:bg-rose-50/40 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isSceneGenerating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Mic className="w-3.5 h-3.5" />
                            )}
                            <span>{sceneAudio ? "Regravar" : "Gerar trecho"}</span>
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={scene.text}
                        onChange={(e) => handleSceneTextChange(scene.id, e.target.value)}
                        rows={scene.text.length > 105 ? 3 : 2}
                        aria-label={`Texto do trecho ${index + 1}: ${scene.label}`}
                        className="mt-3 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-700/15 transition-colors"
                      />

                      <p className="mt-2 text-xs text-slate-500">
                        Sugestão de interpretação: {scene.directionHint}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border border-slate-200 bg-white rounded-xl p-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <label
                    htmlFor="full-script-editor"
                    className="text-sm font-semibold text-slate-900"
                  >
                    Texto integral para locução contínua
                  </label>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {totalWords} palavras · ~{Math.round(estimatedDuration)}s
                  </span>
                </div>
                <textarea
                  id="full-script-editor"
                  value={fullScriptText}
                  onChange={(e) => handleFullTextChange(e.target.value)}
                  rows={16}
                  className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3.5 text-[15px] leading-relaxed text-slate-900 focus:bg-white focus:border-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-700/15 transition-colors"
                />
                <p className="mt-2.5 text-xs text-slate-500">
                  Separe parágrafos com uma linha em branco para preservar as pausas entre cada cena do vídeo.
                </p>
              </div>
            )}

            {generatedSceneCount >= 2 && (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
                <div className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">
                    {generatedSceneCount} de {scenes.length} trechos gravados
                  </span>
                  <span className="text-slate-500">
                    {" "}
                    · Combine os áudios aprovados em um único arquivo WAV.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCombineScenes()}
                  disabled={isCombiningScenes}
                  className="px-4 py-2 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isCombiningScenes ? "Combinando..." : "Combinar Trechos em WAV"}
                </button>
              </div>
            )}
          </section>

          {/* Right Column: Vocal Direction, Master Player & Take History */}
          <aside className="lg:col-span-5 space-y-6">
            {/* Voice & Vocal Direction */}
            <section
              id="direcao-vocal"
              className="border border-slate-200 bg-white rounded-xl p-6 space-y-5"
            >
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Voz Masculina & Direção Vocal
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Escolha o timbre masculino e o estilo de interpretação para a locução em português brasileiro.
                </p>
              </div>

              {/* Male Voice Selection */}
              <div className="space-y-2.5" role="radiogroup" aria-label="Seleção de voz masculina">
                {MALE_VOICES.map((voice) => {
                  const isSelected = selectedVoice === voice.id;
                  const isAuditioning = auditioningVoiceId === voice.id;
                  const isPlayingSample = playingVoiceSampleId === voice.id;

                  return (
                    <div
                      key={voice.id}
                      onClick={() => setSelectedVoice(voice.id)}
                      className={`rounded-lg border p-3.5 transition-colors cursor-pointer ${
                        isSelected
                          ? "border-rose-700 bg-rose-50/40"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="radio"
                            name="male-voice"
                            id={`voice-${voice.id}`}
                            checked={isSelected}
                            onChange={() => setSelectedVoice(voice.id)}
                            className="mt-1 accent-rose-700 cursor-pointer"
                          />
                          <label
                            htmlFor={`voice-${voice.id}`}
                            className="cursor-pointer min-w-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {voice.name}
                              </span>
                              <span className="text-xs text-slate-400" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-xs font-medium text-slate-600">
                                {voice.timbre}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                              {voice.description}
                            </p>
                          </label>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAuditionVoice(voice);
                          }}
                          disabled={isAuditioning}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {isAuditioning ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isPlayingSample ? (
                            <Pause className="w-3.5 h-3.5 text-rose-700" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                          <span>{isPlayingSample ? "Pausar" : "Amostra"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Style Presets */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Tom da Interpretação
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {STYLE_PRESETS.map((preset) => {
                    const active = selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setSelectedPresetId(preset.id);
                          setCustomStyle(preset.stylePrompt);
                        }}
                        className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors whitespace-nowrap truncate cursor-pointer ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Style Prompt */}
              <div>
                <label
                  htmlFor="vocal-direction-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Instrução de direção para o locutor
                </label>
                <textarea
                  id="vocal-direction-input"
                  value={customStyle}
                  onChange={(e) => setCustomStyle(e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-relaxed text-slate-800 focus:bg-white focus:border-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-700/15 transition-colors"
                />
              </div>

              {/* Pacing / Breaths Toggle */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeBreaths}
                  onChange={(e) => setIncludeBreaths(e.target.checked)}
                  className="mt-0.5 rounded accent-rose-700 cursor-pointer"
                />
                <span className="text-xs text-slate-600 leading-relaxed">
                  Inserir pausas respiratórias naturais entre os parágrafos para facilitar cortes de vídeo
                </span>
              </label>

              {/* Master Generate CTA */}
              <button
                type="button"
                onClick={() => void handleGenerateMaster()}
                disabled={isGeneratingMaster || !fullScriptText.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                {isGeneratingMaster ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sintetizando narração completa...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Gerar Narração Completa ({selectedVoice})</span>
                  </>
                )}
              </button>
            </section>

            {/* Master Waveform Player */}
            <section id="player-master">
              <WaveformPlayer
                take={activeTake}
                isGenerating={isGeneratingMaster}
                onGenerateMaster={() => void handleGenerateMaster()}
              />
            </section>

            {/* Session Take History */}
            <section
              id="takes-salvos"
              className="border border-slate-200 bg-white rounded-xl p-6"
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Takes Gerados na Sessão
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {takes.length} {takes.length === 1 ? "arquivo" : "arquivos"}
                </span>
              </div>

              {takes.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                  Os takes completos gerados aparecerão aqui para você comparar vozes,
                  estilos de locução e baixar o arquivo WAV definitivo.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                  {takes.map((take) => {
                    const isActive = activeTake?.id === take.id;
                    return (
                      <div
                        key={take.id}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <button
                          type="button"
                          onClick={() => setActiveTakeId(take.id)}
                          className="min-w-0 text-left flex-1 group cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-medium truncate ${
                                isActive
                                  ? "text-rose-700"
                                  : "text-slate-900 group-hover:text-rose-700"
                              }`}
                            >
                              {take.title}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                            <span>{take.voiceName}</span>
                            <span aria-hidden="true">·</span>
                            <span>{take.styleLabel}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{formatTimecode(take.duration)}</span>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setActiveTakeId(take.id)}
                            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              isActive
                                ? "bg-slate-900 text-white"
                                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            }`}
                          >
                            {isActive ? "No Player" : "Carregar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadUrl(take.url, take.filename)}
                            aria-label={`Baixar ${take.title}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1280px] mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>Afya Pato Branco · Medicina de excelência. Compromisso com a vida.</span>
          <span>Exportação direta em WAV 24 kHz 16-bit PCM</span>
        </div>
      </footer>
    </div>
  );
}
