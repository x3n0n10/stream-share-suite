import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { reconnectVpn } from "../src/gluetunClient.js";

let server;
let gluetun;
let status = "running";
let stops = 0;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "PUT") {
        status = JSON.parse(body).status;
        if (status === "stopped") stops += 1;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  gluetun = {
    url: `http://127.0.0.1:${server.address().port}`,
    apiKey: "",
    basicAuth: null,
    statusPath: "/v1/vpn/status",
    timeoutMs: 2000,
    reconnectTimeoutMs: 5000,
  };
});

after(() => server.close());

test("concurrent reconnects share one stop/start cycle", async () => {
  stops = 0;
  const [a, b] = await Promise.all([reconnectVpn(gluetun), reconnectVpn(gluetun)]);
  assert.equal(stops, 1);
  assert.deepEqual(a, b);

  // Once it has finished, the next call starts a fresh cycle.
  await reconnectVpn(gluetun);
  assert.equal(stops, 2);
});
