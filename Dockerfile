FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build
ENV JANUS_BIND=0.0.0.0 JANUS_PORT=4311
EXPOSE 4311
VOLUME ["/app/.data"]
CMD ["npm","run","start"]
