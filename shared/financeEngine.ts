// shared/financeEngine.ts

export type Marketplace = 'WB' | 'OZON';

export interface UnitEconomicsInput {
  name: string;
  marketplace: Marketplace;
  purchasePrice: number;     // Закупочная цена (₽)
  sellingPrice: number;      // Цена продажи (₽)
  commissionPct: number;     // Комиссия МП (%)
  acquiringPct: number;      // Эквайринг (%)
  logisticsForward: number;  // Прямая логистика до клиента (₽)
  logisticsReturn: number;   // Обратная логистика при отказе (₽)
  storageCost: number;       // Хранение на 1 выкуп (₽)
  adsPct: number;            // Реклама / ДРР от цены продажи (%)
  taxPct: number;            // Налог от выручки (%)
  packagingCost: number;     // Упаковка и маркировка (₽)
  otherCost: number;         // Прочие расходы / брак (₽)
  returnPct: number;         // Процент возвратов / невыкупов (0 - 99%)
}

export interface ExpenseBreakdown {
  cogsAndPackaging: number;
  marketplaceCommission: number;
  acquiringCost: number;
  effectiveLogistics: number;
  returnLossesOnly: number;  // Переплата за «покатушки» сверх прямой логистики
  storageCost: number;
  adsCost: number;
  taxCost: number;
  otherCost: number;
}

export interface UnitEconomicsResult {
  revenue: number;
  totalExpenses: number;
  netProfit: number;
  marginPct: number;         // Маржинальность продаж (ROS), %
  roiPct: number;            // Рентабельность вложений (ROI), %
  breakevenPrice: number;    // Точка безубыточности (₽)
  buyoutPct: number;         // Процент выкупа (%)
  variableRatePct: number;   // Суммарная доля % удержаний от цены
  fixedCostsPerBuyout: number;
  breakdown: ExpenseBreakdown;
  healthStatus: 'PROFITABLE' | 'WARNING' | 'LOSS';
  recommendations: string[];
}

export interface ScenarioDelta {
  id: string;
  title: string;
  description: string;
  sellingPrice: number;
  adsPct: number;
  logisticsForward: number;
  netProfit: number;
  marginPct: number;
  profitDiff: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function calculateUnitEconomics(input: UnitEconomicsInput): UnitEconomicsResult {
  if (input.sellingPrice <= 0) {
    throw new Error('Цена продажи должна быть больше 0 ₽');
  }
  if (input.returnPct < 0 || input.returnPct >= 99.5) {
    throw new Error('Процент возвратов должен быть в диапазоне от 0% до 99%');
  }

  const buyoutPct = 100 - input.returnPct;
  const kBuyout = buyoutPct / 100;

  // 1. Эффективная логистика с учётом «покатушек»
  const effectiveLogistics =
    (input.logisticsForward + (1 - kBuyout) * input.logisticsReturn) / kBuyout;
  const returnLossesOnly = effectiveLogistics - input.logisticsForward;

  // 2. Постоянные расходы на 1 выкупленный товар
  const fixedCostsPerBuyout =
    input.purchasePrice +
    input.packagingCost +
    input.storageCost +
    input.otherCost +
    effectiveLogistics;

  // 3. Переменные расходы, зависящие от цены продажи
  const variableRatePct =
    input.commissionPct + input.acquiringPct + input.adsPct + input.taxPct;
  const rVar = variableRatePct / 100;

  if (rVar >= 0.99) {
    throw new Error(
      `Сумма процентных ставок (комиссия + эквайринг + ДРР + налог = ${variableRatePct.toFixed(1)}%) превышает 99% цены товара.`
    );
  }

  const marketplaceCommission = input.sellingPrice * (input.commissionPct / 100);
  const acquiringCost = input.sellingPrice * (input.acquiringPct / 100);
  const adsCost = input.sellingPrice * (input.adsPct / 100);
  const taxCost = input.sellingPrice * (input.taxPct / 100);

  const totalExpenses = fixedCostsPerBuyout + input.sellingPrice * rVar;
  const netProfit = input.sellingPrice - totalExpenses;
  const marginPct = (netProfit / input.sellingPrice) * 100;

  const investedCapital = input.purchasePrice + input.packagingCost;
  const roiPct = investedCapital > 0 ? (netProfit / investedCapital) * 100 : 0;

  // 4. Точка безубыточности (с учётом того, что при снижении цены падают комиссия, ДРР и налог)
  const breakevenPrice = fixedCostsPerBuyout / (1 - rVar);

  // 5. Диагностика здоровья и автоматические рекомендации
  let healthStatus: 'PROFITABLE' | 'WARNING' | 'LOSS' = 'PROFITABLE';
  if (netProfit <= 0) {
    healthStatus = 'LOSS';
  } else if (marginPct < 15) {
    healthStatus = 'WARNING';
  }

  const recommendations: string[] = [];
  if (netProfit <= 0) {
    recommendations.push(
      `Товар убыточен (${round2(netProfit)} ₽/шт). Минимальная безубыточная цена при текущих расходах — ${Math.ceil(breakevenPrice)} ₽.`
    );
  }
  if (returnLossesOnly > input.sellingPrice * 0.06) {
    recommendations.push(
      `Покатушки (возвраты ${input.returnPct}%) съедают ${round2(returnLossesOnly)} ₽ на каждом выкупе. Проверьте размерную сетку и фото в карточке.`
    );
  }
  if (input.adsPct > 15) {
    recommendations.push(
      `Высокий ДРР (${input.adsPct}% = ${round2(adsCost)} ₽/шт). Снижение ДРР на 5% добавит +${round2(input.sellingPrice * 0.05)} ₽ к чистой прибыли.`
    );
  }
  if (marginPct >= 15 && roiPct < 30) {
    recommendations.push(
      `Хорошая маржа (${round2(marginPct)}%), но низкий ROI (${round2(roiPct)}%) из-за дорогой закупки. Поработайте над условиями отсрочки у поставщика.`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      `Отличная экономика! Запас прочности по цене до точки нуля составляет ${round2(input.sellingPrice - breakevenPrice)} ₽ (${round2(((input.sellingPrice - breakevenPrice) / input.sellingPrice) * 100)}%).`
    );
  }

  return {
    revenue: round2(input.sellingPrice),
    totalExpenses: round2(totalExpenses),
    netProfit: round2(netProfit),
    marginPct: round2(marginPct),
    roiPct: round2(roiPct),
    breakevenPrice: round2(breakevenPrice),
    buyoutPct: round2(buyoutPct),
    variableRatePct: round2(variableRatePct),
    fixedCostsPerBuyout: round2(fixedCostsPerBuyout),
    breakdown: {
      cogsAndPackaging: round2(input.purchasePrice + input.packagingCost),
      marketplaceCommission: round2(marketplaceCommission),
      acquiringCost: round2(acquiringCost),
      effectiveLogistics: round2(effectiveLogistics),
      returnLossesOnly: round2(returnLossesOnly),
      storageCost: round2(input.storageCost),
      adsCost: round2(adsCost),
      taxCost: round2(taxCost),
      otherCost: round2(input.otherCost),
    },
    healthStatus,
    recommendations,
  };
}

/**
 * Обратный калькулятор цены: рассчитывает точное значение цены продажи
 * для достижения желаемой прибыли в рублях ИЛИ желаемой маржинальности в %.
 */
export function calculateTargetPrice(
  input: UnitEconomicsInput,
  mode: 'TARGET_PROFIT_RUB' | 'TARGET_MARGIN_PCT',
  targetValue: number
): { requiredPrice: number; projectedProfit: number; projectedMarginPct: number } {
  const base = calculateUnitEconomics(input);
  const rVar = base.variableRatePct / 100;

  if (mode === 'TARGET_PROFIT_RUB') {
    const requiredPrice = (base.fixedCostsPerBuyout + targetValue) / (1 - rVar);
    if (requiredPrice <= 0) {
      throw new Error('Невозможно достичь указанной цели при заданных параметрах');
    }
    const check = calculateUnitEconomics({ ...input, sellingPrice: requiredPrice });
    return {
      requiredPrice: round2(requiredPrice),
      projectedProfit: check.netProfit,
      projectedMarginPct: check.marginPct,
    };
  } else {
    const targetMarginRatio = targetValue / 100;
    if (rVar + targetMarginRatio >= 0.995) {
      throw new Error(
        `Невозможно достичь маржи ${targetValue}%, так как сумма обязательных % удержаний уже составляет ${base.variableRatePct}% от цены.`
      );
    }
    const requiredPrice = base.fixedCostsPerBuyout / (1 - rVar - targetMarginRatio);
    const check = calculateUnitEconomics({ ...input, sellingPrice: requiredPrice });
    return {
      requiredPrice: round2(requiredPrice),
      projectedProfit: check.netProfit,
      projectedMarginPct: check.marginPct,
    };
  }
}

/**
 * Генератор сравнительных сценариев для принятия решений селлером
 */
export function comparePricingScenarios(input: UnitEconomicsInput): ScenarioDelta[] {
  const base = calculateUnitEconomics(input);

  const configs = [
    {
      id: 'current',
      title: 'Текущая модель',
      description: 'Базовые параметры',
      mod: { ...input },
    },
    {
      id: 'price_up_10',
      title: 'Цена +10%',
      description: 'Повышение прайса без роста ДРР',
      mod: { ...input, sellingPrice: round2(input.sellingPrice * 1.1) },
    },
    {
      id: 'promo_minus_12',
      title: 'Вход в акцию (-12%)',
      description: 'Скидка 12% к цене при скидке МП -2% к комиссии',
      mod: {
        ...input,
        sellingPrice: round2(input.sellingPrice * 0.88),
        commissionPct: Math.max(5, input.commissionPct - 2),
      },
    },
    {
      id: 'ads_cut',
      title: 'Оптимизация ДРР (-4%)',
      description: 'Чистка неэффективных фраз авторекламы',
      mod: { ...input, adsPct: Math.max(0, input.adsPct - 4) },
    },
    {
      id: 'local_warehouse',
      title: 'Локализация складов',
      description: 'Снижение логистики на 25%',
      mod: { ...input, logisticsForward: round2(input.logisticsForward * 0.75) },
    },
  ];

  return configs.map((c) => {
    const res = calculateUnitEconomics(c.mod);
    return {
      id: c.id,
      title: c.title,
      description: c.description,
      sellingPrice: c.mod.sellingPrice,
      adsPct: c.mod.adsPct,
      logisticsForward: c.mod.logisticsForward,
      netProfit: res.netProfit,
      marginPct: res.marginPct,
      profitDiff: round2(res.netProfit - base.netProfit),
    };
  });
}