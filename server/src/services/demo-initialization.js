import { createDemoUsers } from './demo-users.js';
import { createDemoSchedule } from './demo-schedule.js';
import { createDemoGrades } from './demo-grades.js';

export async function initializeDemoData(db, env = process.env) {
  // Только точное true разрешает заполнение. Секреты сами по себе его не включают.
  if (env.DEMO_INIT_ENABLED !== 'true') return;
  const accounts = await createDemoUsers(db, { passwords: {
    student1: env.DEMO_STUDENT1_PASSWORD,
    student2: env.DEMO_STUDENT2_PASSWORD,
    staff: env.DEMO_STAFF_PASSWORD,
  } });
  // Существующие транзакционные импорты с маркерами не дублируют и не перезаписывают данные.
  const lessons = createDemoSchedule(db);
  const results = createDemoGrades(db);
  // В результат не попадают пароли или хеши.
  return { users: accounts.length, lessons, results };
}

export async function runDemoInitialization(db) {
  try {
    const result = await initializeDemoData(db);
    if (result) {
      console.log(`Демоинициализация завершена: новых пользователей — ${result.users}; занятий — ${result.lessons}; результатов — ${result.results}. Существующие записи не изменены. Отключите DEMO_INIT_ENABLED и удалите DEMO_*_PASSWORD из окружения.`);
    } else {
      console.log('Демоинициализация отключена (DEMO_INIT_ENABLED не равен true).');
    }
    return true;
  } catch {
    // Не выводим исходное исключение: ошибка SQLite может содержать значения полей.
    console.error('Демоинициализация не завершена. Проверьте DEMO_STUDENT1_PASSWORD, DEMO_STUDENT2_PASSWORD, DEMO_STAFF_PASSWORD (12–256 символов для новых аккаунтов), группы ИС-21/ЭК-22 и доступность SQLite. Существующие аккаунты не изменены; выполненные этапы сохранены. После исправления повторите запуск.');
    return false;
  }
}
