FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY README.md ./
COPY IMPLEMENTATION_PLAN.md ./
COPY PROJECT_STRUCTURE.md ./
COPY .env.example ./

RUN npm install
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/README.md ./
COPY --from=build /app/IMPLEMENTATION_PLAN.md ./
COPY --from=build /app/PROJECT_STRUCTURE.md ./
COPY --from=build /app/.env.example ./
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
