-- ARBITRA Database Indexes
-- Migration 002: Performance indexes for all major queries

-- ============================================
-- INDEXES: pairs table
-- ============================================

-- Поиск по символу пары (основной запрос сканера)
CREATE INDEX IF NOT EXISTS idx_pairs_symbol ON pairs(symbol);

-- Поиск по базовому токену (для группировки)
CREATE INDEX IF NOT EXISTS idx_pairs_base ON pairs(base);

-- Поиск по бирже/площадке
CREATE INDEX IF NOT EXISTS idx_pairs_venue ON pairs(venue);

-- Поиск по сети (для фильтрации DEX)
CREATE INDEX IF NOT EXISTS idx_pairs_network ON pairs(network);

-- Фильтрация активных пар
CREATE INDEX IF NOT EXISTS idx_pairs_active ON pairs(active) WHERE active = TRUE;

-- Сортировка по ликвидности (для отбора лучших пар)
CREATE INDEX IF NOT EXISTS idx_pairs_liquidity_desc ON pairs(liquidity_usd DESC);

-- Сортировка по объему за 24ч
CREATE INDEX IF NOT EXISTS idx_pairs_volume_24h_desc ON pairs(volume_24h_usd DESC);

-- Новые листинги (быстрый доступ к свежим парам)
CREATE INDEX IF NOT EXISTS idx_pairs_new_listing ON pairs(discovered_at DESC) 
  WHERE is_new_listing = TRUE;

-- Комбинированный индекс для основного запроса сканера
CREATE INDEX IF NOT EXISTS idx_pairs_active_liquid_network 
  ON pairs(active, network, liquidity_usd DESC) 
  WHERE active = TRUE AND liquidity_usd > 0;

-- Индекс для поиска пар на конкретной бирже с фильтром по активности
CREATE INDEX IF NOT EXISTS idx_pairs_venue_active 
  ON pairs(venue, active) 
  WHERE active = TRUE;

-- ============================================
-- INDEXES: opportunities table
-- ============================================

-- Поиск по символу пары
CREATE INDEX IF NOT EXISTS idx_opportunities_symbol ON opportunities(pair_symbol);

-- Поиск по сети
CREATE INDEX IF NOT EXISTS idx_opportunities_network ON opportunities(network);

-- Фильтрация неисполненных возможностей
CREATE INDEX IF NOT EXISTS idx_opportunities_not_executed 
  ON opportunities(executed) 
  WHERE executed = FALSE;

-- Сортировка по времени обнаружения (последние сначала)
CREATE INDEX IF NOT EXISTS idx_opportunities_detected_at 
  ON opportunities(detected_at DESC);

-- Сортировка по чистому спреду (лучшие возможности)
CREATE INDEX IF NOT EXISTS idx_opportunities_net_spread 
  ON opportunities(net_spread DESC);

-- Комбинированный индекс для активных возможностей
CREATE INDEX IF NOT EXISTS idx_opportunities_active_high_spread 
  ON opportunities(executed, detected_at DESC, net_spread DESC) 
  WHERE executed = FALSE;

-- ============================================
-- INDEXES: new_listings table
-- ============================================

-- Поиск по символу
CREATE INDEX IF NOT EXISTS idx_new_listings_symbol ON new_listings(symbol);

-- Поиск по бирже
CREATE INDEX IF NOT EXISTS idx_new_listings_venue ON new_listings(venue);

-- Фильтрация неуведомленных листингов
CREATE INDEX IF NOT EXISTS idx_new_listings_not_notified 
  ON new_listings(notified) 
  WHERE notified = FALSE;

-- Сортировка по времени обнаружения
CREATE INDEX IF NOT EXISTS idx_new_listings_detected_at 
  ON new_listings(detected_at DESC);

-- ============================================
-- INDEXES: blacklist table
-- ============================================

-- Индекс уже создан через PRIMARY KEY (symbol)
-- Дополнительный индекс по venue для частичных блокировок
CREATE INDEX IF NOT EXISTS idx_blacklist_venue ON blacklist(venue);

-- Индекс для проверки срока действия
CREATE INDEX IF NOT EXISTS idx_blacklist_expires 
  ON blacklist(expires_at) 
  WHERE expires_at IS NOT NULL;

-- ============================================
-- INDEXES: executed_trades table
-- ============================================

-- Поиск по ID возможности
CREATE INDEX IF NOT EXISTS idx_executed_trades_opportunity_id 
  ON executed_trades(opportunity_id);

-- Поиск по символу пары
CREATE INDEX IF NOT EXISTS idx_executed_trades_symbol 
  ON executed_trades(pair_symbol);

-- Фильтрация по статусу
CREATE INDEX IF NOT EXISTS idx_executed_trades_status 
  ON executed_trades(status);

-- Сортировка по времени исполнения
CREATE INDEX IF NOT EXISTS idx_executed_trades_executed_at 
  ON executed_trades(executed_at DESC);

-- Индекс для подсчета прибыли по датам
CREATE INDEX IF NOT EXISTS idx_executed_trades_profit_date 
  ON executed_trades(executed_at, net_profit_usd) 
  WHERE status = 'completed';

-- ============================================
-- INDEXES: scanner_settings table
-- ============================================

-- Уникальный индекс уже создан через UNIQUE(setting_key)
-- Дополнительный индекс не нужен, т.к. таблица маленькая

-- ============================================
-- INDEXES: system_logs table
-- ============================================

-- Поиск по уровню лога
CREATE INDEX IF NOT EXISTS idx_system_logs_level 
  ON system_logs(log_level);

-- Поиск по компоненту
CREATE INDEX IF NOT EXISTS idx_system_logs_component 
  ON system_logs(component);

-- Сортировка по времени создания
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at 
  ON system_logs(created_at DESC);

-- Комбинированный индекс для частых запросов
CREATE INDEX IF NOT EXISTS idx_system_logs_component_time 
  ON system_logs(component, created_at DESC);

-- Индекс для ошибок и предупреждений
CREATE INDEX IF NOT EXISTS idx_system_logs_errors 
  ON system_logs(created_at DESC) 
  WHERE log_level IN ('ERROR', 'WARN');

-- ============================================
-- Обновление статистики анализатора PostgreSQL
-- ============================================
ANALYZE pairs;
ANALYZE opportunities;
ANALYZE new_listings;
ANALYZE blacklist;
ANALYZE executed_trades;
ANALYZE scanner_settings;
ANALYZE system_logs;