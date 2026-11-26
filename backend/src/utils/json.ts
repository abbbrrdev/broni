// ═══════════════════════════════════════════════════════════
//  J S O N  —  извлечение JSON из ответов Gemini
// ═══════════════════════════════════════════════════════════

/**
 * Извлекает первый JSON-объект из текста.
 * Поддерживает ```json блоки и просто {…}.
 */
export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  // Сначала из ```json блока
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock?.[1]) {
    try { return JSON.parse(codeBlock[1]); } catch {}
  }

  // Затем первый { ... } — GREEDY чтобы захватить весь JSON
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) {
    try { return JSON.parse(raw[0]); } catch {}
  }

  return null;
}

/**
 * Извлекает текст из ответа Gemini (поддерживает thinking-модели).
 * Собирает все текстовые части, игнорируя thinkingContent.
 */
export function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text as string)
    .join('');

  // Если ответ обрезан (finishReason=MAX_TOKENS), попробуем достать text поле
  return text;
}
