// ═══════════════════════════════════════════════════════════
//  E N T R Y   P O I N T
// ═══════════════════════════════════════════════════════════

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { prisma } from './lib/db';
import { config } from './config';
import { tasksRoutes } from './modules/tasks/tasks.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { companiesRoutes } from './modules/companies/companies.routes';
import { connectAri } from './integrations/asterisk';
import { logger } from './utils/logger';

const app = new Elysia()
  .use(cors())
  .onError(({ code, error }) => {
    logger.error('API', `Error [${code}]`, error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message || 'Internal Server Error' };
  })
  .onBeforeHandle(({ request }) => {
    // Разрешаем доступ без токена только к корневому маршруту (Healthcheck)
    const url = new URL(request.url);
    if (url.pathname === '/') return;
    if (url.pathname.startsWith('/api/auth')) return;
    if (url.pathname.startsWith('/api/companies')) return;
    if (url.pathname.startsWith('/api/recordings')) return;

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.split(' ')[1];
    if (token !== config.apiSecret) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden: Invalid Token' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  })
  .ws('/api/ws', {
    // Авторизация WebSocket (опционально можно проверять токен)
    open(ws) {
      logger.info('WS', `Client connected: ${ws.id}`);
      ws.subscribe('dashboard_updates'); // Глобальная комната для обновлений
    },
    message(ws, message) {
      // Можно обрабатывать сообщения от клиента
    },
    close(ws) {
      logger.info('WS', `Client disconnected: ${ws.id}`);
      ws.unsubscribe('dashboard_updates');
    }
  })
  .use(tasksRoutes)
  .use(authRoutes)
  .use(companiesRoutes)
  .get('/api/recordings/:filename', ({ params: { filename } }) => {
    const filePath = `${process.cwd()}/asterisk/recordings/${filename}`;
    return Bun.file(filePath);
  })
  .get('/', () => ({
    message: 'AI Assistant API',
    version: '2.1.0',
  }))
  .listen(3001);

// Экспортируем функцию для отправки WS ивентов из других модулей
export function broadcastWsEvent(event: any) {
  if (app.server) {
    app.server.publish('dashboard_updates', JSON.stringify(event));
  }
}

console.log(`🤖 AI Assistant API v2.0 — http://${app.server?.hostname}:${app.server?.port} [Asterisk Backend]`);

// Подключить ARI WebSocket
connectAri();

