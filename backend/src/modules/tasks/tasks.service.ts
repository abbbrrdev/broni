// ═══════════════════════════════════════════════════════════
//  T A S K S   S E R V I C E  —  бизнес-логика задач
// ═══════════════════════════════════════════════════════════

import { callGemini } from '../../integrations/gemini';
import { initiateCall as asteriskCall } from '../../integrations/asterisk';
import { extractJson } from '../../utils/json';
import { logger } from '../../utils/logger';
import { prisma, type User, type Task } from '../../lib/db';
import type { ProcessedTask } from '../../types';

// ─── Поиск заведения через Gemini ─────────────────────────

const SEARCH_PROMPT = (userText: string, city: string) => `
Найди информацию о заведении в городе ${city}.

ЗАПРОС: "${userText}"

ИСПОЛЬЗУЙ Google Search для поиска. Попробуй разные варианты:
1. Ищем точное название
2. Ищем по типу заведения + улица
3. Ищем по ключевым словам

Если НАШЕЛ заведение - верни:
{
  "taskName": "Запись/Бронирование",
  "placeName": "Полное название заведения",
  "placeNumber": "Актуальный телефон",
  "address": "Полный адрес",
  "time": "Время из запроса",
  "additionalInfo": "Детали"
}

Если НЕ НАШЕЛ - попробуй найти ПОХОЖИЕ варианты и верни с additionalInfo уточнением.
Ищи активно! Не сдавайся сразу!
`;

const FALLBACK_TASK: ProcessedTask = {
  taskName: 'Обработка запроса',
  placeName: 'Не найдено',
  placeNumber: undefined,
  address: 'Уточните адрес заведения',
  time: 'Не указано',
  additionalInfo: 'Не удалось найти заведение. Проверьте название и адрес.',
};

export async function processRequest(userText: string, city: string): Promise<ProcessedTask> {
  try {
    const text = await callGemini(SEARCH_PROMPT(userText, city), {
      temperature: 0.1,
      maxOutputTokens: 1000,
      useSearch: true,
    });

    const result = extractJson<ProcessedTask>(text);
    if (result) return result;

    logger.warn('Tasks', 'JSON extraction failed, raw response:', text.substring(0, 200));
    return { ...FALLBACK_TASK, additionalInfo: `Не удалось разобрать ответ. Запрос: ${userText}` };
  } catch (error) {
    logger.error('Tasks', 'Gemini search failed', error);
    return { ...FALLBACK_TASK, additionalInfo: `Не удалось найти: ${userText}` };
  }
}

// ─── Создание / обновление пользователя ───────────────────

export async function findOrCreateUser(name: string, number: string, city: string): Promise<User> {
  let user = await prisma.user.findUnique({ where: { number } });

  if (!user) {
    user = await prisma.user.create({
      data: { name, number, city },
    });
  } else {
    user = await prisma.user.update({
      where: { number },
      data: { name, city },
    });
  }

  return user;
}

// ─── Создание задачи ──────────────────────────────────────

export async function createTask(userId: string, originalText: string, processed: ProcessedTask): Promise<Task> {
  const task = await prisma.task.create({
    data: {
      userId,
      originalText,
      taskName: processed.taskName,
      placeName: processed.placeName,
      placeNumber: processed.placeNumber,
      address: processed.address,
      time: processed.time,
      additionalInfo: processed.additionalInfo,
      status: 'PENDING',
    },
  });

  return task;
}

// ─── Утверждение задачи → звонок ──────────────────────────

export async function approveTask(taskId: string): Promise<{ task: Task | null; called: boolean }> {
  let task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { task: null, called: false };

  task = await prisma.task.update({
    where: { id: taskId },
    data: { status: 'APPROVED' },
  });

  let called = false;
  if (task.placeNumber) {
    try {
      called = await asteriskCall(task.id, task.placeNumber, task);
    } catch (err) {
      logger.error('Tasks', 'Call initiation failed', err);
    }
  }

  return { task, called };
}

// ─── Отклонение задачи ────────────────────────────────────

export async function rejectTask(taskId: string): Promise<Task | null> {
  let task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return null;

  task = await prisma.task.update({
    where: { id: taskId },
    data: { status: 'REJECTED' },
  });
  return task;
}

// ─── Список задач пользователя ────────────────────────────

export async function getUserTasks(userId: string) {
  return await prisma.task.findMany({
    where: { userId },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Получить результат задачи ────────────────────────────

export async function getTaskResult(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return null;

  return {
    taskId: task.id,
    placeName: task.placeName,
    time: task.time,
    callStatus: task.callStatus || 'unknown',
    outcome: task.callOutcome || 'PENDING',
    summary: task.callSummary || 'Звонок ещё не завершён',
    recordingUrl: task.recordingUrl || null,
  };
}
