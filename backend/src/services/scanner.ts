// Сканер арбитражных возможностей

import { cexConnector } from '../connectors/cex';
import { dexConnector } from '../connectors/dex';
import { redis } from '../db/redis';
import { postgres } from '../db/postgres';
import { logger } from '../utils/logger';
import { ArbitrageOpportunity, OrderBook, EffectivePrice } from '../models/opportunity';
import { CexPair, DexPair } from '../models/pair';

interface ScannerSettings {
  minSpread: number;
  maxSpread: number;
  minVol: number;
  maxVol: number;
  networks: string[];
  cexFee: number;
  dexFee: number;
  bridgeFee: number;
  slippage: number;
  onlyOpenIO: boolean;
}

class ArbitrageScanner {
  private cexPairs: Map<string, CexPair[]> = new Map();
  private dexPairs: Map<string, DexPair[]> = new Map();
  private opportunities: ArbitrageOpportunity[] = [];
  private settings: ScannerSettings = {
    minSpread: 1.5,
    maxSpread: 50,
    minVol: 500,
    maxVol: 50000,
    networks: ['SOL', 'BASE', 'ETH', 'ARB'],
    cexFee: 0.1,
    dexFee: 0.3,
    bridgeFee: 0.2,
    slippage: 1.0,
    onlyOpenIO: false,
  };
  private scanning: boolean = false;
  private scanInterval?: NodeJS.Timeout;

  // Обновить настройки
  updateSettings(newSettings: Partial<ScannerSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    logger.info('Scanner settings updated:', this.settings);
  }

  // Загрузить пары со всех бирж
  async loadPairs(): Promise<void> {
    logger.info('Loading CEX pairs...');
    
    // Загружаем CEX пары для каждой биржи
    const cexIds = ['mexc', 'binance', 'bybit', 'okx', 'kucoin'];
    for (const cexId of cexIds) {
      try {
        const pairs = await cexConnector.fetchAllPairs(cexId);
        this.cexPairs.set(cexId, pairs);
        logger.info(`${cexId}: ${pairs.length} pairs`);
      } catch (err: any) {
        logger.warn(`Failed to load ${cexId} pairs:`, err.message);
      }
    }

    logger.info('Loading DEX pairs...');
    try {
      const allDexPairs = await dexConnector.fetchAllDexPairs();
      // Группируем по сетям
      const byNetwork = new Map<string, DexPair[]>();
      for (const pair of allDexPairs) {
        const existing = byNetwork.get(pair.network) || [];
        existing.push(pair);
        byNetwork.set(pair.network, existing);
      }
      this.dexPairs = byNetwork;
      logger.success(`Loaded ${allDexPairs.length} total DEX pairs`);
    } catch (err: any) {
      logger.warn('Failed to load DEX pairs:', err.message);
    }
  }

  // Сканировать арбитражные возможности
  async scan(): Promise<ArbitrageOpportunity[]> {
    if (this.scanning) {
      logger.warn('Scan already in progress');
      return this.opportunities;
    }

    this.scanning = true;
    const opportunities: ArbitrageOpportunity[] = [];
    const startTime = Date.now();

    try {
      // Для каждой сети ищем арбитраж между CEX и DEX
      for (const network of this.settings.networks) {
        const dexPairsForNet = this.dexPairs.get(network) || [];
        
        for (const dexPair of dexPairsForNet.slice(0, 200)) {
          // Ищем соответствующие пары на CEX
          const symbol = dexPair.baseToken.symbol;
          
          for (const [cexId, cexPairs] of this.cexPairs.entries()) {
            const cexPair = cexPairs.find(p => 
              p.base === symbol && 
              (p.quote === 'USDT' || p.quote === 'USDC')
            );

            if (!cexPair) continue;

            // Генерируем фиктивные стаканы для демо-режима
            const cexBook = this.generateMockOrderbook(dexPair.liquidity > 0 ? 
              dexPair.baseToken.symbol === 'SOL' ? 180 : 
              dexPair.baseToken.symbol === 'ETH' ? 3400 : 1 : 0.5);
            
            const dexBook = this.generateMockOrderbook(
              cexBook.bids[0]?.price * 1.02, // DEX цена немного выше
              dexPair.liquidity
            );

            // Рассчитываем спред
            const cexMid = (cexBook.bids[0]?.price + cexBook.asks[0]?.price) / 2;
            const dexMid = (dexBook.bids[0]?.price + dexBook.asks[0]?.price) / 2;
            
            if (!cexMid || !dexMid) continue;

            const rawSpread = (dexMid - cexMid) / cexMid;
            const direction = rawSpread > 0 ? 'CEX→DEX' : 'DEX→CEX';
            
            const buyEff = this.calculateEffectivePrice(
              direction === 'CEX→DEX' ? cexBook.bids : dexBook.bids,
              'buy',
              100
            );
            const sellEff = this.calculateEffectivePrice(
              direction === 'CEX→DEX' ? dexBook.asks : cexBook.asks,
              'sell',
              100
            );

            const grossSpread = ((sellEff.price - buyEff.price) / buyEff.price) * 100;
            const fees = this.settings.cexFee + this.settings.dexFee + 
                        (direction === 'CEX→DEX' ? this.settings.bridgeFee : 0) + 
                        this.settings.slippage;
            const netSpread = grossSpread - fees;

            // Фильтруем по параметрам
            if (netSpread < this.settings.minSpread) continue;
            if (netSpread > this.settings.maxSpread) continue;

            const volume = dexPair.volume24h || (500 + Math.random() * 10000);
            if (volume < this.settings.minVol || volume > this.settings.maxVol) continue;

            opportunities.push({
              id: `${symbol}-${cexId}-${dexPair.dex}-${Date.now()}`,
              pair: {
                symbol,
                full: `${symbol}/USDT`,
                base: 'USDT',
                quote: 'USDT',
                net: network,
              },
              cex: {
                id: cexId,
                name: cexId.toUpperCase(),
                tag: `tag-${cexId}`,
              },
              dex: {
                id: dexPair.dex,
                name: dexPair.dex.toUpperCase(),
                network,
              },
              direction,
              buyEff,
              sellEff,
              cexBook,
              dexBook,
              grossSpread,
              netSpread,
              volume24h: volume,
              timestamp: Date.now(),
              depositOpen: Math.random() > 0.15,
              withdrawOpen: Math.random() > 0.2,
              fees: {
                cexFee: this.settings.cexFee,
                dexFee: this.settings.dexFee,
                bridgeFee: this.settings.bridgeFee,
                slippage: this.settings.slippage,
                gasCost: network === 'SOL' ? 0.005 : 0.15,
              },
            });
          }
        }
      }

      // Сортируем по netSpread
      opportunities.sort((a, b) => b.netSpread - a.netSpread);
      this.opportunities = opportunities;

      // Кэшируем в Redis
      await redis.set('opportunities:latest', JSON.stringify(opportunities), 30);

      const duration = Date.now() - startTime;
      logger.success(`Scan complete: ${opportunities.length} opportunities in ${duration}ms`);

      return opportunities;
    } catch (err: any) {
      logger.error('Scan error:', err.message);
      return [];
    } finally {
      this.scanning = false;
    }
  }

  // Запустить периодическое сканирование
  startPeriodicScan(intervalMs: number = 8000): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    this.scanInterval = setInterval(async () => {
      await this.scan();
    }, intervalMs);

    logger.info(`Periodic scan started with ${intervalMs}ms interval`);
  }

  stopPeriodicScan(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
      logger.info('Periodic scan stopped');
    }
  }

  // Получить текущие возможности
  getOpportunities(): ArbitrageOpportunity[] {
    return this.opportunities;
  }

  // Сгенерировать фиктивный стакан
  private generateMockOrderbook(midPrice: number, liquidity: number = 10000): OrderBook {
    const bids: Array<{ price: number; size: number; total: number }> = [];
    const asks: Array<{ price: number; size: number; total: number }> = [];
    
    let bidTotal = 0;
    let askTotal = 0;

    for (let i = 0; i < 20; i++) {
      const bidP = midPrice * (1 - 0.003 * (i + 1));
      const askP = midPrice * (1 + 0.003 * (i + 1));
      const bidSize = (Math.random() * 50 + 10) * (1 + i * 0.3);
      const askSize = (Math.random() * 50 + 10) * (1 + i * 0.3);
      
      bidTotal += bidP * bidSize;
      askTotal += askP * askSize;
      
      bids.push({ price: bidP, size: bidSize, total: bidTotal });
      asks.push({ price: askP, size: askSize, total: askTotal });
    }

    return { bids, asks, timestamp: Date.now() };
  }

  // Рассчитать эффективную цену
  private calculateEffectivePrice(
    levels: Array<{ price: number; size: number; total: number }>,
    side: 'buy' | 'sell',
    minUsd: number
  ): EffectivePrice {
    for (const lvl of levels) {
      const usdVal = lvl.price * lvl.size;
      if (usdVal >= minUsd) {
        return {
          price: lvl.price,
          size: lvl.size,
          usd: usdVal,
          skippedLevels: levels.indexOf(lvl),
          side,
          isLimit: false,
        };
      }
    }

    const last = levels[levels.length - 1];
    return {
      price: last?.price || 0,
      size: last?.size || 0,
      usd: (last?.price || 0) * (last?.size || 0),
      skippedLevels: levels.length - 1,
      fallback: true,
      side,
      isLimit: false,
    };
  }
}

export const scanner = new ArbitrageScanner();
export default scanner;
