// frontend/src/App.tsx
import React, { useState, useMemo } from 'react';
import {
  UnitEconomicsInput,
  calculateUnitEconomics,
  calculateTargetPrice,
  comparePricingScenarios,
  Marketplace,
} from '../../shared/financeEngine';

interface SavedProduct extends UnitEconomicsInput {
  id: string;
  updatedAt: string;
}

const DEMO_LOSS_PRODUCT: SavedProduct = {
  id: 'demo-hoodie-wb',
  name: 'Худи женское оверсайз (Демо)',
  marketplace: 'WB',
  purchasePrice: 850,
  sellingPrice: 2500,
  commissionPct: 24.5,
  acquiringPct: 1.5,
  logisticsForward: 110,
  logisticsReturn: 50,
  storageCost: 25,
  adsPct: 12,
  taxPct: 6,
  packagingCost: 45,
  otherCost: 20,
  returnPct: 60, // Выкуп 40% (типично для одежды на WB)
  updatedAt: 'Сегодня, 12:15',
};

const DEMO_PROFIT_PRODUCT: SavedProduct = {
  id: 'demo-organizer-ozon',
  name: 'Органайзер для косметики акрил',
  marketplace: 'OZON',
  purchasePrice: 320,
  sellingPrice: 1290,
  commissionPct: 19,
  acquiringPct: 1.5,
  logisticsForward: 95,
  logisticsReturn: 50,
  storageCost: 12,
  adsPct: 8,
  taxPct: 6,
  packagingCost: 30,
  otherCost: 10,
  returnPct: 12, // Выкуп 88%
  updatedAt: 'Сегодня, 14:40',
};

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calc' | 'scenarios' | 'ai' | 'pro'>('calc');
  const [userPlan, setUserPlan] = useState<'FREE' | 'PRO' | 'BUSINESS'>('FREE');

  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>([
    DEMO_PROFIT_PRODUCT,
    DEMO_LOSS_PRODUCT,
  ]);

  const [form, setForm] = useState<UnitEconomicsInput>({ ...DEMO_LOSS_PRODUCT });
  const [editingId, setEditingId] = useState<string | null>(DEMO_LOSS_PRODUCT.id);

  // Состояние калькулятора целевой цены
  const [goalMode, setGoalMode] = useState<'TARGET_PROFIT_RUB' | 'TARGET_MARGIN_PCT'>('TARGET_MARGIN_PCT');
  const [goalValue, setGoalValue] = useState<number>(20);

  // Состояние AI-консультанта
  const [aiQuestion, setAiQuestion] = useState<string>('Почему товар приносит мало прибыли?');
  const [aiHistory, setAiHistory] = useState<Array<{ q: string; a: string }>>([]);

  // Реактивный расчёт текущей юнит-экономики
  const currentResult = useMemo(() => {
    try {
      return { data: calculateUnitEconomics(form), error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }, [form]);

  // Реактивный расчёт целевой цены
  const targetPriceResult = useMemo(() => {
    try {
      return { data: calculateTargetPrice(form, goalMode, goalValue), error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }, [form, goalMode, goalValue]);

  // Сравнение сценариев
  const scenarios = useMemo(() => {
    if (!currentResult.data) return [];
    return comparePricingScenarios(form);
  }, [form, currentResult.data]);

  // Агрегированная статистика для Главной панели (Dashboard)
  const dashboardStats = useMemo(() => {
    const computed = savedProducts.map((p) => ({
      product: p,
      calc: calculateUnitEconomics(p),
    }));
    const totalUnitProfit = computed.reduce((acc, item) => acc + item.calc.netProfit, 0);
    const avgMargin =
      computed.length > 0
        ? computed.reduce((acc, item) => acc + item.calc.marginPct, 0) / computed.length
        : 0;
    const lossMaking = computed.filter((item) => item.calc.netProfit <= 0);
    return { computed, totalUnitProfit, avgMargin, lossMaking };
  }, [savedProducts]);

  const handleSaveProduct = () => {
    if (!currentResult.data) return;
    const maxAllowed = userPlan === 'FREE' ? 3 : userPlan === 'PRO' ? 30 : 150;

    if (!editingId && savedProducts.length >= maxAllowed) {
      setActiveTab('pro');
      return;
    }

    const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (editingId) {
      setSavedProducts((prev) =>
        prev.map((p) => (p.id === editingId ? { ...form, id: editingId, updatedAt: `Сегодня, ${now}` } : p))
      );
    } else {
      const newId = `sku-${Date.now()}`;
      setSavedProducts((prev) => [{ ...form, id: newId, updatedAt: `Сегодня, ${now}` }, ...prev]);
      setEditingId(newId);
    }
  };

  const handleAskAI = (presetQuestion?: string) => {
    const q = presetQuestion || aiQuestion;
    if (!currentResult.data) return;
    const c = currentResult.data;
    const maxAdsPct = Math.max(0, form.adsPct + (c.netProfit / form.sellingPrice) * 100);

    let answer = '';
    if (q.includes('мало прибыли') || q.includes('расходы')) {
      answer =
        `Главные пожиратели выручки (${form.sellingPrice} ₽):\n` +
        `1) Закупка + упаковка: ${c.breakdown.cogsAndPackaging} ₽ (${((c.breakdown.cogsAndPackaging / form.sellingPrice) * 100).toFixed(1)}%)\n` +
        `2) Комиссия ${form.marketplace}: ${c.breakdown.marketplaceCommission} ₽ (${form.commissionPct}%)\n` +
        `3) Реальная логистика с учётом возвратов (${form.returnPct}%): ${c.breakdown.effectiveLogistics} ₽, из которых ${c.breakdown.returnLossesOnly} ₽ — чистая переплата за покатушки.\n` +
        `Итог: чистая прибыль составляет ${c.netProfit} ₽ (${c.marginPct}%).`;
    } else if (q.includes('снижать цену')) {
      answer =
        `Точка безубыточности этого товара — ${c.breakevenPrice} ₽. ` +
        (form.sellingPrice > c.breakevenPrice
          ? `У вас есть запас прочности ${(form.sellingPrice - c.breakevenPrice).toFixed(0)} ₽. Снижение цены на 10% (до ${(form.sellingPrice * 0.9).toFixed(0)} ₽) изменит прибыль до ${calculateUnitEconomics({ ...form, sellingPrice: form.sellingPrice * 0.9 }).netProfit} ₽/шт.`
          : `Снижать цену нельзя: вы уже торгуете ниже точки безубыточности на ${(c.breakevenPrice - form.sellingPrice).toFixed(0)} ₽.`);
    } else if (q.includes('рекламу')) {
      answer =
        `Сейчас ваш ДРР — ${form.adsPct}% (${c.breakdown.adsCost} ₽/шт). ` +
        `Предельный ДРР (при котором прибыль станет 0 ₽) равен ${maxAdsPct.toFixed(1)}% (${((form.sellingPrice * maxAdsPct) / 100).toFixed(0)} ₽ на заказ). Чтобы сохранить минимальную маржу 15%, держите ДРР не выше ${Math.max(0, maxAdsPct - 15).toFixed(1)}%.`;
    } else {
      answer =
        `Товар станет убыточным при цене ниже ${c.breakevenPrice} ₽ (при сохранении выкупа ${c.buyoutPct}% и ДРР ${form.adsPct}%). Чтобы зарабатывать 20% чистой маржи, установите цену ${calculateTargetPrice(form, 'TARGET_MARGIN_PCT', 20).requiredPrice} ₽.`;
    }

    setAiHistory((prev) => [{ q, a: answer }, ...prev]);
  };

  // Экран продающего онбординга (Этап 5)
  if (showOnboarding) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col justify-between p-5 max-w-md mx-auto font-sans">
        <div className="space-y-4 pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-medium">
            <span>SELLER MIND • WB & Ozon FinTech</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight leading-snug">
            Ты знаешь, сколько реально зарабатываешь на каждом товаре после всех расходов?
          </h1>
          <p className="text-sm text-slate-400">
            8 из 10 начинающих селлеров считают прибыль в уме без учёта стоимости возвратов («покатушек») и торгуют в минус.
          </p>

          {/* Наглядная карточка-пример */}
          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3 shadow-xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <div>
                <span className="text-xs text-slate-400">Реальный пример • WB Одежда</span>
                <h3 className="font-semibold text-sm">Худи женское оверсайз</h3>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-400 text-xs font-semibold">
                Выкуп 40%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/60">
                <div className="text-slate-400">Цена продажи</div>
                <div className="text-base font-bold tabular-nums mt-0.5">2 500 ₽</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60">
                <div className="text-slate-400">Закупка + упаковка</div>
                <div className="text-base font-bold tabular-nums mt-0.5">895 ₽</div>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between">
                <span>Ожидание новичка («на глаз»):</span>
                <span className="text-emerald-400 font-semibold tabular-nums">+950 ₽ / шт</span>
              </div>
              <div className="flex justify-between">
                <span>Комиссия МП (24.5%) + Реклама (12%) + Налог (6%):</span>
                <span className="text-slate-200 tabular-nums">-1 087.5 ₽</span>
              </div>
              <div className="flex justify-between">
                <span>Логистика с учётом 60% возвратов (покатушки):</span>
                <span className="text-amber-400 font-medium tabular-nums">-350 ₽</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
              <span className="text-xs font-medium text-slate-300">Реальная чистая прибыль:</span>
              <span className="text-lg font-extrabold text-rose-400 tabular-nums">-42.5 ₽ (УБЫТОК)</span>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 pt-6">
          <button
            onClick={() => {
              setForm({ ...DEMO_LOSS_PRODUCT });
              setShowOnboarding(false);
              setActiveTab('calc');
            }}
            className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] transition font-semibold text-sm shadow-lg shadow-indigo-600/25"
          >
            Проверить свой товар за 30 секунд →
          </button>
          <button
            onClick={() => {
              setShowOnboarding(false);
              setActiveTab('dashboard');
            }}
            className="w-full py-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 font-medium text-xs"
          >
            Открыть демо-панель с 2 товарами
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 pb-24 max-w-md mx-auto font-sans">
      {/* Верхний бар */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-[#090D16]/85 border-b border-slate-800/80 px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-xs">
            SM
          </div>
          <div>
            <div className="text-sm font-bold leading-none">SELLER MIND</div>
            <div className="text-[11px] text-slate-400">Юнит-экономика WB & Ozon</div>
          </div>
        </div>
        <button
          onClick={() => setActiveTab('pro')}
          className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
        >
          Тариф: {userPlan} ({savedProducts.length}/{userPlan === 'FREE' ? 3 : userPlan === 'PRO' ? 30 : 150} SKU)
        </button>
      </header>

      <main className="p-4 space-y-4">
        {/* Вкладка 1: ГЛАВНАЯ ПАНЕЛЬ (DASHBOARD) */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400">Товаров</div>
                <div className="text-lg font-bold tabular-nums mt-1">{savedProducts.length} SKU</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400">Средняя маржа</div>
                <div className="text-lg font-bold tabular-nums mt-1 text-indigo-400">
                  {dashboardStats.avgMargin.toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400">Убыточных</div>
                <div className="text-lg font-bold tabular-nums mt-1 text-rose-400">
                  {dashboardStats.lossMaking.length} шт
                </div>
              </div>
            </div>

            {/* Блок уведомлений */}
            {dashboardStats.lossMaking.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-1">
                <div className="text-xs font-bold text-rose-300 flex items-center justify-between">
                  <span>⚠️ Внимание: товары с отрицательной маржой</span>
                  <span>{dashboardStats.lossMaking.length} SKU</span>
                </div>
                <p className="text-xs text-slate-300">
                  «{dashboardStats.lossMaking[0].product.name}» генерирует{' '}
                  <b className="text-rose-400">{dashboardStats.lossMaking[0].calc.netProfit} ₽</b> с каждой
                  продажи. Минимальная безубыточная цена —{' '}
                  <b>{Math.ceil(dashboardStats.lossMaking[0].calc.breakevenPrice)} ₽</b>.
                </p>
              </div>
            )}

            {/* Список сохранённых товаров */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-semibold text-slate-200">Сохранённые расчёты</h2>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setForm({ ...DEMO_PROFIT_PRODUCT, name: 'Новый товар' });
                    setActiveTab('calc');
                  }}
                  className="text-xs text-indigo-400 font-medium"
                >
                  + Добавить SKU
                </button>
              </div>

              {dashboardStats.computed.map(({ product, calc }) => (
                <div
                  key={product.id}
                  onClick={() => {
                    setForm({ ...product });
                    setEditingId(product.id);
                    setActiveTab('calc');
                  }}
                  className="p-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 transition cursor-pointer space-y-2"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 mr-2">
                        {product.marketplace}
                      </span>
                      <span className="text-sm font-semibold">{product.name}</span>
                    </div>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        calc.netProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {calc.netProfit > 0 ? `+${calc.netProfit}` : calc.netProfit} ₽
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400 tabular-nums">
                    <span>Цена: {product.sellingPrice} ₽</span>
                    <span>Маржа: {calc.marginPct}%</span>
                    <span>ROI: {calc.roiPct}%</span>
                    <span>Выкуп: {calc.buyoutPct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Вкладка 2: КАЛЬКУЛЯТОР ЮНИТ-ЭКОНОМИКИ И ЦЕЛЕВОЙ ЦЕНЫ */}
        {activeTab === 'calc' && (
          <div className="space-y-4">
            {/* Плавающая сводка результата */}
            {currentResult.data && (
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs text-slate-400">Чистая прибыль с 1 выкупа</div>
                    <div
                      className={`text-2xl font-extrabold tabular-nums ${
                        currentResult.data.netProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {currentResult.data.netProfit > 0
                        ? `+${currentResult.data.netProfit}`
                        : currentResult.data.netProfit}{' '}
                      ₽
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums ${
                        currentResult.data.healthStatus === 'PROFITABLE'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : currentResult.data.healthStatus === 'WARNING'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      Маржа {currentResult.data.marginPct}% • ROI {currentResult.data.roiPct}%
                    </span>
                    <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
                      Точка нуля: <b>{currentResult.data.breakevenPrice} ₽</b>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs tabular-nums">
                  <div>
                    <span className="text-slate-400 block">Выручка</span>
                    <span className="font-semibold">{currentResult.data.revenue} ₽</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Все расходы</span>
                    <span className="font-semibold">{currentResult.data.totalExpenses} ₽</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Логистика с возвр.</span>
                    <span className="font-semibold text-amber-400">
                      {currentResult.data.breakdown.effectiveLogistics} ₽
                    </span>
                  </div>
                </div>

                {/* Быстрые рекомендации */}
                <div className="p-2.5 rounded-xl bg-slate-950/70 text-xs text-slate-300 space-y-1">
                  {currentResult.data.recommendations.map((rec, i) => (
                    <div key={i}>💡 {rec}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Поля ввода */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex gap-2">
                {(['WB', 'OZON'] as Marketplace[]).map((mp) => (
                  <button
                    key={mp}
                    onClick={() => setForm({ ...form, marketplace: mp })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition ${
                      form.marketplace === mp
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {mp === 'WB' ? 'Wildberries' : 'Ozon'}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-slate-400">Название товара</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'sellingPrice', label: 'Цена продажи (₽)' },
                  { key: 'purchasePrice', label: 'Закупочная цена (₽)' },
                  { key: 'commissionPct', label: 'Комиссия МП (%)' },
                  { key: 'returnPct', label: 'Процент возвратов (%)' },
                  { key: 'logisticsForward', label: 'Логистика прямая (₽)' },
                  { key: 'logisticsReturn', label: 'Логистика возврата (₽)' },
                  { key: 'adsPct', label: 'Реклама / ДРР (%)' },
                  { key: 'taxPct', label: 'Налог с продаж (%)' },
                  { key: 'packagingCost', label: 'Упаковка (₽)' },
                  { key: 'storageCost', label: 'Хранение (₽)' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[11px] text-slate-400">{label}</label>
                    <input
                      type="number"
                      step="any"
                      value={(form as any)[key]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: Math.max(0, parseFloat(e.target.value) || 0) })
                      }
                      className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-semibold tabular-nums"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={handleSaveProduct}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition"
              >
                💾 Сохранить расчёт товара
              </button>
            </div>

            {/* Обратный калькулятор целевой цены (Пункт 3) */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold">🎯 Калькулятор целевой цены</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setGoalMode('TARGET_MARGIN_PCT');
                    setGoalValue(20);
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold ${
                    goalMode === 'TARGET_MARGIN_PCT' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  По желаемой марже (%)
                </button>
                <button
                  onClick={() => {
                    setGoalMode('TARGET_PROFIT_RUB');
                    setGoalValue(500);
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold ${
                    goalMode === 'TARGET_PROFIT_RUB' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  По прибыли в ₽
                </button>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={goalValue}
                  onChange={(e) => setGoalValue(parseFloat(e.target.value) || 0)}
                  className="w-28 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-bold tabular-nums"
                />
                {targetPriceResult.data ? (
                  <div className="text-xs">
                    Нужна цена:{' '}
                    <b className="text-base text-emerald-400 tabular-nums">
                      {targetPriceResult.data.requiredPrice} ₽
                    </b>{' '}
                    (прибыль {targetPriceResult.data.projectedProfit} ₽)
                  </div>
                ) : (
                  <div className="text-xs text-rose-400">{targetPriceResult.error}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Вкладка 3: СРАВНЕНИЕ СЦЕНАРИЕВ (Пункт 4) */}
        {activeTab === 'scenarios' && (
          <div className="space-y-3">
            <h2 className="text-base font-bold">Симулятор сценариев: «{form.name}»</h2>
            <p className="text-xs text-slate-400">
              Сравните, как вход в акцию, изменение цены или снижение ДРР повлияют на итоговую чистую прибыль с 1 штуки.
            </p>
            {scenarios.map((sc) => (
              <div
                key={sc.id}
                className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex justify-between items-center"
              >
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold">{sc.title}</div>
                  <div className="text-xs text-slate-400">{sc.description}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums pt-1">
                    Цена: {sc.sellingPrice} ₽ • ДРР: {sc.adsPct}% • Маржа: {sc.marginPct}%
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div
                    className={`text-base font-bold ${
                      sc.netProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {sc.netProfit > 0 ? `+${sc.netProfit}` : sc.netProfit} ₽
                  </div>
                  {sc.id !== 'current' && (
                    <div
                      className={`text-xs font-medium ${
                        sc.profitDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {sc.profitDiff >= 0 ? `▲ +${sc.profitDiff}` : `▼ ${sc.profitDiff}`} ₽ к базе
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Вкладка 4: AI-ФИНАНСОВЫЙ КОНСУЛЬТАНТ (Пункт 5) */}
        {activeTab === 'ai' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="text-sm font-bold">🤖 AI-финансовый аналитик</div>
              <p className="text-xs text-slate-400">
                Анализирует исключительно введённые параметры товара «{form.name}» без выдумывания цифр.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Почему товар приносит мало прибыли?',
                  'Стоит ли снижать цену в акцию?',
                  'Сколько можно потратить на рекламу?',
                  'При какой цене товар станет убыточным?',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => handleAskAI(q)}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-indigo-600/30 text-xs text-slate-200 transition text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {aiHistory.map((item, idx) => (
                <div key={idx} className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                  <div className="font-semibold text-indigo-300">Вопрос: {item.q}</div>
                  <div className="text-slate-200 whitespace-pre-line leading-relaxed">{item.a}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Вкладка 5: ТАРИФЫ И МОНЕТИЗАЦИЯ (TELEGRAM STARS) */}
        {activeTab === 'pro' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">Тарифы SELLER MIND</h2>
            {[
              {
                plan: 'FREE' as const,
                price: '0 ₽',
                stars: 'Бесплатно навсегда',
                features: ['До 3 товаров (SKU)', 'Калькулятор юнит-экономики и точки нуля', 'Учёт логистики возвратов'],
              },
              {
                plan: 'PRO' as const,
                price: '490 ₽ / мес',
                stars: '250 ⭐ Telegram Stars',
                features: ['До 30 товаров (SKU)', 'Симулятор ценовых сценариев и акций', 'Обратный калькулятор целевой цены', 'Полная история изменений'],
              },
              {
                plan: 'BUSINESS' as const,
                price: '990 ₽ / мес',
                stars: '500 ⭐ Telegram Stars',
                features: ['До 150 товаров (SKU)', 'Безлимитный AI-финансовый консультант', 'Авто-мониторинг убыточных позиций'],
              },
            ].map((tier) => (
              <div
                key={tier.plan}
                className={`p-4 rounded-2xl border space-y-2.5 ${
                  userPlan === tier.plan
                    ? 'bg-indigo-950/30 border-indigo-500'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">{tier.plan}</span>
                  <div className="text-right">
                    <div className="font-extrabold text-sm">{tier.price}</div>
                    <div className="text-[11px] text-amber-400">{tier.stars}</div>
                  </div>
                </div>
                <ul className="text-xs text-slate-300 space-y-1">
                  {tier.features.map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>
                <button
                  onClick={() => setUserPlan(tier.plan)}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold"
                >
                  {userPlan === tier.plan ? 'Активный тариф' : `Оплатить ${tier.plan} через Telegram Stars`}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Нижняя панель навигации под большой палец */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-[#090D16]/95 backdrop-blur-md border-t border-slate-800 px-2 py-2 flex justify-around text-[11px]">
        {[
          { id: 'dashboard', label: 'Сводка' },
          { id: 'calc', label: 'Калькулятор' },
          { id: 'scenarios', label: 'Сценарии' },
          { id: 'ai', label: 'AI-разбор' },
          { id: 'pro', label: 'Тарифы' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-3 py-1.5 rounded-xl font-semibold transition ${
              activeTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}