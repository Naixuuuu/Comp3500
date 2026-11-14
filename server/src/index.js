import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PORT, WEB_DIR } from './config.js';
import { openDb, seedIfEmpty } from './db.js';
import { HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import electionRoutes, { receiptRouter } from './routes/elections.js';
import resultRoutes, { auditRouter } from './routes/results.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/elections', electionRoutes);
  app.use('/api/receipt', receiptRouter);
  app.use('/api/results', resultRoutes);
  app.use('/api/audit', auditRouter);
  app.use('/api/admin', adminRoutes);

  // Serve the built Vue client when it exists, so the API and the UI share one origin.
  if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
    app.use(express.static(WEB_DIR));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(WEB_DIR, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_json' });
    }
    console.error('[unhandled]', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

export function boot() {
  openDb();
  seedIfEmpty();
  const app = createApp();
  return app.listen(PORT, () => {
    console.log(`Election system API listening on http://localhost:${PORT}`);
  });
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  boot();
}
