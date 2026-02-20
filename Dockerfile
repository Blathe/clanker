FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

RUN mkdir -p /app/sessions \
  && chown -R node:node /app

# claude --dangerously-skip-permissions refuses to run as root
USER node

CMD ["npm", "start"]
