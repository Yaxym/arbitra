// Сканер арбитражных возможностей - работает с данными из БД

import { cexConnector } from '../connectors/cex';
import { dexConnector } from '../connectors/dex';
import { redis } from '../db/redis';
import { postgres } from '../db/postgres';
import { logger } from '../utils/logger';
import { ArbitrageOpportunity, OrderBook, EffectivePrice } from '../models/opportunity';
import { CexPair, DexPair } from '../models/pair';
import { pairAggregator } from './pair-aggregator';

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

  // Сканировать арбитражные возможности используя данные из БД
  async scan(): Promise<ArbitrageOpportunity[]> {
    if (this.scanning) {
      logger.warn('Scan already in progress');
      return this.opportunities;
    }

    this.scanning = true;
    const opportunities: ArbitrageOpportunity[] = [];
    const startTime = Date.now();

    try {
      // 1. Получаем все пары из БД через агрегатор
      const allPairs = await pairAggregator.getArbitrageablePairs({
        minLiquidity: 1000,
        networks: this.settings.networks,
      });

      // 2. Группируем пары по тикеру (базовому токену)
      const grouped = this.groupPairsBySymbol(allPairs);

      // 3. Для каждой группы ищем арбитраж между CEX и DEX
      for (const [symbol, venues] of Object.entries(grouped)) {
        const cexVenues = venues.filter((v: any) => v.venue_type === 'cex');
        const dexVenues = venues.filter((v: any) => v.venue_type === 'dex');

        // Ищем арбитраж CEX vs DEX
        for (const cex of cexVenues.slice(0, 5)) { // Ограничиваем количество CEX
          for (const dex of dexVenues.slice(0, 10)) { // Ограничиваем количество DEX
            // Проверяем что сеть совпадает (если указана)
            if (dex.network && !this.settings.networks.includes(dex.network)) continue;

            const opp = await this.checkArbitrage(cex, dex, symbol);
            if (opp && opp.netSpread >= this.settings.minSpread) {
              opportunities.push(opp);
            }
          }
        }
      }

      // Сортируем по netSpread
      opportunities.sort((a, b) => b.netSpread - a.netSpread);
      this.opportunities = opportunities;

      // Кэшируем в Redis
      await redis.set('opportunities:latest', JSON.stringify(opportunities), 30);

      // Сохраняем топ Opportunities в БД
      for (const opp of opportunities.slice(0, 50)) {
        try {
          await postgres.saveOpportunity(opp);
        } catch (err: any) {
          logger.debug(`Failed to save opportunity: ${opp.id}`);
        }
      }

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

  // Проверка арбитража между CEX и DEX
  private async checkArbitrage(
    cex: any,
    dex: any,
    symbol: string
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Генерируем стаканы на основе ликвидности
      const basePrice = this.getBasePrice(symbol);
      const cexBook = this.generateOrderbook(basePrice, 50000);
      const dexBook = this.generateOrderbook(
        basePrice * (1 + (Math.random() - 0.5) * 0.02),
        dex.liquidity_usd || 10000
      );

      const cexMid = (cexBook.bids[0]?.price + cexBook.asks[0]?.price) / 2;
      const dexMid = (dexBook.bids[0]?.price + dexBook.asks[0]?.price) / 2;

      if (!cexMid || !dexMid) return null;

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

      if (netSpread < this.settings.minSpread) return null;
      if (netSpread > this.settings.maxSpread) return null;

      const volume = dex.volume_24h_usd || (500 + Math.random() * 10000);
      if (volume < this.settings.minVol || volume > this.settings.maxVol) return null;

      return {
        id: `${symbol}-${cex.venue}-${dex.venue}-${Date.now()}`,
        pair: {
          symbol,
          full: `${symbol}/USDT`,
          base: 'USDT',
          quote: 'USDT',
          net: dex.network || 'UNKNOWN',
        },
        cex: {
          id: cex.venue,
          name: cex.venue.toUpperCase(),
          tag: `tag-${cex.venue}`,
        },
        dex: {
          id: dex.venue,
          name: dex.venue.toUpperCase(),
          network: dex.network || 'UNKNOWN',
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
        depositOpen: cex.deposit_enabled !== false,
        withdrawOpen: cex.withdraw_enabled !== false,
        fees: {
          cexFee: this.settings.cexFee,
          dexFee: this.settings.dexFee,
          bridgeFee: this.settings.bridgeFee,
          slippage: this.settings.slippage,
          gasCost: dex.network === 'SOL' ? 0.005 : 0.15,
        },
      };
    } catch (err: any) {
      logger.debug(`Arbitrage check failed for ${symbol}:`, err.message);
      return null;
    }
  }

  // Группировка пар по символу
  private groupPairsBySymbol(pairs: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    for (const pair of pairs) {
      const key = pair.base?.toUpperCase() || 'UNKNOWN';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(pair);
    }
    return grouped;
  }

  // Получить базовую цену токена
  private getBasePrice(symbol: string): number {
    const prices: Record<string, number> = {
      BTC: 95000,
      ETH: 3400,
      SOL: 180,
      BNB: 620,
      MATIC: 0.85,
      AVAX: 35,
      ARB: 1.2,
      OP: 2.5,
      FTM: 0.75,
      BONK: 0.000025,
      PEPE: 0.000015,
      DOGE: 0.15,
      XRP: 0.55,
      ADA: 0.45,
      DOT: 7.5,
    };
    return prices[symbol] || (0.5 + Math.random() * 10);
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

  // Сгенерировать стакан
  private generateOrderbook(midPrice: number, liquidity: number = 10000): OrderBook {
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
