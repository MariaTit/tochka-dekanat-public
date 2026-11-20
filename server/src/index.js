import app from './app.js';

const HOST = '127.0.0.1';
const PORT = 3001;

const server = app.listen(PORT, HOST, () => {
  console.log(`Сервер «Точка» запущен: http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже занят. Остановите предыдущий экземпляр сервера.`);
  } else {
    console.error('Не удалось запустить сервер:', error.message);
  }

  process.exitCode = 1;
});
