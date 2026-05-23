
# 🔄 ARBITRA — CEX⇄DEX Arbitrage Terminal

Real-time арбитражный сканер, отслеживающий возможности между **15 CEX** и **27 DEX** на **15 блокчейн-сетях**.


## ✨ Возможности

- 🔍 Автоматическое обнаружение всех торговых пар (~80,000+)
- 📊 Real-time сканер арбитражных возможностей
- 🆕 Детектор новых листингов с Telegram-уведомлениями
- 💼 Проверка статуса ввода/вывода на биржах
- 📈 История возможностей и экспорта в CSV
- 🌓 Тёмная и светлая темы (Liquid Glass UI)
- 📱 Полностью адаптивный дизайн

## 🌐 Поддерживаемые сети

| Сеть | DEX |
|------|-----|
| **Solana** | Raydium, Orca, Jupiter |
| **Ethereum** | Uniswap V3, SushiSwap, Curve |
| **Base** | Aerodrome, Uniswap, BaseSwap |
| **Arbitrum** | Camelot, Uniswap, TraderJoe |
| **Optimism** | Velodrome, Uniswap |
| **Polygon** | QuickSwap |
| **BNB Chain** | PancakeSwap |
| **Avalanche** | TraderJoe |
| **Fantom** | SpookySwap |
| **Cronos** | VVS Finance |
| **Linea** | Lynex, SyncSwap |
| **zkSync Era** | SyncSwap, Mute |
| **Blast** | Thruster, Fenix |
| **Mantle** | Merchant Moe |
| **Tron** | SunSwap |

## 🏢 CEX биржи

MEXC · Binance · Bybit · OKX · Gate.io · KuCoin · HTX · Bitget · Kraken · Coinbase · Bitfinex · Crypto.com · BingX · XT.com · Poloniex

## 🚀 Быстрый старт

### Требования
- Node.js 20+
- Docker & Docker Compose
- API-ключи бирж (read-only)
- RPC-эндпоинты (Alchemy/Helius)

### Установка

```bash
# 1. Клонируем репозиторий
git clone https://github.com/YOUR_USERNAME/arbitra.git
cd arbitra

# 2. Копируем .env и заполняем
cp .env.example .env
nano .env

# 3. Запускаем все сервисы
docker-compose up -d

# 4. Открываем в браузере
open http://localhost
