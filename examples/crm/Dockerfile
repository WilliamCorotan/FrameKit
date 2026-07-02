FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.check.json vitest.config.ts ./
COPY packages ./packages
COPY examples/crm ./examples/crm
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate && pnpm install --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @framekit/example-crm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/examples/crm/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
