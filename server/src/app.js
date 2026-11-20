import express from 'express';
import healthRouter from './routes/health.js';

const app = express();

app.disable('x-powered-by');
app.use('/api/health', healthRouter);

app.use('/api', (request, response) => {
  response.status(404).json({ error: 'Маршрут API не найден' });
});

export default app;
