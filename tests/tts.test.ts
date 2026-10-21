import { afterEach, describe, expect, it, vi } from "vitest";
import { createTts, type TtsConfig } from "../src/server/tts";

const eleven = (model: string): TtsConfig => ({
  provider: "elevenlabs",
  key: "test-key",
  voiceId: "voice123",
  model,
  voiceSettings: { stability: 0.45, similarity_boost: 0.75, style: 0, speed: 1 },
});

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("ElevenLabs TTS", () => {
  it("sends Indonesian, voice settings and the previous sentence", async () => {
    const fetchMock = stubFetch();
    const audio = await createTts(eleven("eleven_v4_turbo")).synthesize("Apa kabar kau?", "Horas kawan!");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Apa kabar kau?",
      model_id: "eleven_v4_turbo",
      language_code: "id",
      previous_text: "Horas kawan!",
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0, speed: 1 },
    });
    expect(audio?.audio.length).toBe(3);
  });

  it("leaves out language_code for multilingual_v2, which rejects it", async () => {
    const fetchMock = stubFetch();
    await createTts(eleven("eleven_multilingual_v2")).synthesize("Horas!");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("language_code");
    expect(body).not.toHaveProperty("previous_text");
  });

  it("surfaces API errors with the status code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid api key", { status: 401 })));
    await expect(createTts(eleven("eleven_v4_turbo")).synthesize("Horas!")).rejects.toThrow("ElevenLabs TTS 401");
  });
});
