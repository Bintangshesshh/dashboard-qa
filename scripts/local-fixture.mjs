import http from "node:http";
const port = Number(process.env.FIXTURE_PORT || 4173);
const server = http.createServer((req, res) => {
  if (req.url === "/api/health") { res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true})); return; }
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="Local QA verification fixture"><title>QA verification fixture</title></head><body><main><h1>QA verification fixture</h1><p>Local-only target for dashboard integration checks.</p><button type="button" onclick="document.querySelector('#result').textContent='Action completed'">Run action</button><p id="result" role="status"></p></main></body></html>`);
});
server.listen(port, "127.0.0.1", () => console.log(`Fixture listening on http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
