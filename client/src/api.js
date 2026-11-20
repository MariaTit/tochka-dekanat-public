export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Tochka-Request': '1', ...options.headers },
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(data?.error || 'Сервер недоступен. Попробуйте ещё раз.', response.status);
    if (!data) throw new Error('Некорректный ответ сервера. Попробуйте ещё раз.');
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.');
  } finally { clearTimeout(timeout); }
}
