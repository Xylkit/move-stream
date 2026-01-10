import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import deploymentsRouter from './routes/deployments.js';
import usersRouter from './routes/users.js';
import syncRouter from './routes/sync.js';
import searchRouter from './routes/search.js';
import { AppError } from './utils/errors.js';

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: NODE_ENV,
  });
});

// API Routes
app.use('/deployments', deploymentsRouter);
app.use('/users', usersRouter);
app.use('/sync', syncRouter);
app.use('/search', searchRouter);

// Error handling
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(err.toJSON());
  }
  
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  res.status(500).json({ error: 'InternalServerError', message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Xylkit Indexer Server`);
  console.log(`   Environment: ${NODE_ENV}`);
  console.log(`   Port: ${PORT}`);
  console.log(`\n📊 Endpoints:`);
  console.log(`   GET  /health`);
  console.log(`   GET  /deployments`);
  console.log(`   GET  /users/:address`);
  console.log(`   POST /sync  (trigger indexing)\n`);
});
