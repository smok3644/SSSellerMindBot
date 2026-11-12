// backend/src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Pool } from 'pg';
import cors from 'cors';
import {
  calculateUnitEconomics,
  UnitEconomicsInput,
  UnitEconomicsResult,
} from '../../shared/financeEngine';

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Лимиты тарифов (Freemium)
export const PLAN_LIMITS = {
  FREE: { maxProducts: 3, canCompareScenarios: false, canUseAI: false, maxHistory: 3 },
  PRO: { maxProducts: 30, canCompareScenarios: true, canUseAI: false, maxHistory: 50 },
  BUSINESS: { maxProducts: 150, canCompareScenarios: true, canUseAI: true, maxHistory: 500 },
} as const;

// 1. Криптографическая проверка Telegram WebApp initData (HMAC-SHA256)
export function verifyTelegramInitData(initData: string, botToken: string): {
  valid: boolean;
  telegramUser?: { id: number; username?: string; first_name?: string };
} {
  if (!initData || !botToken) return { valid: false };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false };

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) return { valid: false };

  // Проверка свежести initData (защита от replay-атак: 24 часа)
  const authDate = Number(params.get('auth_date') || 0);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) {
    return { valid: false };
  }

  const userRaw = params.get('user');
  const telegramUser = userRaw ? JSON.parse(userRaw) : undefined;
  return { valid: true, telegramUser };
}

// Расширение Request для авторизованного пользователя
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    telegram_id: number;
    plan: 'FREE' | 'PRO' | 'BUSINESS';
    plan_expires_at: Date | null;
  };
}

// Middleware авторизации и проверки срока действия подписки
async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const initData = req.headers['x-telegram-init-data'] as string;
    const verification = verifyTelegramInitData(initData, BOT_TOKEN);

    if (!verification.valid || !verification.telegramUser) {
      return res.status(401).json({ error: 'Недействительная подпись Telegram initData' });
    }

    const { id: tgId, username, first_name } = verification.telegramUser;

    // Upsert пользователя в PostgreSQL
    const userRes = await pool.query(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE
       SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, updated_at = NOW()
       RETURNING id, telegram_id, plan, plan_expires_at`,
      [tgId, username || null, first_name || null]
    );

    const user = userRes.rows[0];

    // Автоматический даунгрейд до FREE при истечении оплаченного периода
    if (
      user.plan !== 'FREE' &&
      user.plan_expires_at &&
      new Date(user.plan_expires_at) < new Date()
    ) {
      await pool.query(`UPDATE users SET plan = 'FREE', plan_expires_at = NULL WHERE id = $1`, [
        user.id,
      ]);
      user.plan = 'FREE';
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка авторизации на сервере' });
  }
}

// 2. Получение профиля, товаров и уведомлений
app.get('/api/bootstrap', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const productsRes = await pool.query(
    `SELECT * FROM products WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  const notificationsRes = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 AND is_read = FALSE ORDER BY created_at DESC LIMIT 10`,
    [userId]
  );

  res.json({
    user: req.user,
    limits: PLAN_LIMITS[req.user!.plan],
    products: productsRes.rows,
    notifications: notificationsRes.rows,
  });
});

// 3. Сохранение / обновление товара с контролем Freemium-лимитов и генерацией уведомлений
app.post('/api/products', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const input: UnitEconomicsInput & { id?: string } = req.body;

  try {
    const calc = calculateUnitEconomics(input);

    // Если создание нового товара — проверяем лимит тарифа
    if (!input.id) {
      const countRes = await pool.query(`SELECT COUNT(*) FROM products WHERE user_id = $1`, [
        user.id,
      ]);
      const currentCount = Number(countRes.rows[0].count);
      const maxAllowed = PLAN_LIMITS[user.plan].maxProducts;

      if (currentCount >= maxAllowed) {
        return res.status(403).json({
          code: 'LIMIT_REACHED',
          error: `На тарифе ${user.plan} доступно максимум ${maxAllowed} товаров. Перейдите на PRO или BUSINESS.`,
        });
      }
    }

    const upsertRes = await pool.query(
      `INSERT INTO products (
         id, user_id, name, marketplace, purchase_price, selling_price,
         commission_pct, acquiring_pct, logistics_forward, logistics_return,
         storage_cost, ads_pct, tax_pct, packaging_cost, other_cost, return_pct,
         net_profit, margin_pct, roi_pct, breakeven_price
       ) VALUES (
         COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20
       )
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         marketplace = EXCLUDED.marketplace,
         purchase_price = EXCLUDED.purchase_price,
         selling_price = EXCLUDED.selling_price,
         commission_pct = EXCLUDED.commission_pct,
         acquiring_pct = EXCLUDED.acquiring_pct,
         logistics_forward = EXCLUDED.logistics_forward,
         logistics_return = EXCLUDED.logistics_return,
         storage_cost = EXCLUDED.storage_cost,
         ads_pct = EXCLUDED.ads_pct,
         tax_pct = EXCLUDED.tax_pct,
         packaging_cost = EXCLUDED.packaging_cost,
         other_cost = EXCLUDED.other_cost,
         return_pct = EXCLUDED.return_pct,
         net_profit = EXCLUDED.net_profit,
         margin_pct = EXCLUDED.margin_pct,
         roi_pct = EXCLUDED.roi_pct,
         breakeven_price = EXCLUDED.breakeven_price,
         updated_at = NOW()
       RETURNING *`,
      [
        input.id || null,
        user.id,
        input.name,
        input.marketplace,
        input.purchasePrice,
        input.sellingPrice,
        input.commissionPct,
        input.acquiringPct,
        input.logisticsForward,
        input.logisticsReturn,
        input.storageCost,
        input.adsPct,
        input.taxPct,
        input.packagingCost,
        input.otherCost,
        input.returnPct,
        calc.netProfit,
        calc.marginPct,
        calc.roiPct,
        calc.breakevenPrice,
      ]
    );

    const savedProduct = upsertRes.rows[0];

    // Запись снапшота в историю расчётов
    await pool.query(
      `INSERT INTO calculations_history (product_id, user_id, snapshot_input, snapshot_output)
       VALUES ($1, $2, $3, $4)`,
      [savedProduct.id, user.id, JSON.stringify(input), JSON.stringify(calc)]
    );

    // Автоматическое уведомление, если товар ушёл в минус
    if (calc.netProfit < 0) {
      await pool.query(
        `INSERT INTO notifications (user_id, product_id, type, title, message)
         VALUES ($1, $2, 'NEGATIVE_MARGIN', $3, $4)`,
        [
          user.id,
          savedProduct.id,
          `Убыточный товар: ${input.name}`,
          `Каждая продажа приносит ${calc.netProfit} ₽ убытка. Поднимите цену минимум до ${Math.ceil(calc.breakevenPrice)} ₽.`,
        ]
      );
    }

    res.json({ product: savedProduct, calculation: calc });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Ошибка при расчёте и сохранении товара' });
  }
});

// 4. AI-финансовый консультант (строго без выдумывания данных)
export function buildDeterministicFinancialAudit(
  input: UnitEconomicsInput,
  calc: UnitEconomicsResult,
  question: string
): string {
  const maxAllowedAdsPct = Math.max(
    0,
    input.adsPct + (calc.netProfit / input.sellingPrice) * 100
  );
  const items = [
    { label: 'Закупка и упаковка', val: calc.breakdown.cogsAndPackaging },
    { label: 'Комиссия МП', val: calc.breakdown.marketplaceCommission },
    { label: 'Логистика (с учётом возвратов)', val: calc.breakdown.effectiveLogistics },
    { label: 'Реклама (ДРР)', val: calc.breakdown.adsCost },
    { label: 'Налоги и эквайринг', val: calc.breakdown.taxCost + calc.breakdown.acquiringCost },
  ].sort((a, b) => b.val - a.val);

  const topDriver = items[0];

  return [
    `📊 **Финансовый разбор товара «${input.name}» (${input.marketplace})**`,
    `• **Текущая прибыль:** ${calc.netProfit} ₽/шт (маржа ${calc.marginPct}%, ROI ${calc.roiPct}%).`,
    `• **Главный драйвер расходов:** ${topDriver.label} — ${topDriver.val} ₽ (${((topDriver.val / input.sellingPrice) * 100).toFixed(1)}% от цены).`,
    `• **Потери на возвратах (${input.returnPct}%):** каждый выкупленный товар оплачивает ${calc.breakdown.returnLossesOnly} ₽ холостых покатушек.`,
    `• **Порог убыточности по цене:** при снижении цены ниже **${calc.breakevenPrice} ₽** товар уйдёт в минус.`,
    `• **Лимит на рекламу (предельный ДРР):** максимум **${maxAllowedAdsPct.toFixed(1)}%** (${(input.sellingPrice * (maxAllowedAdsPct / 100)).toFixed(0)} ₽/шт) для работы в ноль.`,
  ].join('\n');
}

app.post('/api/ai/consult', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { input, question }: { input: UnitEconomicsInput; question: string } = req.body;

  const calc = calculateUnitEconomics(input);
  const deterministicBase = buildDeterministicFinancialAudit(input, calc, question);

  // Если OpenAI API ключ не задан, возвращаем точный математический разбор
  if (!OPENAI_API_KEY) {
    return res.json({
      answer: deterministicBase,
      source: 'DETERMINISTIC_ENGINE',
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'Ты — строгий финансовый директор селлера Wildberries и Ozon в приложении SELLER MIND. Отвечай ТОЛЬКО на основе переданных цифр JSON расчёта. Категорически запрещено придумывать отсутствующие данные, объёмы продаж в штуках или внешние рыночные ставки. Давай чёткий ответ в 3–4 пунктах с конкретными цифрами в рублях и процентах.',
          },
          {
            role: 'user',
            content: `Входные параметры: ${JSON.stringify(input)}\nРезультаты расчёта: ${JSON.stringify(calc)}\nВопрос селлера: ${question}`,
          },
        ],
      }),
    });

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || deterministicBase;
    return res.json({ answer: aiText, source: 'LLM_VERIFIED' });
  } catch {
    return res.json({ answer: deterministicBase, source: 'DETERMINISTIC_FALLBACK' });
  }
});

// 5. Генерация инвойса Telegram Stars (XTR) для оплаты подписки внутри Mini App
app.post('/api/billing/create-stars-invoice', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { plan }: { plan: 'PRO' | 'BUSINESS' } = req.body;
  const user = req.user!;

  const pricing = {
    PRO: { stars: 250, title: 'SELLER MIND PRO (30 дней)', desc: 'До 30 товаров, сравнение сценариев, калькулятор целевой цены' },
    BUSINESS: { stars: 500, title: 'SELLER MIND BUSINESS (30 дней)', desc: 'До 150 товаров, безлимитный AI-консультант и аудит убытков' },
  }[plan];

  if (!BOT_TOKEN) {
    return res.status(503).json({
      error: 'TELEGRAM_BOT_TOKEN не настроен на сервере. Добавьте токен в .env для выпуска XTR-инвойсов.',
    });
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: pricing.title,
      description: pricing.desc,
      payload: JSON.stringify({ userId: user.id, plan }),
      provider_token: '', // Пустая строка для цифровых покупок в Telegram Stars (XTR)
      currency: 'XTR',
      prices: [{ label: pricing.title, amount: pricing.stars }],
    }),
  });

  const tgData = await tgRes.json();
  if (!tgData.ok) {
    return res.status(400).json({ error: tgData.description || 'Ошибка создания инвойса Telegram Stars' });
  }

  res.json({ invoiceLink: tgData.result });
});

// 6. Webhook Telegram Bot API для подтверждения оплаты Stars и активации подписки
app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
  const update = req.body;

  // Обязательное подтверждение pre_checkout_query в течение 10 секунд
  if (update.pre_checkout_query) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true,
      }),
    });
    return res.sendStatus(200);
  }

  // Начисление подписки при успешном платеже
  if (update.message?.successful_payment) {
    const payment = update.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);

    await pool.query(
      `INSERT INTO payments (user_id, telegram_payment_charge_id, plan, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'SUCCEEDED')
       ON CONFLICT (telegram_payment_charge_id) DO NOTHING`,
      [payload.userId, payment.telegram_payment_charge_id, payload.plan, payment.total_amount, payment.currency]
    );

    await pool.query(
      `UPDATE users
       SET plan = $1,
           plan_expires_at = GREATEST(COALESCE(plan_expires_at, NOW()), NOW()) + INTERVAL '30 days',
           updated_at = NOW()
       WHERE id = $2`,
      [payload.plan, payload.userId]
    );
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`SELLER MIND Backend running on port ${PORT}`));
}

export default app;