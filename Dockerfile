FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI so the delegate action can spawn it
RUN npm install -g @anthropic-ai/claude-code

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN mkdir -p /app/sessions

CMD ["npm", "start"]
