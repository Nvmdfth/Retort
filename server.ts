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
    handle(req, res);
  });

  setupSocketServer(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(`> Retort live on http://${hostname}:${port}`);
  });
});
