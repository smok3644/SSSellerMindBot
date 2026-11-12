// frontend/src/config.ts
export const APP_CONFIG = {
  APP_NAME: 'SELLER MIND',
  BOT_USERNAME: 'SSSellerMindBot',
  MINI_APP_SHORT_NAME: 'SSSellerMindBot',
  MINI_APP_URL: 't.me/SSSellerMindBot/SSSellerMindBot',
  SUPPORT_USERNAME: 'yato137',
  SUPPORT_LINK: 'https://t.me/yato137',
  FRONTEND_ORIGIN: 'https://smok3644.github.io',
  FRONTEND_BASE_PATH: '/SSSellerMindBot/',
  // URL твоего бэкенда (задаётся через переменную окружения при сборке на GitHub Pages)
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '',
  PLANS: {
    FREE: { priceRub: 0, stars: 0, maxSku: 3 },
    PRO: { priceRub: 490, stars: 250, maxSku: 30 },
    BUSINESS: { priceRub: 990, stars: 500, maxSku: 150 },
  },
} as const;