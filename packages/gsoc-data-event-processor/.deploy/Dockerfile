FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g typescript
COPY package.json ./
RUN pnpm install && pnpm add -D @types/node
COPY tsconfig.docker.json ./tsconfig.json
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json ./
RUN pnpm install --prod
COPY --from=builder /app/dist ./dist
ARG ENV_FILE=.env.dev
COPY ${ENV_FILE} ./.env
CMD ["node", "dist/index.js"]
