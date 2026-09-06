import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { Server as IOServer } from "socket.io";
import { env } from "./src/lib/env";
import { registerSocketHandlers } from "./src/lib/socket/handlers";
import { setIO, type TypedServer } from "./src/lib/socket/io";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: env.HOSTNAME, port: env.PORT });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  const io: TypedServer = new IOServer(server, {
    path: "/socket.io",
    cors: { origin: env.APP_ORIGIN, credentials: true },
    // survive brief network blips without dropping the session
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
  });

  setIO(io);
  registerSocketHandlers(io);

  server.listen(env.PORT, () => {
    console.log(`\n  ▸ Realtime Messaging ready on ${env.APP_ORIGIN}\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
