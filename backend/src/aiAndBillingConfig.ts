// backend/src/aiAndBillingConfig.ts
import { CorsOptions } from 'cors';
import {
  UnitEconomicsInput,
  UnitEconomicsResult,
} from '../../shared/financeEngine';
import { buildDeterministicFinancialAudit } from './server';

// 1. Строгий CORS специально под твой GitHub Pages и локальную отладку
export const corsConfig: CorsOptions = {
  origin: [
    'https://smok3644.github.io',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-telegram-init-data'],
  credentials: true,
};

// 2. Интеграция лучшего по цене/качеству AI-провайдера: DeepSeek V3 (с поддержкой OpenRouter)
const AI_API_URL =
  process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';
const AI_API_KEY = process.env.AI_API_KEY || '';

export async function askSellerMindAI(
  input: UnitEconomicsInput,
  calc: UnitEconomicsResult,
  question: string
): Promise<{ answer: string; provider: string }> {
  const deterministicAudit = buildDeterministicFinancialAudit(input, calc, question);

  if (!AI_API_KEY) {
    return {
      answer: deterministicAudit,
      provider: 'DETERMINISTIC_ENGINE',
    };
  }

  try {
    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.15,
        max_tokens: 550,
        messages: [
          {
            role: 'system',
            content: [
              'Ты — главный финансовый аналитик сервиса SELLER MIND (@SSSellerMindBot) для селлеров Wildberries и Ozon.',
              'Твоя задача — отвечать строго на основе переданных расчётов юнит-экономики.',
              'ЗАПРЕЩЕНО выдумывать объёмы продаж, внешние комиссии или несуществующие расходы.',
              'Структура ответа:',
              '1. Прямой вердикт в первой строке (с цифрами в ₽ и %).',
              '2. Главная точка утечки прибыли (закупка, комиссия, ДРР или покатушки от возвратов).',
              '3. Конкретное действие: какую цену поставить или до какого % снизить ДРР/возвраты.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `Товар: ${JSON.stringify(input)}\nТочный расчёт: ${JSON.stringify(calc)}\nВопрос селлера: ${question}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return { answer: deterministicAudit, provider: 'DETERMINISTIC_FALLBACK' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return {
      answer: content || deterministicAudit,
      provider: AI_MODEL,
    };
  } catch {
    return {
      answer: deterministicAudit,
      provider: 'DETERMINISTIC_FALLBACK',
    };
  }
}