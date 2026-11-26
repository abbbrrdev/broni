FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN apk update && apk add --no-cache ffmpeg openssl
RUN bun install
COPY . .
RUN bunx prisma generate
RUN bun run build

EXPOSE 3000

CMD ["bun", "run", "start"]
