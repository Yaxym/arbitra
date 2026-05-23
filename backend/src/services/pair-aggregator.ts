// Сервис агрегации и обнаружения торговых пар

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { cexConnector } from '../connectors/cex';
import { dexConnector } from '../connectors/dex';
import { postgres } from '../db/postgres';
import { redis } from '../db/redis';
import { logger } from '../utils/logger';
import { CexPair, DexPair } from '../models/pair';

interface NewListing {
  exchange: string;
  symbol: string;
  base: string;
  quote: string;
  listingTime: number;
  networks: any[];
}

class PairAggregator {
  private newListingListeners: ((listing: NewListing) => void)[] = [];
  private knownSymbols: Set<string> = new Set();
  private discoveryInterval?: NodeJS.Timeout;

  constructor() {}

  // Запуск полного цикла обнаружения
  async startDiscoveryLoop(): Promise<void> {
    logger.info('Starting pair discovery loop...');
    
    // 1. Первоначальное сканирование
    await this.fullScan();

    // 2. Подписка на новые листинги через WebSocket
    this.startNewListingDetection();

    // 3. Периодическое обновление (раз в 30 минут)
    this.discoveryInterval = setInterval(async () => {
      await this.fullScan();
    }, 30 * 60 * 1000);

    logger.success('Pair discovery loop started');
  }

  stopDiscoveryLoop(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = undefined;
    }
    logger.info('Pair discovery loop stopped');
  }

  // Полное сканирование всех бирж
  async fullScan(): Promise<void> {
    logger.info('🔍 Starting full scan of all exchanges...');
    const startTime = Date.now();

    try {
      // CEX - все биржи
      const cexPairs = await this.fetchAllCexPairs();
      await this.upsertPairs(cexPairs, 'cex');

      // DEX - все сети
      const dexPairs = await this.fetchAllDexPairs();
      await this.upsertPairs(dexPairs, 'dex');

      const duration = (Date.now() - startTime) / 1000;
      logger.success(`✅ Full scan completed in ${duration}s`);
      logger.info(`📊 CEX: ${cexPairs.length} pairs, DEX: ${dexPairs.length} pairs`);
      
      // Обновляем кэш в Redis
      await redis.set('stats:lastScan', JSON.stringify({
        timestamp: Date.now(),
        duration,
        cexCount: cexPairs.length,
        dexCount: dexPairs.length,
        total: cexPairs.length + dexPairs.length,
      }), 300);
    } catch (err: any) {
      logger.error('Full scan error:', err.message);
    }
  }

  // Получить все пары CEX
  private async fetchAllCexPairs(): Promise<CexPair[]> {
    const allPairs: CexPair[] = [];
    const cexIds = ['mexc', 'binance', 'bybit', 'okx', 'gate', 'kucoin', 'htx', 'bitget'];
    
    for (const cexId of cexIds) {
      try {
        const pairs = await cexConnector.fetchAllPairs(cexId);
        allPairs.push(...pairs);
        await new Promise(r => setTimeout(r, 300)); // rate limit
      } catch (err: any) {
        logger.warn(`Failed to fetch ${cexId} pairs:`, err.message);
      }
    }
    
    return allPairs;
  }

  // Получить все пары DEX
  private async fetchAllDexPairs(): Promise<DexPair[]> {
    try {
      return await dexConnector.fetchAllDexPairs();
    } catch (err: any) {
      logger.warn('Failed to fetch DEX pairs:', err.message);
      return [];
    }
  }

  // Вставка/обновление пар в БД
  private async upsertPairs(pairs: (CexPair | DexPair)[], venueType: 'cex' | 'dex'): Promise<void> {
    if (pairs.length === 0) return;

    const batchSize = 500;
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      
      for (const pair of batch) {
        try {
          const isDex = venueType === 'dex';
          const dexPair = pair as DexPair;
          const cexPair = pair as CexPair;
          
          await postgres.query(`
            INSERT INTO pairs (
              symbol, base, quote, venue, venue_type, network,
              pool_address, base_address, quote_address,
              base_decimals, quote_decimals,
              liquidity_usd, volume_24h_usd, fee_percent,
              active, deposit_enabled, withdraw_enabled,
              discovered_at, last_seen_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW()
            )
            ON CONFLICT (symbol, venue) DO UPDATE SET
              liquidity_usd = EXCLUDED.liquidity_usd,
              volume_24h_usd = EXCLUDED.volume_24h_usd,
              last_seen_at = NOW(),
              active = TRUE
          `, [
            'symbol' in cexPair ? cexPair.symbol : `${dexPair.baseToken?.symbol}/USDT`,
            'base' in cexPair ? cexPair.base : dexPair.baseToken?.symbol,
            'quote' in cexPair ? cexPair.quote : 'USDT',
            'exchange' in cexPair ? cexPair.exchange : dexPair.dex,
            venueType,
            dexPair.network || null,
            dexPair.poolAddress || null,
            dexPair.baseToken?.address || null,
            dexPair.quoteToken?.address || null,
            'precision' in cexPair ? cexPair.precision?.amount : dexPair.baseToken?.decimals || 18,
            'precision' in cexPair ? cexPair.precision?.price : dexPair.quoteToken?.decimals || 18,
            dexPair.liquidity || 0,
            dexPair.volume24h || 0,
            dexPair.fees || 0.003,
            true,
            'depositEnabled' in cexPair ? cexPair.depositEnabled ?? true : true,
            'withdrawEnabled' in cexPair ? cexPair.withdrawEnabled ?? true : true,
          ]);
        } catch (err: any) {
          const pairSymbol = 'symbol' in pair ? pair.symbol : `${pair.baseToken?.symbol}/USDT`;
          logger.debug(`Failed to upsert pair ${pairSymbol}:`, err.message);
        }
      }
    }
  }

  // Отслеживание новых листингов
  private startNewListingDetection(): void {
    // Простая эвристика: сравниваем текущие пары с известными
    setInterval(async () => {
      try {
        const result = await postgres.query(`
          SELECT symbol, base, quote, venue, venue_type, discovered_at
          FROM pairs
          WHERE discovered_at > NOW() - INTERVAL '5 minutes'
            AND is_new_listing = FALSE
        `);
        
        for (const row of result.rows) {
          const listing: NewListing = {
            exchange: row.venue,
            symbol: row.symbol,
            base: row.base,
            quote: row.quote,
            listingTime: new Date(row.discovered_at).getTime(),
            networks: [],
          };
          
          // Помечаем как новый листинг
          await postgres.query(`
            UPDATE pairs SET is_new_listing = TRUE
            WHERE symbol = $1 AND venue = $2
          `, [row.symbol, row.venue]);
          
          // Сохраняем в таблицу new_listings
          await postgres.query(`
            INSERT INTO new_listings (symbol, base, quote, venue)
            VALUES ($1, $2, $3, $4)
          `, [row.symbol, row.base, row.quote, row.venue]);
          
          // Уведомляем слушателей
          this.newListingListeners.forEach(cb => cb(listing));
          
          logger.info(`🆕 New listing detected: ${row.symbol} on ${row.venue}`);
        }
      } catch (err: any) {
        logger.debug('New listing detection error:', err.message);
      }
    }, 30000); // Проверка каждые 30 секунд
  }

  // Подписка на новые листинги
  onNewListing(cb: (listing: NewListing) => void): void {
    this.newListingListeners.push(cb);
  }

  // Получить пары для арбитража
  async getArbitrageablePairs(filters: {
    minLiquidity?: number;
    networks?: string[];
    onlyNewListings?: boolean;
  } = {}): Promise<any[]> {
    let query = `
      SELECT * FROM pairs
      WHERE active = TRUE
        AND liquidity_usd >= $1
        AND symbol NOT IN (SELECT symbol FROM blacklist)
    `;
    const params: any[] = [filters.minLiquidity || 1000];
    let paramIdx = 2;

    if (filters.networks && filters.networks.length > 0) {
      query += ` AND network = ANY($${paramIdx})`;
      params.push(filters.networks);
      paramIdx++;
    }

    if (filters.onlyNewListings) {
      query += ` AND is_new_listing = TRUE`;
    }

    query += ` ORDER BY liquidity_usd DESC LIMIT 10000`;

    const result = await postgres.query(query, params);
    return result.rows;
  }

  // Сгруппировать пары по символу
  async getGroupedPairs(): Promise<Map<string, any[]>> {
    const result = await postgres.query(`
      SELECT * FROM pairs 
      WHERE active = TRUE 
        AND liquidity_usd > 1000
      ORDER BY liquidity_usd DESC
    `);
    
    const grouped = new Map<string, any[]>();
    for (const row of result.rows) {
      const key = row.base.toUpperCase();
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(row);
    }
    
    return grouped;
  }
}

export const pairAggregator = new PairAggregator();
export default pairAggregator;
