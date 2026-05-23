// Express + WebSocket сервер для API

import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import config from '../config';
import { logger } from '../utils/logger';
import { scanner } from '../services/scanner';
import { cexConnector } from '../connectors/cex';
import { dexConnector } from '../connectors/dex';
import { pairAggregator } from '../services/pair-aggregator';

class ApiServer {
  private app: express.Application;
  private httpServer?: HttpServer;
  private wss?: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    }));

    // JSON parser
    this.app.use(express.json());

    // Rate limiting
    this.app.use('/api', rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      message: { error: 'Too many requests, please try again later' },
    }));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Получить арбитражные возможности
    this.app.get('/api/opportunities', async (req, res) => {
      try {
        // Сначала пытаемся получить свежие данные сканированием
        const opps = scanner.getOpportunities();
        
        // Применяем фильтры из query params
        const minSpread = parseFloat(req.query.minSpread as string) || 0;
        const minVol = parseFloat(req.query.minVol as string) || 0;
        const maxVol = parseFloat(req.query.maxVol as string) || Infinity;
        const networks = (req.query.networks as string)?.split(',') || [];

        let filtered = opps.filter(o => o.netSpread >= minSpread);
        
        if (minVol > 0) {
          filtered = filtered.filter(o => o.volume24h >= minVol * 1000); // конвертируем K в полные числа
        }
        if (maxVol < Infinity) {
          filtered = filtered.filter(o => o.volume24h <= maxVol * 1000);
        }
        if (networks.length > 0) {
          filtered = filtered.filter(o => networks.includes(o.pair.net));
        }

        res.json(filtered);
      } catch (err: any) {
        logger.error('Get opportunities error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // Получить стакан CEX
    this.app.get('/api/orderbook/:cex/:symbol', async (req, res) => {
      try {
        const { cex, symbol } = req.params;
        const book = await cexConnector.getOrderbook(cex, symbol);
        res.json(book);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Получить статус депозита/вывода
    this.app.get('/api/io-status/:cex/:currency', async (req, res) => {
      try {
        const { cex, currency } = req.params;
        const status = await cexConnector.getDepositWithdrawStatus(cex, currency);
        res.json(status);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Получить список CEX бирж
    this.app.get('/api/cex/list', (req, res) => {
      res.json(cexConnector.getConnectedExchanges());
    });

    // Получить список DEX и сетей
    this.app.get('/api/dex/list', (req, res) => {
      res.json({
        dexes: dexConnector.getDexList(),
        networks: dexConnector.getNetworkList(),
      });
    });

    // Обновить настройки сканера
    this.app.post('/api/settings', (req, res) => {
      scanner.updateSettings(req.body);
      res.json({ success: true });
    });

    // Запустить сканирование вручную
    this.app.post('/api/scan', async (req, res) => {
      try {
        const opps = await scanner.scan();
        res.json({ success: true, count: opps.length, opportunities: opps });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Получить статистику пар
    this.app.get('/api/stats', async (req, res) => {
      try {
        const grouped = await pairAggregator.getGroupedPairs();
        res.json({
          totalSymbols: grouped.size,
          totalPairs: Array.from(grouped.values()).reduce((sum, arr) => sum + arr.length, 0),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = createServer(this.app);
      
      // WebSocket сервер
      this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
      
      this.wss.on('connection', (ws) => {
        logger.info('WebSocket client connected');
        this.wsClients.add(ws);

        ws.on('close', () => {
          this.wsClients.delete(ws);
          logger.info('WebSocket client disconnected');
        });

        ws.on('error', (err) => {
          logger.warn('WebSocket error:', err.message);
        });
      });

      this.httpServer.listen(port, () => {
        logger.success(`API server running on port ${port}`);
        resolve();
      });
    });
  }

  // Отправить обновления всем WebSocket клиентам
  broadcast(data: any): void {
    const message = JSON.stringify(data);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          logger.info('HTTP server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const apiServer = new ApiServer();
export default apiServer;
