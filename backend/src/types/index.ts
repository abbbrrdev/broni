// ═══════════════════════════════════════════════════════════
//  T Y P E S  —  все типы проекта
// ═══════════════════════════════════════════════════════════

/** Входящий запрос от пользователя/бота */
export interface UserRequest {
  name: string;
  number: string;
  text: string;
  city: string;
}

/** Результат поиска заведения через Gemini */
export interface ProcessedTask {
  taskName: string;
  placeName: string;
  placeNumber?: string;
  address?: string;
  time?: string;
  additionalInfo?: string;
}
