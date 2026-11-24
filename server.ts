import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_MALE_VOICES = new Set(["Charon", "Fenrir", "Puck"]);

interface TtsRequestBody {
  text?: string;
  voiceName?: string;
  style?: string;
  includeBreaths?: boolean;
}

function createAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function prepareNarrationText(rawText: string, includeBreaths: boolean): string {
  const paragraphs = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!includeBreaths || paragraphs.length <= 1) {
    return paragraphs.join("\n\n");
  }

  return paragraphs.join(" <breath>\n\n");
}

async function generateSpeechWithRetry(
  ai: GoogleGenAI,
  text: string,
  voiceName: string,
  style: string,
  maxRetries = 2
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text,
                speechMetadata: {
                  style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const audioPart = parts.find((part) => part.inlineData?.data);
      const base64Audio = audioPart?.inlineData?.data;

      if (!base64Audio) {
        throw new Error("EMPTY_AUDIO_RESPONSE");
      }

      return base64Audio;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isTransient =
        message.includes("503") ||
        message.includes("500") ||
        message.includes("UNAVAILABLE") ||
        message.includes("ECONNRESET");

      if (!isTransient || attempt === maxRetries) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, 600 * Math.pow(2, attempt)));
    }
  }

  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/api/tts", async (req, res) => {
    try {
      const body = (req.body ?? {}) as TtsRequestBody;
      const rawText = typeof body.text === "string" ? body.text.trim() : "";

      if (!rawText) {
        res.status(400).json({
          error: "O texto da narração não pode estar vazio.",
        });
        return;
      }

      if (rawText.length > 6000) {
        res.status(400).json({
          error: "O texto excede o limite máximo de 6.000 caracteres por narração.",
        });
        return;
      }

      const voiceName =
        typeof body.voiceName === "string" && ALLOWED_MALE_VOICES.has(body.voiceName)
          ? body.voiceName
          : "Charon";

      const style =
        typeof body.style === "string" && body.style.trim().length > 0
          ? body.style.trim().slice(0, 400)
          : "Locução institucional em português brasileiro (pt-BR), voz masculina grave, acolhedora, segura e inspiradora, com dicção clara e pausas naturais para vídeo institucional universitário.";

      const includeBreaths = body.includeBreaths !== false;
      const formattedText = prepareNarrationText(rawText, includeBreaths);

      const ai = createAiClient();
      const base64Audio = await generateSpeechWithRetry(ai, formattedText, voiceName, style);

      res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
        voiceName,
        model: "gemini-3.8-flash-tts",
      });
    } catch (err) {
      const apiStatus =
        typeof err === "object" && err !== null && "status" in err
          ? Number((err as { status?: unknown }).status)
          : undefined;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[/api/tts] Error:", apiStatus, message);

      if (
        message === "MISSING_API_KEY" ||
        apiStatus === 403 ||
        message.includes("API_KEY_INVALID") ||
        message.includes("PERMISSION_DENIED")
      ) {
        res.status(403).json({
          error:
            "Chave de API ausente ou inválida. Verifique a configuração de GEMINI_API_KEY no painel Settings > Secrets.",
        });
        return;
      }

      if (apiStatus === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        res.status(429).json({
          error:
            "Limite de requisições temporariamente atingido. Aguarde alguns instantes e tente gerar a narração novamente.",
        });
        return;
      }

      if (message === "EMPTY_AUDIO_RESPONSE") {
        res.status(502).json({
          error:
            "O serviço de voz não retornou dados de áudio para este texto. Tente ajustar a pontuação ou gerar novamente.",
        });
        return;
      }

      if (apiStatus === 400 || apiStatus === 404) {
        res.status(apiStatus).json({
          error: `Erro na requisição de voz (${apiStatus}): ${message}`,
        });
        return;
      }

      res.status(500).json({
        error: `Não foi possível gerar a narração neste momento (${apiStatus ?? "erro interno"}): ${message}`,
      });
    }
  });

  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req, res) => {
      const indexPath = path.join(distDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("Build not found. Run npm run build first.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
