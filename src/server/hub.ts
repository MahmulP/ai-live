import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ClientRole, ServerMessage } from "../shared/protocol";

/** `speaker` is null until the page has been told its voice state. */
type Client = { role: ClientRole; joinedAt: number; speaker: boolean | null };

/** WebSocket link to every open avatar page (OBS browser source, preview tabs). */
export class Hub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, Client>();
  /** Latest message of each sticky type, replayed to pages that connect later. */
  private readonly sticky = new Map<ServerMessage["type"], ServerMessage>();
  private readonly playbackWaiters = new Map<string, () => void>();
  private readonly handlers: ((msg: ClientMessage) => void)[] = [];
  private speaker: WebSocket | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket) => {
      this.clients.set(socket, { role: "debug", joinedAt: Date.now(), speaker: null });
      for (const msg of this.sticky.values()) socket.send(JSON.stringify(msg));
      this.electSpeaker();

      socket.on("close", () => {
        this.clients.delete(socket);
        this.electSpeaker();
      });
      socket.on("message", (data) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        if (msg?.type === "join") {
          const client = this.clients.get(socket);
          if (client) client.role = msg.role === "broadcast" ? "broadcast" : "debug";
          this.electSpeaker();
          return;
        }
        if (msg?.type === "playback-idle") {
          // Only the page that actually plays the sound decides when a reply has finished.
          if (socket === this.speaker) this.playbackWaiters.get(msg.replyId)?.();
          return;
        }
        for (const handler of this.handlers) handler(msg);
      });
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  onMessage(handler: (msg: ClientMessage) => void): void {
    this.handlers.push(handler);
  }

  broadcast(msg: ServerMessage, opts: { sticky?: boolean } = {}): void {
    if (opts.sticky) this.sticky.set(msg.type, msg);
    const data = JSON.stringify(msg);
    for (const socket of this.clients.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  /** Resolves when the speaking page reports it finished playing the reply, or after timeoutMs. */
  waitForPlayback(replyId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.playbackWaiters.delete(replyId);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.playbackWaiters.set(replyId, done);
    });
  }

  close(): void {
    for (const socket of this.clients.keys()) socket.terminate();
    this.wss.close();
  }

  /**
   * Picks the one page that plays sound: the broadcast page (what OBS captures)
   * beats ?debug pages, and among equals the longest-connected page keeps the voice,
   * so opening a preview tab never silences the stream.
   */
  private electSpeaker() {
    let best: [WebSocket, Client] | null = null;
    for (const entry of this.clients) {
      const [, c] = entry;
      if (
        !best ||
        (c.role === "broadcast" && best[1].role !== "broadcast") ||
        (c.role === best[1].role && c.joinedAt < best[1].joinedAt)
      ) {
        best = entry;
      }
    }
    this.speaker = best?.[0] ?? null;
    for (const [socket, client] of this.clients) {
      const speaker = socket === this.speaker;
      if (client.speaker === speaker) continue;
      client.speaker = speaker;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "voice", speaker }));
    }
  }
}
