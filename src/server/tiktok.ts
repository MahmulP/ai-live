import { ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent } from "tiktok-live-connector";
import type { TikTokStatus } from "../shared/protocol";
import type { LiveEvent } from "./events";
import { speakableName } from "./text";

type Options = {
  username: string;
  signApiKey?: string;
  onEvent: (event: LiveEvent) => void;
  onStatus: (status: TikTokStatus) => void;
  /** Current number of people watching. */
  onViewers: (count: number) => void;
};

const OFFLINE_RETRY_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Reads chat, gifts and follows from a TikTok LIVE room and keeps reconnecting.
 * Uses the unofficial tiktok-live-connector library (TikTok has no public chat API),
 * so expect occasional breakage when TikTok changes its protocol.
 */
export function connectTikTok({ username, signApiKey, onEvent, onStatus, onViewers }: Options) {
  const connection = new TikTokLiveConnection(username, {
    signApiKey: signApiKey || undefined,
    processInitialData: false,
  });
  let attempt = 0;
  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;

  // In the v3 protocol types the @username is `displayId`.
  const user = (u?: { displayId?: string; nickname?: string }) => ({
    userId: u?.displayId || "unknown",
    nickname: speakableName(u?.nickname, u?.displayId),
  });

  connection.on(WebcastEvent.CHAT, (data) => {
    // The library README still documents `comment`; the current types use `content`.
    const text = data.content || (data as { comment?: string }).comment;
    if (!text) return;
    onEvent({ kind: "chat", ...user(data.user), text, at: Date.now() });
  });

  connection.on(WebcastEvent.GIFT, (data) => {
    // Streakable gifts fire repeatedly while the streak runs; thank once when it ends.
    const streakable = data.gift?.type === 1 || data.gift?.combo;
    if (streakable && !data.repeatEnd) return;
    onEvent({
      kind: "gift",
      ...user(data.user),
      giftName: data.gift?.name || "gift",
      count: data.repeatCount || 1,
      at: Date.now(),
    });
  });

  connection.on(WebcastEvent.FOLLOW, (data) => {
    onEvent({ kind: "follow", ...user(data.user), at: Date.now() });
  });

  connection.on(WebcastEvent.MEMBER, (data) => {
    if (data.memberCount > 0) onViewers(data.memberCount);
    // 1 = MEMBER_MESSAGE_ACTION_JOINED; other actions (e.g. subscribed) aren't arrivals.
    if (data.action === 1) onEvent({ kind: "join", ...user(data.user), at: Date.now() });
  });

  connection.on(WebcastEvent.ROOM_USER, (data) => {
    // The v3 types carry the live viewer count as the string `total`; older docs call it `viewerCount`.
    const count = Number(data.total || (data as { viewerCount?: number }).viewerCount);
    if (Number.isFinite(count)) onViewers(count);
  });

  connection.on(ControlEvent.DISCONNECTED, () => {
    if (stopped) return;
    console.warn("[tiktok] terputus, mencoba sambung ulang...");
    onStatus("disconnected");
    schedule(backoff());
  });

  const backoff = () => Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** attempt++);

  const schedule = (ms: number) => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, ms);
  };

  async function connect() {
    if (stopped) return;
    onStatus("connecting");
    try {
      const state = await connection.connect();
      attempt = 0;
      console.info(`[tiktok] tersambung ke @${username} (room ${state.roomId})`);
      onStatus("connected");
    } catch (err) {
      if (err instanceof UserOfflineError) {
        console.info(`[tiktok] @${username} belum live, cek lagi dalam ${OFFLINE_RETRY_MS / 1000} detik`);
        onStatus("offline");
        schedule(OFFLINE_RETRY_MS);
      } else {
        const wait = backoff();
        console.error(`[tiktok] gagal tersambung (${(err as Error).message}), coba lagi dalam ${wait / 1000} detik`);
        onStatus("disconnected");
        schedule(wait);
      }
    }
  }

  void connect();

  return {
    async stop() {
      stopped = true;
      clearTimeout(retryTimer);
      await connection.disconnect();
    },
  };
}
