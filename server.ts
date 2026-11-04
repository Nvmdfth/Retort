import { createServer } from 'http';
import next from 'next';
import { setupSocketServer } from './src/server/socketServer';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '9847', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    handle(req, res);
  });

  const socketServer = setupSocketServer(httpServer);

  // Tell connected clients the restart is intentional instead of dropping them silently
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      socketServer.shutdown();
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }

  httpServer.listen(port, hostname, () => {
    console.log(`> Retort live on http://${hostname}:${port}`);
  });
});
