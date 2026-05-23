// Утилиты для форматирования цен и чисел

export function fmtPrice(price: number): string {
  if (price === 0) return '0';
  if (!isFinite(price)) return '—';
  
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(2);
  if (abs >= 1) return price.toFixed(3);
  if (abs >= 0.01) return price.toFixed(4);
  if (abs >= 0.0001) return price.toFixed(6);
  return price.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export function fmtPriceBook(price: number): string {
  if (price === 0) return '0';
  if (!isFinite(price)) return '—';
  
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(2);
  if (abs >= 1) return price.toFixed(3);
  if (abs >= 0.01) return price.toFixed(4);
  if (abs >= 0.0001) return price.toFixed(5);
  return price.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export function fmtVol(volume: number): string {
  if (volume >= 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `$${(volume / 1e3).toFixed(2)}K`;
  return `$${volume.toFixed(2)}`;
}

export function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function calculateEffectivePrice(
  levels: Array<{ price: number; size: number }>,
  side: 'buy' | 'sell',
  minUsd: number,
  isLimit: boolean = false
): { price: number; size: number; usd: number; skippedLevels: number; fallback?: boolean } {
  // Для limit ордеров берем лучшую цену из стакана
  if (isLimit) {
    const bestLevel = side === 'buy' ? levels[0] : levels[levels.length - 1];
    if (bestLevel) {
      return {
        price: bestLevel.price,
        size: bestLevel.size,
        usd: bestLevel.price * bestLevel.size,
        skippedLevels: 0,
      };
    }
  }
  
  // Для market ордеров ищем уровень с достаточной ликвидностью
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const usdVal = level.price * level.size;
    if (usdVal >= minUsd) {
      return {
        price: level.price,
        size: level.size,
        usd: usdVal,
        skippedLevels: i,
      };
    }
  }
  
  // Если не нашли, берем последний доступный уровень
  const last = levels[levels.length - 1] || levels[0];
  return {
    price: last?.price || 0,
    size: last?.size || 0,
    usd: (last?.price || 0) * (last?.size || 0),
    skippedLevels: levels.length - 1,
    fallback: true,
  };
}
