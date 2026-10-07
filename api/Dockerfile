# Etapa 1: instala dependencias y compila TypeScript
FROM node:22-slim AS construccion
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Etapa 2: imagen final, solo con lo necesario para correr
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=construccion /app/package.json ./
COPY --from=construccion /app/node_modules ./node_modules
COPY --from=construccion /app/dist ./dist
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
