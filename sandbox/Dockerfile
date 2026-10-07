# Imagen oficial de Playwright para Node: ya trae Chromium y el usuario pwuser.
# La version debe coincidir con la de playwright en package.json.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

USER pwuser
ENV PUERTO=9000
EXPOSE 9000

CMD ["node", "dist/index.js"]
