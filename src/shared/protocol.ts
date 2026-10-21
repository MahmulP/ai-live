// Messages exchanged between the backend and the avatar page over /ws.

export type TikTokStatus = "off" | "connecting" | "connected" | "offline" | "disconnected";

/** "audio": the server sends MP3 per sentence. "browser": the page speaks with the Web Speech API. */
export type TtsMode = "audio" | "browser";

/** "broadcast": the clean page OBS captures. "debug": a page opened with ?debug. */
export type ClientRole = "broadcast" | "debug";

/** Expression the avatar plays when it starts answering. */
export type Mood = "neutral" | "curious" | "happy" | "wave";

export type ServerMessage =
  | { type: "hello"; aiName: string; ttsMode: TtsMode }
  /** Only one open page plays sound, so two tabs never talk over each other. */
  | { type: "voice"; speaker: boolean }
  | {
      type: "stats";
      spamBlocked: number;
      queued: number;
      tiktok: TikTokStatus;
      tiktokUser: string | null;
      /** null until TikTok reports a count. */
      viewers: number | null;
      spentTodayUsd: number;
      /** 0 = no limit. */
      dailyLimitUsd: number;
    }
  | { type: "chat-log"; nickname: string; text: string; status: string }
  | { type: "reply-start"; replyId: string; caption: string | null; mood: Mood }
  | {
      type: "utterance";
      replyId: string;
      index: number;
      text: string;
      /** Base64 audio. Missing when TTS is in browser mode or the TTS call failed. */
      audio?: string;
      mime?: string;
    }
  | { type: "reply-end"; replyId: string };

export type DebugEvent =
  | { kind: "chat"; nickname: string; text: string }
  | { kind: "gift"; nickname: string; giftName: string; count: number }
  | { kind: "follow"; nickname: string }
  | { kind: "join"; nickname: string };

export type ClientMessage =
  | { type: "join"; role: ClientRole }
  | { type: "playback-idle"; replyId: string }
  | { type: "debug-event"; event: DebugEvent };
