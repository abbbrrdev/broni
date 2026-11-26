// ═══════════════════════════════════════════════════════════
//  T A S K S   R O U T E S  —  API-эндпоинты задач
// ═══════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { logger } from '../../utils/logger';
import * as tasksService from './tasks.service';

export const tasksRoutes = new Elysia({ prefix: '/api' })

  // ─── Обработка запроса пользователя ───────────────────────
  .post('/process-request', async ({ body }) => {
    try {
      const { name, number, text, city } = body;
      logger.info('Request', `${name}: "${text}" (${city})`);

      const user = await tasksService.findOrCreateUser(name, number, city);
      const processed = await tasksService.processRequest(text, city);
      const task = await tasksService.createTask(user.id, text, processed);

      return {
        success: true,
        taskId: task.id,
        task: {
          placeName: processed.placeName,
          placeNumber: processed.placeNumber,
          address: processed.address,
          time: processed.time,
          additionalInfo: processed.additionalInfo,
        },
        message: 'Задача создана. Ожидайте подтверждения.',
      };
    } catch (error) {
      logger.error('Request', 'Processing failed', error);
      return { success: false, error: 'Произошла ошибка при обработке запроса' };
    }
  }, {
    body: t.Object({
      name: t.String(),
      number: t.String(),
      text: t.String(),
      city: t.String(),
    }),
  })

  // ─── Список задач пользователя ────────────────────────────
  .get('/tasks/:userId', async ({ params }) => {
    return { success: true, tasks: await tasksService.getUserTasks(params.userId) };
  })

  // ─── Утверждение задачи → запуск звонка ───────────────────
  .put('/tasks/:taskId/approve', async ({ params }) => {
    try {
      const { task, called } = await tasksService.approveTask(params.taskId);
      return {
        success: true,
        task,
        message: called ? 'Задача утверждена и выполняется звонок' : 'Задача утверждена',
      };
    } catch (error) {
      logger.error('Tasks', 'Approve failed', error);
      return { success: false, error: 'Произошла ошибка при утверждении задачи' };
    }
  })

  // ─── Отклонение задачи ────────────────────────────────────
  .put('/tasks/:taskId/reject', async ({ params }) => {
    const task = await tasksService.rejectTask(params.taskId);
    return { success: true, task, message: 'Задача отклонена' };
  })

  // ─── Результат задачи (статус звонка) ─────────────────────
  .get('/task-result/:taskId', async ({ params }) => {
    const result = await tasksService.getTaskResult(params.taskId);
    if (!result) return { success: false, error: 'Задача не найдена' };
    return { success: true, ...result };
  });
