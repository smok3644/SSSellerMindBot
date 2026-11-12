// frontend/src/telegramBridge.ts
import { APP_CONFIG } from './config';
import { UnitEconomicsInput } from '../../shared/financeEngine';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: { id: number; first_name?: string; username?: string };
        };
        ready: () => void;
        expand: () => void;
        openTelegramLink: (url: string) => void;
        openInvoice: (url: string, callback?: (status: string) => void) => void;
        showAlert: (message: string) => void;
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
        };
      };
    };
  }
}

export function initTelegramApp(): void {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }
}

/**
 * Кодирует расчёт товара в компактную ссылку t.me/SSSellerMindBot/SSSellerMindBot?startapp=...
 * Позволяет делиться расчётами с партнёрами даже без подключённой БД!
 */
export function shareProductCalculation(input: UnitEconomicsInput, netProfit: number): void {
  const compactPayload = {
    n: input.name.slice(0, 30),
    m: input.marketplace,
    p: input.purchasePrice,
    s: input.sellingPrice,
    c: input.commissionPct,
    l: input.logisticsForward,
    r: input.returnPct,
    a: input.adsPct,
    t: input.taxPct,
  };

  const encoded = btoa(encodeURIComponent(JSON.stringify(compactPayload)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const directAppUrl = `https://${APP_CONFIG.MINI_APP_URL}?startapp=calc_${encoded}`;
  const shareText =
    `📊 Расчёт юнит-экономики «${input.name}» (${input.marketplace}) в SELLER MIND:\n` +
    `• Цена продажи: ${input.sellingPrice} ₽\n` +
    `• Чистая прибыль с 1 выкупа: ${netProfit > 0 ? `+${netProfit}` : netProfit} ₽\n` +
    `Открой полный расчёт и проверь свой товар:`;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(directAppUrl)}&text=${encodeURIComponent(shareText)}`;

  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
  } else {
    window.open(shareUrl, '_blank');
  }
}

/**
 * Распаковывает расчёт товара при переходе по шеринговой ссылке ?startapp=calc_...
 */
export function parseSharedProductFromStartParam(): Partial<UnitEconomicsInput> | null {
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (!startParam || !startParam.startsWith('calc_')) return null;

  try {
    const base64 = startParam.replace('calc_', '').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(decodeURIComponent(atob(base64)));
    return {
      name: decoded.n || 'Товар из ссылки',
      marketplace: decoded.m === 'OZON' ? 'OZON' : 'WB',
      purchasePrice: Number(decoded.p) || 500,
      sellingPrice: Number(decoded.s) || 1500,
      commissionPct: Number(decoded.c) || 20,
      logisticsForward: Number(decoded.l) || 90,
      returnPct: Number(decoded.r) || 15,
      adsPct: Number(decoded.a) || 10,
      taxPct: Number(decoded.t) || 6,
    };
  } catch {
    return null;
  }
}

/**
 * Прямой переход в чат техподдержки @yato137
 */
export function openSupportChat(): void {
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(APP_CONFIG.SUPPORT_LINK);
  } else {
    window.open(APP_CONFIG.SUPPORT_LINK, '_blank');
  }
}

/**
 * Вызов нативного окна оплаты Telegram Stars (XTR)
 */
export async function purchasePlanWithStars(
  plan: 'PRO' | 'BUSINESS',
  onSuccess: (plan: 'PRO' | 'BUSINESS') => void
): Promise<void> {
  const tg = window.Telegram?.WebApp;

  if (!APP_CONFIG.API_BASE_URL) {
    const msg =
      'Бэкенд для выпуска инвойсов Telegram Stars ещё не подключён в VITE_API_BASE_URL. По вопросам активации PRO напишите в поддержку @yato137.';
    if (tg?.showAlert) tg.showAlert(msg);
    else alert(msg);
    return;
  }

  try {
    const res = await fetch(`${APP_CONFIG.API_BASE_URL}/api/billing/create-stars-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': tg?.initData || '',
      },
      body: JSON.stringify({ plan }),
    });

    const data = await res.json();
    if (!res.ok || !data.invoiceLink) {
      throw new Error(data.error || 'Не удалось создать счёт в Telegram Stars');
    }

    if (tg?.openInvoice) {
      tg.openInvoice(data.invoiceLink, (status: string) => {
        if (status === 'paid') {
          tg.HapticFeedback?.notificationOccurred('success');
          onSuccess(plan);
        }
      });
    } else {
      window.open(data.invoiceLink, '_blank');
    }
  } catch (err: any) {
    if (tg?.showAlert) tg.showAlert(err.message);
    else alert(err.message);
  }
}