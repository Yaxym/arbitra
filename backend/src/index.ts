// Точка входа приложения ARBITRA

import config from './config';
import { logger } from './utils/logger';
import { apiServer } from './api/server';
import { scanner } from './services/scanner';
import { pairAggregator } from './services/pair-aggregator';
import { cexConnector } from './connectors/cex';
import { dexConnector } from './connectors/dex';
import { postgres } from './db/postgres';
import { redis } from './db/redis';

async function main(): Promise<void> {
  logger.info('🚀 Starting ARBITRA backend...');

  try {
    // Инициализация базы данных
    await postgres.init();

    // Инициализация Redis
    await redis.connect();

    // Инициализация коннекторов
    await cexConnector.init();

    // Запуск агрегатора пар (обнаружение всех пар на биржах)
    await pairAggregator.startDiscoveryLoop();

    // Небольшая задержка перед первым сканированием
    await new Promise(r => setTimeout(r, 3000));

    // Запуск API сервера
    await apiServer.start(config.port);

    // Запуск периодического сканирования арбитража
    scanner.startPeriodicScan(8000);

    // Отправка обновлений через WebSocket каждые 2 секунды
    setInterval(() => {
      const opps = scanner.getOpportunities();
      apiServer.broadcast({
        type: 'opportunities',
        data: opps,
        timestamp: Date.now(),
      });
    }, 2000);

    logger.success('✅ ARBITRA backend is running!');
    logger.info(`API: http://localhost:${config.port}`);
    logger.info(`WebSocket: ws://localhost:${config.port}/ws`);
    logger.info('Pair discovery loop started - scanning all exchanges...');

  } catch (err: any) {
    logger.error('Startup error:', err.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  scanner.stopPeriodicScan();
  pairAggregator.stopDiscoveryLoop();
  await apiServer.stop();
  await postgres.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  scanner.stopPeriodicScan();
  pairAggregator.stopDiscoveryLoop();
  await apiServer.stop();
  await postgres.close();
  process.exit(0);
});

main();
