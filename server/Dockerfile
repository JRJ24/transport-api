FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl \
  && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY nest-cli.json prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm db:generate
RUN pnpm build

FROM deps AS prod-deps

RUN pnpm prune --prod

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PAYMENT_PROVIDER=cardnet \
  PAYMENT_CALLBACK_BASE_URL= \
  CUSTOMER_APP_BASE_URL= \
  CARDNET_ENVIRONMENT=qa \
  CARDNET_SESSION_URL=https://labservicios.cardnet.com.do/sessions \
  CARDNET_AUTHORIZE_URL=https://labservicios.cardnet.com.do/authorize \
  CARDNET_MERCHANT_NUMBER= \
  CARDNET_TERMINAL= \
  CARDNET_TERMINAL_AMEX= \
  CARDNET_MERCHANT_TYPE= \
  CARDNET_ACQUIRER_CODE= \
  CARDNET_MERCHANT_NAME= \
  CARDNET_RETURN_URL= \
  CARDNET_CANCEL_URL= \
  CARDNET_PAGE_LANGUAGE=ESP \
  CARDNET_TRANSACTION_TYPE=0200 \
  CARDNET_CURRENCY_CODE=214 \
  CARDNET_TAX_AMOUNT=0 \
  CARDNET_3DS_BILLING_COUNTRY_CODE=DOP \
  CARDNET_3DS_BILLING_POSTAL_CODE=00000

RUN apk add --no-cache libc6-compat openssl dumb-init

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
