import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ClientRole, ServerMessage } from "../src/shared/protocol";
import { Hub } from "../src/server/hub";

type Page = { socket: WebSocket; speaker: () => boolean | undefined };

let server: Server;
let hub: Hub;
const pages: WebSocket[] = [];

async function start() {
  server = createServer();
  hub = new Hub(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
}

async function openPage(role: ClientRole): Promise<Page> {
  const { port } = server.address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  pages.push(socket);
  let speaker: boolean | undefined;
  socket.on("message", (data) => {
    const msg = JSON.parse(String(data)) as ServerMessage;
    if (msg.type === "voice") speaker = msg.speaker;
  });
  await new Promise((r) => socket.once("open", r));
  socket.send(JSON.stringify({ type: "join", role }));
  await settle();
  return { socket, speaker: () => speaker };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

afterEach(async () => {
  for (const p of pages.splice(0)) p.close();
  hub.close();
  await new Promise((r) => server.close(r));
});

describe("Hub speaker election", () => {
  it("lets only one page talk", async () => {
    await start();
    const a = await openPage("debug");
    const b = await openPage("debug");
    expect([a.speaker(), b.speaker()]).toEqual([true, false]);
  });

  it("gives the voice to the broadcast page over debug pages", async () => {
    await start();
    const preview = await openPage("debug");
    const obs = await openPage("broadcast");
    expect([preview.speaker(), obs.speaker()]).toEqual([false, true]);

    // Opening another preview must not silence the stream.
    const another = await openPage("debug");
    expect([obs.speaker(), another.speaker()]).toEqual([true, false]);
  });

  it("hands the voice over when the speaking page closes", async () => {
    await start();
    const a = await openPage("debug");
    const b = await openPage("debug");
    a.socket.close();
    await settle();
    expect(b.speaker()).toBe(true);
  });

  it("only counts playback-idle from the speaking page", async () => {
    await start();
    const speaking = await openPage("debug");
    const silent = await openPage("debug");
    let finished = false;
    const wait = hub.waitForPlayback("r1", 2000).then(() => (finished = true));

    silent.socket.send(JSON.stringify({ type: "playback-idle", replyId: "r1" }));
    await settle();
    expect(finished).toBe(false);

    speaking.socket.send(JSON.stringify({ type: "playback-idle", replyId: "r1" }));
    await wait;
    expect(finished).toBe(true);
  });
});
