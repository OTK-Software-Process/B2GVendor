# ---- deps: install once, cached across builds ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- production: minimal runtime image ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Run as the unprivileged "node" user the base image provides, never as root (ASVS
# V13.2.2). The code stays owned by root, so the process can read it but not change
# it. The one place it may write is the TOR storage folder: it is created here,
# owned by "node", so a NEW volume mounted on /app/storage inherits that owner.
# (A volume made by an earlier, root-running image must be handed over once: see
# docs/Deployment.md, "Moving an existing stack to non-root containers".)
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]
