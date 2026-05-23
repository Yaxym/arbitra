-- ARBITRA Database Schema
-- Migration 001: Initial schema for pairs, opportunities, listings and blacklist

-- ============================================
-- TABLE: pairs
-- Хранит все торговые пары со всех CEX и DEX
-- ============================================
CREATE TABLE IF NOT EXISTS pairs (
  id SERIAL PRIMARY KEY,
  
  -- Идентификация
  symbol VARCHAR(32) NOT NULL,     -- "BTC/USDT"
  base VARCHAR(16) NOT NULL,       -- "BTC"
  quote VARCHAR(16) NOT NULL,      -- "USDT"
  venue VARCHAR(32) NOT NULL,      -- "binance", "raydium", "mexc"
  venue_type VARCHAR(8) NOT NULL,  -- "cex" или "dex"
  
  -- Для DEX - адреса контрактов и сеть
  network VARCHAR(16),              -- "SOL", "ETH", "BASE", "ARB", "OP", "MATIC", "BNB", "AVAX", "FTM", "CRO", "LINEA", "ZKSYNC", "BLAST", "MANTLE", "TRX"
  pool_address VARCHAR(128),        -- Адрес пула ликвидности (для DEX)
  base_address VARCHAR(128),        -- Адрес токена base (для DEX)
  quote_address VARCHAR(128),       -- Адрес токена quote (для DEX)
  base_decimals INTEGER DEFAULT 18, -- Децималы base токена
  quote_decimals INTEGER DEFAULT 18,-- Децималы quote токена
  
  -- Метрики ликвидности и объема
  liquidity_usd DECIMAL(20, 4) DEFAULT 0,
  volume_24h_usd DECIMAL(20, 4) DEFAULT 0,
  fee_percent DECIMAL(8, 4) DEFAULT 0.003,  -- Комиссия биржи/пула
  
  -- Статусы доступности
  active BOOLEAN DEFAULT TRUE,              -- Активна ли пара
  deposit_enabled BOOLEAN DEFAULT TRUE,     -- Доступен ли депозит (для CEX)
  withdraw_enabled BOOLEAN DEFAULT TRUE,    -- Доступен ли вывод (для CEX)
  
  -- Метаданные
  discovered_at TIMESTAMP DEFAULT NOW(),    -- Когда впервые обнаружена
  last_seen_at TIMESTAMP DEFAULT NOW(),     -- Последний раз видна
  is_new_listing BOOLEAN DEFAULT FALSE,     -- Флаг нового листинга
  
  -- Ограничения
  CONSTRAINT unique_symbol_venue UNIQUE(symbol, venue)
);

-- ============================================
-- TABLE: opportunities
-- История найденных арбитражных возможностей
-- ============================================
CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  
  -- Идентификация арбитража
  pair_symbol VARCHAR(32) NOT NULL,    -- "BTC/USDT"
  network VARCHAR(16),                 -- Сеть для DEX части
  
  -- Стороны арбитража
  cex_venue VARCHAR(32) NOT NULL,      -- Биржа CEX (покупка или продажа)
  dex_venue VARCHAR(32) NOT NULL,      -- Биржа DEX (продажа или покупка)
  dex_pool_address VARCHAR(128),       -- Адрес пула DEX
  
  -- Направление сделки
  direction VARCHAR(16) NOT NULL,      -- "BUY_CEX_SELL_DEX" или "BUY_DEX_SELL_CEX"
  
  -- Цены и спреды
  cex_price DECIMAL(30, 12) NOT NULL,
  dex_price DECIMAL(30, 12) NOT NULL,
  gross_spread DECIMAL(10, 4) NOT NULL,   -- Грязный спред в %
  net_spread DECIMAL(10, 4) NOT NULL,     -- Чистый спред после комиссий в %
  
  -- Объемы и прибыль
  volume_usd DECIMAL(20, 2),           -- Объем сделки в USD
  estimated_profit_usd DECIMAL(20, 4), -- Расчетная прибыль в USD
  gas_cost_usd DECIMAL(20, 4),         -- Стоимость газа в USD
  
  -- Детали исполнения
  detected_at TIMESTAMP DEFAULT NOW(),
  executed BOOLEAN DEFAULT FALSE,
  executed_at TIMESTAMP,
  
  -- Дополнительные данные
  route_data JSONB,                    -- Данные о маршруте (для DEX)
  metadata JSONB                       -- Дополнительные метаданные
);

-- ============================================
-- TABLE: new_listings
-- Отслеживание новых листингов токенов
-- ============================================
CREATE TABLE IF NOT EXISTS new_listings (
  id SERIAL PRIMARY KEY,
  
  -- Информация о листинге
  symbol VARCHAR(32) NOT NULL,
  base VARCHAR(16) NOT NULL,
  quote VARCHAR(16) NOT NULL,
  venue VARCHAR(32) NOT NULL,      -- Биржа листинга
  network VARCHAR(16),             -- Сеть (для DEX)
  
  -- Временные метки
  detected_at TIMESTAMP DEFAULT NOW(),
  listing_time TIMESTAMP,          -- Время самого листинга (если известно)
  
  -- Статус уведомления
  notified BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMP,
  
  -- Дополнительно
  metadata JSONB
);

-- ============================================
-- TABLE: blacklist
-- Черный список пар для исключения из сканирования
-- ============================================
CREATE TABLE IF NOT EXISTS blacklist (
  symbol VARCHAR(32) PRIMARY KEY,
  venue VARCHAR(32),               -- Если NULL - блокируется на всех биржах
  reason TEXT,
  added_by VARCHAR(64) DEFAULT 'system',
  added_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP             -- Если NULL - бессрочно
);

-- ============================================
-- TABLE: executed_trades
-- История исполненных сделок (для трекинга прибыли)
-- ============================================
CREATE TABLE IF NOT EXISTS executed_trades (
  id SERIAL PRIMARY KEY,
  
  -- Ссылка на возможность
  opportunity_id INTEGER REFERENCES opportunities(id),
  
  -- Детали сделки
  pair_symbol VARCHAR(32) NOT NULL,
  cex_venue VARCHAR(32) NOT NULL,
  dex_venue VARCHAR(32) NOT NULL,
  direction VARCHAR(16) NOT NULL,
  
  -- Цены исполнения
  buy_price DECIMAL(30, 12) NOT NULL,
  sell_price DECIMAL(30, 12) NOT NULL,
  amount DECIMAL(30, 12) NOT NULL,   -- Количество токена
  
  -- Финансовые результаты
  realized_profit_usd DECIMAL(20, 4),
  gas_cost_usd DECIMAL(20, 4),
  total_fees_usd DECIMAL(20, 4),
  net_profit_usd DECIMAL(20, 4),
  
  -- Статус и хеши транзакций
  status VARCHAR(32) DEFAULT 'pending',  -- pending, completed, failed
  cex_tx_id VARCHAR(128),                -- ID ордера на CEX
  dex_tx_hash VARCHAR(128),              -- Хеш транзакции в блокчейне
  
  -- Временные метки
  executed_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  
  -- Ошибки (если статус failed)
  error_message TEXT,
  
  -- Дополнительно
  metadata JSONB
);

-- ============================================
-- TABLE: scanner_settings
-- Настройки сканера арбитража
-- ============================================
CREATE TABLE IF NOT EXISTS scanner_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(64) UNIQUE NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLE: system_logs
-- Логи работы системы
-- ============================================
CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  log_level VARCHAR(16) NOT NULL,    -- INFO, WARN, ERROR, DEBUG
  component VARCHAR(64) NOT NULL,    -- scanner, executor, connector, etc.
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- Начальные настройки сканера
-- ============================================
INSERT INTO scanner_settings (setting_key, setting_value) VALUES
  ('scan_interval_ms', '{"value": 5000}'),
  ('min_spread_percent', '{"value": 0.5}'),
  ('min_liquidity_usd', '{"value": 10000}'),
  ('max_slippage_percent', '{"value": 1.0}'),
  ('enabled_networks', '{"value": ["SOL", "ETH", "BASE", "ARB", "OP", "MATIC", "BNB", "AVAX"]}'),
  ('enabled_cex', '{"value": ["binance", "mexc", "bybit", "okx", "gate", "kucoin"]}'),
  ('enabled_dex', '{"value": ["raydium", "orca", "jupiter", "uniswap", "aerodrome", "pancakeswap"]}'),
  ('auto_execute', '{"value": false}'),
  ('telegram_notifications', '{"value": true}')
ON CONFLICT (setting_key) DO NOTHING;