// ═══════════════════════════════════════════════════════════
//  C A L L S   S E R V I C E  —  логика телефонных диалогов
// ═══════════════════════════════════════════════════════════

import { callGemini } from '../../integrations/gemini';
import { extractJson } from '../../utils/json';
import { logger } from '../../utils/logger';
import { getHistory, pushEntry, callHistory } from './calls.store';
import type { Task } from '../../lib/db';

// ─── Промпты ──────────────────────────────────────────────

import { broadcastWsEvent } from '../../index';
import { prisma } from '../../lib/db';

const VOICE_START_PROMPT = (input: string) =>
  `Ты ИИ-помощник (виртуальный секретарь), и ты сейчас ЗВОНИШЬ в заведение (ресторан, салон, клиника, сервис). Твоя задача: осуществить бронирование или запись для своего клиента.
Человек, который возьмет трубку — это администратор заведения. НИКОГДА не веди себя как администратор! Ты не должен задавать вопросы "на какое время вас записать", потому что ТЫ звонишь, чтобы записать СВОЕГО клиента.
Поздоровайся и сразу скажи цель звонка, обязательно назвав имя клиента (например: "Здравствуйте! Я виртуальный ассистент моего клиента, его зовут Алексей. Я звоню чтобы...").
Данные для записи/бронирования (используй их!):
${input}
Верни JSON: {"text": "короткий ответ на русском", "completed": false}`;

const VOICE_RESPOND_PROMPT = (input: string, task?: any) => {
  // Передаем ИИ ЛОКАЛЬНОЕ время Казахстана (UTC+5), а не UTC!
  const nowStr = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  // Для парсинга даты при бронировании — используем offset UTC+5
  if (task && task.taskName === 'Входящий звонок B2B') {
    const callerPhone = task.originalText.replace('Входящий звонок от клиента ', '').trim();
    return `Собеседник (клиент) сказал по телефону: "${input}".
ТВОЯ РОЛЬ (ИНСТРУКЦИЯ КОМПАНИИ):
${task.additionalInfo}

ТЕКУЩИЕ ДАТА И ВРЕМЯ: ${nowStr} (обязательно учитывай это при записи!)
ВНИМАНИЕ: Номер телефона клиента — ${callerPhone}. Ты уже знаешь его номер (сработал определитель номера).
ПРАВИЛО 1: НИКОГДА не проси клиента продиктовать номер телефона!
ПРАВИЛО 2: Для подтверждения записи просто скажи: "Я запишу на ваш текущий номер, верно?" (или вообще не спрашивай, используй его по умолчанию).
ПРАВИЛО 3: Обязательно спроси ИМЯ клиента, если не знаешь.

Ответь от имени администратора заведения (коротко, 1-2 предложения, естественно).
Если клиент хочет записаться/забронировать время, и вы четко согласовали время и услугу, верни данные о брони в поле "booking". Используй номер ${callerPhone}.
Если разговор полностью завершен, верни "completed": true.
Верни ТОЛЬКО JSON строго по формату: 
{
  "text": "твой ответ",
  "completed": false,
  "booking": null или {"clientName": "Имя", "clientPhone": "${callerPhone}", "date": "YYYY-MM-DDTHH:mm:ssZ", "service": "Услуга"}
}`;
  }

  return `Собеседник (администратор заведения) сказал тебе по телефону: "${input}". 
Ответь от имени ассистента (коротко, 1-2 предложения, четко по делу). Ты звонишь в заведение, а не наоборот!
Если администратор спрашивает "на чье имя?" — обязательно назови имя клиента из данных задачи. НИКОГДА не придумывай имена от себя.
Если окончательно успешно записали/договорились, или точно отказали (нет мест, закрыто) — верни "completed": true. 
Верни ТОЛЬКО JSON: {"text":"твой ответ (без эмодзи)","completed":false}`;
};

const OUTCOME_PROMPT = (task: Task, dialogue: string) => `
Проанализируй следующий телефонный разговор и определи его итог.

Заведение: ${task.placeName}
Задача: ${task.taskName} на ${task.time || 'неизвестное время'}

ДИАЛОГ:
${dialogue || 'Диалог не был записан (звонок не состоялся)'}

Верни строго JSON без маркдауна:
{
  "status": "BOOKED" | "REJECTED" | "UNCLEAR",
  "summary": "Краткое описание итога на русском языке (1-2 предложения)"
}

- BOOKED: администратор подтвердил бронирование/запись
- REJECTED: администратор отказал (мест нет, не работают и т.д.)
- UNCLEAR: разговор прервался, итог неясен`;

// ─── Типы ─────────────────────────────────────────────────

interface VoiceReply {
  text: string;
  completed: boolean;
}

interface CallOutcome {
  status: 'BOOKED' | 'REJECTED' | 'UNCLEAR';
  summary: string;
}

// ─── Генерация голосового ответа ──────────────────────────

export async function generateVoiceResponse(
  taskId: string,
  task: Task,
  type: 'start' | 'respond',
  input: string,
): Promise<VoiceReply> {
  const history = getHistory(taskId);

  if (type === 'respond') {
    pushEntry(taskId, 'admin', input);
  }

  const prompt = type === 'start'
    ? VOICE_START_PROMPT(input)
    : VOICE_RESPOND_PROMPT(input, task);

  const conversation = history.map(h => {
    if (h.role === 'admin') return `СОБЕСЕДНИК: ${h.content}`;
    if (h.role === 'ai_response') return `ТЫ: ${h.content}`;
    return `ИНСТРУКЦИЯ: ${h.content}`;
  }).join('\n');

  const finalPrompt = `Диалог:\n${conversation}\n\nИНСТРУКЦИЯ: ${prompt}\n\nСгенерируй ответ строго в JSON (без markdown).`;

  try {
    const textRaw = await callGemini(finalPrompt, { temperature: 0.3, maxOutputTokens: 2048 });

    // Попытка извлечь JSON
    const parsed = extractJson<VoiceReply & { booking?: any }>(textRaw);
    if (parsed?.text) {
      if (parsed.booking && task.taskName === 'Входящий звонок B2B') {
        try {
          const clientPhone = task.originalText.replace('Входящий звонок от клиента ', '').trim();
          // Ссдвигаем с UTC -> Asia/Almaty (UTC+5) при парсинге даты от ИИ
          // ИИ получал локальное время, поэтому YYYY-MM-DDTHH:mm без Z — уже локальное
          let rawDate = parsed.booking.date || '';
          // Если ИИ вернул строку без часового пояса — трактуем как локальное (+5)
          if (rawDate && !rawDate.endsWith('Z') && !rawDate.includes('+')) {
            rawDate = rawDate + '+05:00';
          }
          const bookingDate = rawDate ? new Date(rawDate) : new Date();
          
          const newBooking = await prisma.booking.create({
            data: {
              companyId: task.userId,
              clientName: parsed.booking.clientName || 'Неизвестно',
              clientPhone: parsed.booking.clientPhone || clientPhone,
              date: bookingDate,
              service: parsed.booking.service || 'Не указана'
            }
          });
          
          logger.info('Voice', `🎟️ Создана бронь: ${newBooking.id} на ${newBooking.date}`);
          
          broadcastWsEvent({
            type: 'booking_created',
            companyId: task.userId,
            booking: newBooking
          });
        } catch (err) {
          logger.error('Voice', 'Failed to create booking', err);
        }
      }

      pushEntry(taskId, 'ai_response', parsed.text);
      return parsed;
    }

    // Фолбэк 1: извлечь text регексом даже из обрезанного JSON
    const textMatch = textRaw.match(/"text"\s*:\s*"([^"]+)/);
    if (textMatch?.[1]) {
      const text = textMatch[1];
      pushEntry(taskId, 'ai_response', text);
      return { text, completed: false };
    }

    // Фолбэк 2: если ответ не JSON — используем весь текст
    if (textRaw.trim() && !textRaw.trim().startsWith('{')) {
      const cleanText = textRaw.replace(/```[^`]*```/g, '').trim();
      pushEntry(taskId, 'ai_response', cleanText);
      return { text: cleanText, completed: false };
    }

    return { text: 'Извините, я вас не расслышал.', completed: false };
  } catch (e) {
    logger.error('Voice', 'Gemini call failed', e);
    return { text: 'Связь немного прерывается.', completed: false };
  }
}

// ─── Анализ итога звонка ──────────────────────────────────

export async function analyzeCallOutcome(taskId: string, task: Task): Promise<CallOutcome> {
  const history = getHistory(taskId);

  const dialogue = history
    .filter(h => h.role === 'admin' || h.role === 'ai_response')
    .map(h => `${h.role === 'admin' ? 'АДМИНИСТРАТОР' : 'АССИСТЕНТ'}: ${h.content}`)
    .join('\n');

  try {
    const textRaw = await callGemini(OUTCOME_PROMPT(task, dialogue), {
      temperature: 0.1,
      maxOutputTokens: 1000,
    });

    const parsed = extractJson<CallOutcome>(textRaw);
    if (parsed) return parsed;
  } catch (e) {
    logger.error('Outcome', 'Analysis failed', e);
  }

  return { status: 'UNCLEAR', summary: 'Не удалось проанализировать итог звонка.' };
}
