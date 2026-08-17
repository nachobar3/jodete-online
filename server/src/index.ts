import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { networkInterfaces } from "node:os";
import { GameRoom } from "./rooms/GameRoom.js";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

// Una sala = una mesa. Se agrupan por `code` para "unirse por código".
gameServer.define("game", GameRoom).filterBy(["code"]);

gameServer.listen(port);
console.log(`[jodete] server escuchando en el puerto ${port} (todas las interfaces)`);
for (const [name, addrs] of Object.entries(networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) {
      console.log(`[jodete]   LAN: ws://${a.address}:${port}  (${name})`);
    }
  }
}
