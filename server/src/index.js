import { createApp } from './app.js';
import { config, validateConfig } from './config.js';
import { openDatabase } from './db/database.js';

const HOST = config.host;
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
