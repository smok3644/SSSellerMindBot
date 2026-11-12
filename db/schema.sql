-- db/schema.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Таблица пользователей (авторизация через Telegram initData)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(128),
    first_name VARCHAR(128),
    plan VARCHAR(20) NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'BUSINESS')),
    plan_expires_at TIMESTAMPTZ,
    referred_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Таблица сохранённых товаров (SKU)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    marketplace VARCHAR(20) NOT NULL DEFAULT 'WB' CHECK (marketplace IN ('WB', 'OZON')),
    purchase_price NUMERIC(12, 2) NOT NULL CHECK (purchase_price >= 0),
    selling_price NUMERIC(12, 2) NOT NULL CHECK (selling_price > 0),
    commission_pct NUMERIC(5, 2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct < 100),
    acquiring_pct NUMERIC(5, 2) NOT NULL DEFAULT 1.50 CHECK (acquiring_pct >= 0 AND acquiring_pct < 100),
    logistics_forward NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (logistics_forward >= 0),
    logistics_return NUMERIC(10, 2) NOT NULL DEFAULT 50 CHECK (logistics_return >= 0),
    storage_cost NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (storage_cost >= 0),
    ads_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (ads_pct >= 0 AND ads_pct < 100),
    tax_pct NUMERIC(5, 2) NOT NULL DEFAULT 6.00 CHECK (tax_pct >= 0 AND tax_pct < 100),
    packaging_cost NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (packaging_cost >= 0),
    other_cost NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
    return_pct NUMERIC(5, 2) NOT NULL DEFAULT 15.00 CHECK (return_pct >= 0 AND return_pct < 100),
    -- Кэшированные расчётные метрики для быстрых выборок дашборда
    net_profit NUMERIC(12, 2) NOT NULL,
    margin_pct NUMERIC(6, 2) NOT NULL,
    roi_pct NUMERIC(7, 2) NOT NULL,
    breakeven_price NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_user_id ON products(user_id);
CREATE INDEX idx_products_negative_margin ON products(user_id, net_profit) WHERE net_profit < 0;

-- 3. История изменений и расчётов по каждому товару
CREATE TABLE calculations_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_input JSONB NOT NULL,
    snapshot_output JSONB NOT NULL,
    note VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_product_id ON calculations_history(product_id, created_at DESC);

-- 4. Таблица платежей и подписок (Telegram Stars / ЮKassa)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_payment_charge_id VARCHAR(255) UNIQUE,
    provider VARCHAR(32) NOT NULL DEFAULT 'TELEGRAM_STARS',
    plan VARCHAR(20) NOT NULL CHECK (plan IN ('PRO', 'BUSINESS')),
    amount INT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'XTR',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Таблица системных уведомлений селлера
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    type VARCHAR(32) NOT NULL CHECK (type IN ('NEGATIVE_MARGIN', 'PARAMETER_CHANGE', 'REVIEW_REMINDER')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);