/**
 * Prints the example's diagnostic lines. Vega has no readable JS console, so
 * the app sends each line as a GET to the host over the reverse port forward:
 *
 *   npm run beacon
 *   vega device start-port-forwarding --port 8098 --forward false
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.BEACON_PORT ?? 8098);

createServer((req, res) => {
  const msg = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('m');
  if (msg) console.log(`${new Date().toISOString().slice(11, 23)}  ${msg}`);
  res.writeHead(204);
  res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`beacon listening on http://127.0.0.1:${PORT}`));
