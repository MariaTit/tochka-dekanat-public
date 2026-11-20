import { Router } from 'express';

const router = Router();

router.get('/', (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ status: 'ok' });
});

export default router;
