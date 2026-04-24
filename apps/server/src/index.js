import http from 'node:http';

const port = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'server' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      name: 'tax-ops',
      status: 'bootstrap',
      message: 'API scaffold is running',
    }),
  );
});

server.listen(port, () => {
  console.log(`tax-ops server listening on :${port}`);
});
