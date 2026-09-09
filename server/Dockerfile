# Worker do Rotina do Bebê. Build a partir da RAIZ do repositório:
#   docker build -f server/Dockerfile -t rotina-bebe-worker .
# (o contexto precisa ser a raiz porque o worker reaproveita assets/js/wa.js)
FROM node:20-alpine

WORKDIR /app

# Só o necessário para rodar — sem dependências externas.
COPY server/worker.mjs server/package.json ./server/
COPY assets/js/wa.js ./assets/js/wa.js

WORKDIR /app/server
ENV PORT=3000
EXPOSE 3000

# Healthcheck bate na própria rota /health.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "worker.mjs"]
