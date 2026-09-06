import { io } from "socket.io-client";
import { PNG } from "pngjs";

const BASE = "http://localhost:3000";

async function login(username) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password" }),
  });
  if (!res.ok) throw new Error(`login ${username} failed`);
  return res.headers.get("set-cookie").split(";")[0];
}

function connect(cookie) {
  return io(BASE, { path: "/socket.io", extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
}

const solidPng = () => {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 30; png.data[i + 1] = 120; png.data[i + 2] = 200; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
};

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };

const aliceCookie = await login("alice");
const bobCookie = await login("bob");

const convRes = await fetch(`${BASE}/api/conversations`, { headers: { Cookie: aliceCookie } });
const { conversations } = await convRes.json();
const convId = conversations[0].id;
console.log(`conversation: ${convId}`);

const alice = connect(aliceCookie);
const bob = connect(bobCookie);
await new Promise((r) => { let n = 0; const d = () => (++n === 2 ? r() : 0); alice.on("connect", d); bob.on("connect", d); });
ok("both sockets connected");

// bob listens for realtime delivery
let bobGot = null;
bob.on("message:new", (m) => { if (m.body === "hello from alice") bobGot = m; });

// 1. basic send + realtime fanout
const send = (sock, input) => new Promise((res) => sock.emit("message:send", input, res));
const cid1 = "smoke_" + Date.now();
const a1 = await send(alice, { conversationId: convId, clientId: cid1, kind: "TEXT", body: "hello from alice" });
a1.ok ? ok("text message accepted") : bad("text message rejected: " + JSON.stringify(a1));
await new Promise((r) => setTimeout(r, 400));
bobGot ? ok("bob received message in real time") : bad("bob did NOT receive message");

// 2. idempotency — same clientId returns same row, no duplicate
const a2 = await send(alice, { conversationId: convId, clientId: cid1, kind: "TEXT", body: "hello from alice" });
a2.ok && a2.message.id === a1.message.id ? ok("duplicate clientId is idempotent") : bad("idempotency broken");

// 3. profanity block (with evasion)
const p = await send(alice, { conversationId: convId, clientId: "smoke_p_" + Date.now(), kind: "TEXT", body: "you are a f u c k i n g idiot" });
!p.ok && p.code === "PROFANITY" ? ok("spaced-out profanity blocked") : bad("profanity NOT blocked: " + JSON.stringify(p));

const p2 = await send(alice, { conversationId: convId, clientId: "smoke_p2_" + Date.now(), kind: "TEXT", body: "ShIiIt!!" });
!p2.ok && p2.code === "PROFANITY" ? ok("leet/repeat profanity blocked") : bad("profanity variant NOT blocked: " + JSON.stringify(p2));

const clean = await send(alice, { conversationId: convId, clientId: "smoke_c_" + Date.now(), kind: "TEXT", body: "this assignment is going well, class!" });
clean.ok ? ok("clean message with allowlisted words passes") : bad("false positive: " + JSON.stringify(clean));

// 4. cross-conversation authorization
const bogus = await send(bob, { conversationId: "does-not-exist", clientId: "x" + Date.now(), kind: "TEXT", body: "hi" });
!bogus.ok && bogus.code === "FORBIDDEN" ? ok("send to non-member conversation forbidden") : bad("authorization hole: " + JSON.stringify(bogus));

// 5. image upload + moderation pipeline (benign image should pass)
const form = new FormData();
form.append("file", new Blob([solidPng()], { type: "image/png" }), "test.png");
form.append("conversationId", convId);
form.append("clientId", "smoke_img_" + Date.now());
const up = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { Cookie: aliceCookie }, body: form });
const upJson = await up.json();
up.ok && upJson.message?.kind === "IMAGE" ? ok("benign image passed moderation + delivered") : bad("image upload failed: " + up.status + " " + JSON.stringify(upJson));

// 6. reject non-image bytes disguised as png
const form2 = new FormData();
form2.append("file", new Blob([Buffer.from("not an image")], { type: "image/png" }), "evil.png");
form2.append("conversationId", convId);
form2.append("clientId", "smoke_bad_" + Date.now());
const up2 = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { Cookie: aliceCookie }, body: form2 });
up2.status === 400 ? ok("fake image (bad magic bytes) rejected") : bad("magic-byte check failed: " + up2.status);

alice.disconnect();
bob.disconnect();
console.log(process.exitCode ? "\nSMOKE FAILED" : "\nALL SMOKE CHECKS PASSED");
setTimeout(() => process.exit(process.exitCode ?? 0), 200);
