# Worker de WhatsApp (24/7)

Este worker dispara os lembretes do **Rotina do Bebê** no WhatsApp na hora certa —
inclusive de madrugada, com o celular bloqueado. Ele resolve a limitação do app:
navegador só notifica com a página aberta.

Como funciona:

```
App (celular)  ──POST /routine──►  Worker (VPS)  ──envia──►  WAHA/Evolution ──►  WhatsApp
  empurra a agenda das               guarda e, a cada           API não-oficial
  próximas 24h ao abrir              minuto, dispara o
                                     que chegou na hora
```

O app reempurra a agenda toda vez que é aberto, então ela se mantém fresca sozinha
(um recém-nascido faz você abrir o app o tempo todo). Se ficar dias sem abrir, a
agenda envelhece — por isso os alarmes do celular continuam sendo o plano B.

## ⚠️ Antes de tudo

WAHA e Evolution são APIs **não-oficiais** do WhatsApp. Usar automação não-oficial
**pode levar ao bloqueio do número** pelo WhatsApp. Use por sua conta e risco e,
de preferência, com **um chip dedicado** (não o seu número principal).

## Subir numa VPS (Docker)

Pré-requisitos: uma VPS com Docker e Docker Compose, e um domínio apontando para ela
(recomendado, para ter HTTPS).

```bash
git clone https://github.com/matsuch/baby-routine.git
cd baby-routine/server
cp .env.example .env
nano .env            # defina WAHA_API_KEY (segredo forte) e, se quiser, WORKER_TOKEN
```

Suba os dois serviços (rode da raiz do repo, por causa do contexto de build):

```bash
cd ..
docker compose -f server/docker-compose.yml up -d --build
```

- WAHA sobe em `http://SEU_HOST:3001`
- Worker sobe em `http://SEU_HOST:3000` (`GET /health` para conferir)

### Parear o WhatsApp (WAHA)

1. Acesse o painel do WAHA (`http://SEU_HOST:3001`), informando a `WAHA_API_KEY`.
2. Inicie a sessão `default` e leia o **QR Code** com o WhatsApp do chip dedicado
   (Aparelhos conectados → Conectar aparelho).
3. Quando a sessão ficar `WORKING`, está pronto.

### HTTPS (obrigatório para o app publicado)

O app roda em `https://` (GitHub Pages). Navegador não deixa uma página https chamar
um endpoint `http://` (mixed content). Coloque o worker e o WAHA atrás de um reverse
proxy com TLS. Exemplo com Caddy (`Caddyfile`):

```
worker.seudominio.com {
    reverse_proxy localhost:3000
}
waha.seudominio.com {
    reverse_proxy localhost:3001
}
```

Depois, no app (Ajustes → Avisar no WhatsApp):

| Campo | Valor |
|---|---|
| Serviço | WAHA |
| URL do servidor | `https://waha.seudominio.com` |
| Chave da API | a `WAHA_API_KEY` do `.env` |
| Sessão | `default` |
| Números de destino | seu número e o do parceiro(a), com DDI (ex.: `5511999998888`) |
| URL do worker | `https://worker.seudominio.com` |
| Token do worker | a `WORKER_TOKEN`, se você definiu uma |

Toque em **Enviar teste**. Chegou no WhatsApp? Está funcionando. Depois **Sincronizar
agenda com o worker** para ativar os lembretes 24/7.

> CORS: em produção, ajuste `CORS_ORIGIN` no `.env` para a origem do app
> (ex.: `https://matsuch.github.io`) e recarregue o worker. O WAHA precisa aceitar a
> mesma origem para o **Enviar teste** (chamada direta do navegador) funcionar; se o
> seu WAHA não expõe CORS, use só o worker (o teste/lembrete sai server-side).

## Usar a Evolution API no lugar do WAHA

Troque o serviço `waha` do compose por um `evolution-api` (imagem
`atendai/evolution-api`), crie uma **instância** e pareie o QR Code. No app, escolha
**Evolution API**, ponha a URL da Evolution, a `apikey`, e em **Instância** o nome
que você deu. O worker detecta o provedor pelo campo `provider` que o app envia.

## Rotas do worker

| Rota | O quê |
|---|---|
| `GET /health` | status e contadores |
| `POST /routine` | o app envia config + agenda (header `x-worker-token` se houver) |
| `POST /send` | `{ "text": "..." }` dispara agora para os números salvos (teste) |

## Rodar sem Docker

```bash
cd server
WAHA_API_KEY=... WORKER_TOKEN=... node worker.mjs   # precisa de Node 18+
```

(o WAHA/Evolution você sobe à parte). Testes: `npm test` dentro de `server/`.
