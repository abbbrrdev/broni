// ═══════════════════════════════════════════════════════════
//  G E M I N I   C L I E N T  —  HTTP-клиент Gemini API
// ═══════════════════════════════════════════════════════════

import { config } from '../config';
import { extractGeminiText } from '../utils/json';
import { logger } from '../utils/logger';
import { readFileSync } from 'fs';

interface GeminiCallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  useSearch?: boolean;
}

const DEFAULTS: GeminiCallOptions = {
  temperature: 0.3,
  maxOutputTokens: 500,
  useSearch: false,
};

/**
 * Единая точка вызова Gemini API.
 * Возвращает сырой текст ответа.
 */
export async function callGemini(prompt: string, opts: GeminiCallOptions = {}): Promise<string> {
  const { temperature, maxOutputTokens, useSearch } = { ...DEFAULTS, ...opts };

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  if (useSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const response = await fetch(config.gemini.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = extractGeminiText(data);

  logger.info('Gemini', `response (${text.length} chars)`, text.substring(0, 150));
  return text;
}

/**
 * Расшифровывает аудиофайл напрямую через Gemini (встроенная поддержка аудио).
 * Используется вместо медленных и неточных оффлайн моделей.
 */
export async function transcribeAudioWithGemini(audioFilePath: string): Promise<string> {
  let audioData: string;
  try {
    audioData = readFileSync(audioFilePath).toString("base64");
  } catch (err) {
    logger.error('Gemini', `STT failed to read file ${audioFilePath}`, err);
    return "";
  }

  const body: Record<string, unknown> = {
    contents: [{
      parts: [
        { text: "Пожалуйста, точно расшифруй аудио. Не добавляй никаких своих комментариев. Если на аудио полная тишина, шумы без речи или неразборчивый звук, обязательно верни ровно одно слово: [SILENCE]. Иначе верни только то, что сказал человек на русском языке." },
        {
          inlineData: {
            mimeType: "audio/wav",
            data: audioData
          }
        }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
  };

  try {
    const response = await fetch(config.gemini.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Gemini', `Audio STT error: ${response.status}`, errText);
      return "";
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let cleanText = text.trim();
    if (cleanText.includes('[SILENCE]') || cleanText.includes('SILENCE')) {
      cleanText = '';
    }
    logger.info('STT (Gemini)', `response: "${cleanText}"`);
    return cleanText;
  } catch (err) {
    logger.error('Gemini', 'STT exception', err);
    return "";
  }
}
