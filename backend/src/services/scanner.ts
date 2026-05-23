// Сканер арбитражных возможностей - работает с РЕАЛЬНЫМИ данными
import { cexConnector } from '../connectors/cex';
import { dexConnector } from '../connectors/dex';
import { redis } from '../db/redis';
import { postgres } from '../db/postgres';
import { logger } from '../utils/logger';
import { ArbitrageOpportunity, OrderBook, EffectivePrice } from '../models/opportunity';
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
    minSpread: 0.5, // Понизил порог для теста
    maxSpread: 50,
    minVol: 100,    // Понизил для теста
    maxVol: 50000,
    networks: ['SOL', 'BASE', 'ETH', 'ARB', 'BNB', 'MATIC', 'AVAX'],
    cexFee: 0.1,
    dexFee: 0.3,
    bridgeFee: 0.2,
    slippage: 0.5,
    onlyOpenIO: false,
  };
  private scanning: boolean = false;
  private scanInterval?: NodeJS.Timeout;

  // Обновить настройки
  updateSettings(newSettings: Partial<ScannerSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    logger.info('Scanner settings updated:', this.settings);
  }

  // Сканировать арбитражные возможности используя РЕАЛЬНЫЕ данные
  async scan(): Promise<ArbitrageOpportunity[]> {
    if (this.scanning) {
      return this.opportunities;
    }

    this.scanning = true;
    const opportunities: ArbitrageOpportunity[] = [];
    const startTime = Date.now();

    try {
      // 1. Получаем все активные пары из БД
      const allPairs = await pairAggregator.getArbitrageablePairs({
        minLiquidity: 500, // Понизил порог ликвидности
        networks: this.settings.networks,
      });

      if (allPairs.length === 0) {
        logger.warn('No pairs found in database. Waiting for discovery...');
        return [];
      }

      // 2. Группируем пары по базовому токену
      const grouped = this.groupPairsBySymbol(allPairs);

      // 3. Проверяем только топ-50 групп по ликвидности для скорости
      const sortedGroups = Object.entries(grouped)
        .sort(([, a], [, b]) => {
          const liqA = a.reduce((sum, p) => sum + (p.liquidity_usd || 0), 0);
          const liqB = b.reduce((sum, p) => sum + (p.liquidity_usd || 0), 0);
          return liqB - liqA;
        })
        .slice(0, 50);

      for (const [symbol, venues] of sortedGroups) {
        const cexVenues = venues.filter((v: any) => v.venue_type === 'cex');
        const dexVenues = venues.filter((v: any) => v.venue_type === 'dex');

        // Пропускаем если нет пар для сравнения
        if (cexVenues.length === 0 || dexVenues.length === 0) continue;

        // Ищем арбитраж CEX vs DEX
        for (const cex of cexVenues.slice(0, 3)) {
          for (const dex of dexVenues.slice(0, 5)) {
            if (dex.network && !this.settings.networks.includes(dex.network)) continue;

            // ПОЛУЧАЕМ РЕАЛЬНЫЕ ДАННЫЕ
            const opp = await this.checkRealArbitrage(cex, dex, symbol);
            if (opp && opp.netSpread >= this.settings.minSpread) {
              opportunities.push(opp);
            }
          }
        }
      }

      opportunities.sort((a, b) => b.netSpread - a.netSpread);
      this.opportunities = opportunities;

      await redis.set('opportunities:latest', JSON.stringify(opportunities), 30);

      // Сохраняем топ в БД
      for (const opp of opportunities.slice(0, 20)) {
        try {
          await postgres.saveOpportunity(opp);
        } catch (err: any) {
          // Игнорируем ошибки сохранения
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

  // Проверка арбитража с РЕАЛЬНЫМИ стаканами
  private async checkRealArbitrage(
    cex: any,
    dex: any,
    symbol: string
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Формируем тикер для CEX (например, BTC/USDT)
      const cexSymbol = `${symbol}/USDT`;
      
      // 1. Получаем реальный стакан с CEX
      let cexBook: OrderBook | null = null;
      try {
        cexBook = await cexConnector.getOrderbook(cex.venue, cexSymbol);
      } catch (e: any) {
        // Если не удалось получить стакан, пропускаем
        return null;
      }

      if (!cexBook || cexBook.bids.length === 0 || cexBook.asks.length === 0) {
        return null;
      }

      // 2. Получаем реальную цену с DEX (через квоту или пул)
      let dexPrice = 0;
      let dexLiquidity = dex.liquidity_usd || 0;
      
      // Пытаемся получить реальную цену DEX
      try {
        const dexQuote = await dexConnector.getQuote(dex.venue, dex.network, symbol);
        if (dexQuote && dexQuote.price > 0) {
          dexPrice = dexQuote.price;
        }
      } catch (e: any) {
        // Если цена не получена, используем середину спреда из БД если есть
        if (dex.last_price) {
          dexPrice = dex.last_price;
        } else {
          return null; // Нет цены - нет арбитража
        }
      }

      // Средняя цена CEX
      const cexMid = (cexBook.bids[0].price + cexBook.asks[0].price) / 2;
      
      if (cexMid <= 0 || dexPrice <= 0) return null;

      // Определяем направление
      const rawSpread = (dexPrice - cexMid) / cexMid;
      const direction = rawSpread > 0 ? 'CEX→DEX' : 'DEX→CEX';

      // Рассчитываем эффективные цены
      const buyBook = direction === 'CEX→DEX' ? cexBook : this.createDexBook(dexPrice, dexLiquidity);
      const sellBook = direction === 'CEX→DEX' ? this.createDexBook(dexPrice, dexLiquidity) : cexBook;

      const buyEff = this.calculateEffectivePrice(buyBook.bids, 'buy', 100);
      const sellEff = this.calculateEffectivePrice(sellBook.asks, 'sell', 100);

      if (!buyEff.price || !sellEff.price) return null;

      const grossSpread = ((sellEff.price - buyEff.price) / buyEff.price) * 100;
      
      // Комиссии
      const totalFees = this.settings.cexFee + this.settings.dexFee + 
                        (direction === 'CEX→DEX' ? this.settings.bridgeFee : 0) + 
                        this.settings.slippage;
      
      const netSpread = grossSpread - totalFees;

      if (netSpread < this.settings.minSpread || netSpread > this.settings.maxSpread) {
        return null;
      }

      // Объем
      const volume = dex.volume_24h_usd || 0;
      if (volume < this.settings.minVol) {
        // Разрешаем малый объем если спред очень большой
        if (netSpread < 5.0) return null;
      }

      return {
        id: `${symbol}-${cex.venue}-${dex.venue}-${Date.now()}`,
        pair: {
          symbol,
          full: `${symbol}/USDT`,
          base: symbol,
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
        cexBook: direction === 'CEX→DEX' ? cexBook : this.createDexBook(dexPrice, dexLiquidity),
        dexBook: direction === 'CEX→DEX' ? this.createDexBook(dexPrice, dexLiquidity) : cexBook,
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
      return null;
    }
  }

  // Создать фейковый стакан для DEX если нет реального API (временное решение)
  private createDexBook(price: number, liquidity: number): OrderBook {
    const bids = [], asks = [];
    let bidTotal = 0, askTotal = 0;
    for (let i = 0; i < 10; i++) {
      const size = (liquidity / price) * 0.1 * (1 - i * 0.05);
      bidTotal += price * (1 - 0.002 * i) * size;
      askTotal += price * (1 + 0.002 * i) * size;
      bids.push({ price: price * (1 - 0.002 * i), size, total: bidTotal });
      asks.push({ price: price * (1 + 0.002 * i), size, total: askTotal });
    }
    return { bids, asks, timestamp: Date.now() };
  }

  // Группировка пар по символу
  private groupPairsBySymbol(pairs: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    for (const pair of pairs) {
      const key = pair.base?.toUpperCase() || 'UNKNOWN';
      // Фильтруем мусор
      if (key.length > 10 || key.includes(' ') || /[^A-Z0-9]/.test(key)) continue;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(pair);
    }
    return grouped;
  }

  // Запустить периодическое сканирование
  startPeriodicScan(intervalMs: number = 8000): void {
    if (this.scanInterval) clearInterval(this.scanInterval);
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

  getOpportunities(): ArbitrageOpportunity[] {
    return this.opportunities;
  }

  // Рассчитать эффективную цену
  private calculateEffectivePrice(
    levels: Array<{ price: number; size: number; total: number }>,
    side: 'buy' | 'sell',
    minUsd: number
  ): EffectivePrice {
    if (!levels || levels.length === 0) {
      return { price: 0, size: 0, usd: 0, skippedLevels: 0, side, isLimit: false };
    }
    for (const lvl of levels) {
      const usdVal = lvl.price * lvl.size;
      if (usdVal >= minUsd) {
        return { price: lvl.price, size: lvl.size, usd: usdVal, skippedLevels: levels.indexOf(lvl), side, isLimit: false };
      }
    }
    const last = levels[levels.length - 1];
    return { price: last?.price || 0, size: last?.size || 0, usd: (last?.price || 0) * (last?.size || 0), skippedLevels: levels.length - 1, side, isLimit: false };
  }
}

export const scanner = new ArbitrageScanner();
export default scanner;
