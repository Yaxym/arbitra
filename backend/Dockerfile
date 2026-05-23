FROM node:20-alpine

WORKDIR /app

# Копируем зависимости
COPY package*.json ./

# Устанавливаем все зависимости (включая dev для компиляции)
RUN npm ci

# Копируем исходный код
COPY . .

# Компилируем TypeScript в JavaScript
RUN npm run build

# Удаляем dev-зависимости после сборки для уменьшения размера (опционально)
# RUN npm prune --production

EXPOSE 4000

# Запускаем скомпилированный код
CMD ["node", "dist/index.js"]
