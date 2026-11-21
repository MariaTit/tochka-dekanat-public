import { createApp } from './app.js';
import { config, validateConfig } from './config.js';
import { openDatabase } from './db/database.js';

const HOST = config.host;
console.log(`Режим запуска: ${config.production ? 'production' : 'development'} (NODE_ENV=production: ${process.env.NODE_ENV === 'production'}; AMVERA=1: ${process.env.AMVERA === '1'}; Secure cookies: ${config.production}; trust proxy: ${config.trustProxy})`);
validateConfig();
const db = openDatabase(config.databasePath);
const app = await createApp(db, config);
const PORT = config.port;

const server = app.listen(PORT, HOST, () => {
  console.log(`Сервер «Точка» запущен: http://127.0.0.1:${server.address().port} (прослушивание ${HOST})`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже занят. Остановите предыдущий экземпляр сервера.`);
  } else {
    console.error('Не удалось запустить сервер:', error.message);
  }

  process.exitCode = 1;
  db.close();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => { db.close(); }));
}
