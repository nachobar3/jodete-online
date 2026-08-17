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
// Print de IPs LAN: solo comodidad para desarrollo. networkInterfaces() usa un socket
// netlink, que puede fallar bajo sandboxes que restringen familias de address (systemd
// RestrictAddressFamilies) — nunca debe tumbar el server, así que va en try/catch.
try {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`[jodete]   LAN: ws://${a.address}:${port}  (${name})`);
      }
    }
  }
} catch {
  /* sin info de LAN (p.ej. netlink restringido); irrelevante en producción */
}
