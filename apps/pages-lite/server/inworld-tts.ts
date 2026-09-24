const INWORLD_API = "https://api.inworld.ai/tts/v1/voice";
const MAX_TEXT = 1000;
const INWORLD_TTS_MODEL = "inworld-tts-2";
const INWORLD_TTS_VOICE_ID = "default-vwouu8eisiomvrhgrm3pzq__c3";

export function getInworldApiKey(): string | undefined {
  const raw = Deno.env.get("INWORLD_API_KEY")?.trim();
  return raw || undefined;
}

export async function synthesizeInworldSpeech(options: {
  text: string;
  language?: string;
  voiceId?: string;
  modelId?: string;
}): Promise<Uint8Array> {
  const apiKey = getInworldApiKey();
  if (!apiKey) {
    throw new Error("INWORLD_API_KEY is not set on the server");
  }

  const text = options.text.trim();
  if (!text) throw new Error("text is required");
  if (text.length > MAX_TEXT) {
    throw new Error(`text exceeds ${MAX_TEXT} characters`);
  }

  const res = await fetch(INWORLD_API, {
    method: "POST",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId: options.voiceId ?? INWORLD_TTS_VOICE_ID,
      modelId: options.modelId ?? INWORLD_TTS_MODEL,
      language: options.language ?? "en",
      audioConfig: {
        audioEncoding: "MP3",
        sampleRateHertz: 24000,
      },
    }),
  });

  const bodyText = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new Error(
      res.ok ? "Invalid JSON from Inworld" : `${res.status} ${bodyText.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message || (json.message as string) || res.statusText);
  }

  const b64 =
    (json.audioContent ?? (json.result as { audioContent?: string } | undefined)?.audioContent) as
      | string
      | undefined;
  if (!b64) throw new Error("Inworld response missing audioContent");

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
