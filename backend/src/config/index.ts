// ═══════════════════════════════════════════════════════════
//  C O N F I G  —  все настройки в одном месте
// ═══════════════════════════════════════════════════════════

export const config = {
  port: Number(process.env.PORT) || 3000,
  publicUrl: process.env.PUBLIC_URL || '',
  apiSecret: process.env.API_SECRET_KEY || 'dev-secret-token', // дефолтный токен для тестов

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-2.5-flash',
    get endpoint() {
      return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    },
  },

  zadarma: {
    apiKey: process.env.ZADARMA_API_KEY || '',
    secret: process.env.ZADARMA_API_SECRET || '',
    sipId: process.env.ZADARMA_SIP_ID || '',    // ваш SIP-номер в Zadarma (напр. 100)
    phoneNumber: process.env.ZADARMA_PHONE_NUMBER || '', // купленный виртуальный номер
  },

  tts: {
    voice: 'Google.ru-RU-Wavenet-A',
    language: 'ru-RU',
  },
} as const;

