import os from 'node:os';
import { createApp } from './app.js';
import { authRequired } from './routes/auth.js';
import { loadConfig } from './config.js';
import { createServices } from './services.js';
import { createLogger } from './util/log.js';

const log = createLogger('server');

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const services = await createServices(config);
  const app = createApp(services);

  const server = app.listen(config.port, config.host, () => {
    log.info(`Home Blockbuster ${config.version} is running`);
    const wildcard = ['0.0.0.0', '::', '0:0:0:0:0:0:0:0'].includes(config.host);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
    log.info(`  Local:   http://localhost:${config.port}`);
    if (wildcard) for (const ip of lanAddresses()) log.info(`  Network: http://${ip}:${config.port}`);
    else if (!loopback) log.info(`  Network: http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`);
    if (!config.webDir) log.warn('Web client not built — run "npm run build" (or "npm run dev" for development).');
    if (config.password) log.info('Password protection is enabled (HB_PASSWORD).');
    else if (authRequired(services)) log.info('Password protection is enabled (set in Settings → Security).');
    else if (!loopback) {
      log.warn('No password is set: anyone on your network can browse server folders and change settings.');
      log.warn('Set one in Settings → Security, or with HB_PASSWORD.');
    }
    log.info(`Data directory: ${config.dataDir}`);
  });
  server.on('error', (err) => {
    log.error(`Could not start the server on port ${config.port}`, err);
    process.exit(1);
  });
  // Long-lived video responses must not be cut by the default request timeout.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  // Pick up changes made while the server was off, then rescan on the configured interval.
  const { scanner, db } = services;
  setTimeout(() => {
    if (services.settings().autoScanMinutes > 0) scanner.enqueueAll();
  }, 3000).unref();
  setInterval(() => {
    const minutes = services.settings().autoScanMinutes;
    if (!minutes) return;
    const now = Date.now();
    for (const lib of db.state.data.libraries) {
      if (!lib.lastScanAt || now - lib.lastScanAt >= minutes * 60_000) scanner.enqueue(lib.id);
    }
  }, 60_000).unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down…`);
    services.streams?.killAll();
    server.close();
    server.closeAllConnections();
    await db.flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Fatal error during startup', err);
  process.exit(1);
});
