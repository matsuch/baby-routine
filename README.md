# 🍼 Rotina do Bebê

App para dar conta da rotina de recém-nascido: **mamadas de 3 em 3h, remédios com
intervalos diferentes (6h, 8h, 12h), fraldas e sono** — tudo em uma tela só, com
contagem regressiva, para não precisar fazer conta às 3 da manhã.

É um site que funciona como app: **instala na tela de início, abre offline e salva
tudo no próprio celular** (nenhum dado sai do aparelho, nenhuma conta, nenhum servidor).

## O que ele faz

| Tela | Para quê |
|---|---|
| **Agora** | Próxima mamada e próximas doses com contagem regressiva (fica laranja quando dá a hora, vermelho quando atrasa). Botões grandes para registrar xixi, cocô, **arroto** e sono com um toque. |
| **Mamada** | Cronômetro com lado esquerdo/direito, troca de lado no meio da mamada e sugestão de qual peito oferecer na próxima. Também dá para registrar uma mamada que já passou. |
| **Remédios** | Cada remédio com seu intervalo. "Tomei agora" recalcula a próxima dose sozinho. Já vem com Cefalexina 6h, Paracetamol 8h e Profenid 12h — é só editar ou apagar. |
| **Diário** | Linha do tempo do dia, resumo (mamadas, fraldas, arrotos, sono) e **"Copiar resumo"** para mandar no WhatsApp ou mostrar no pediatra. **"Agenda do dia"** projeta os horários das próximas 24h — útil para conferir ou recriar os alarmes do celular. |
| **Ajustes** | Nome e nascimento do bebê, intervalo entre mamadas, avisos, **notificações no WhatsApp** e backup dos dados. |

## Notificações no WhatsApp (opcional)

Em **Ajustes → Avisar no WhatsApp** dá para mandar os lembretes de mamada e remédio
(e o resumo do dia) para o seu WhatsApp e o do parceiro(a), usando uma API
**não-oficial** — [WAHA](https://waha.devlike.pro/) ou
[Evolution API](https://github.com/EvolutionAPI/evolution-api).

Como o app é estático (não roda com o celular bloqueado), há **duas camadas**:

- **No app** — enquanto aberto, envia o teste, o resumo e o aviso junto da notificação.
- **Worker 24/7** (`server/`) — recebe a agenda do app e dispara os lembretes na hora
  certa, inclusive de madrugada. É o que fecha o buraco da notificação com o app fechado.

O passo a passo de instalação numa VPS (Docker + WAHA/Evolution + HTTPS) está em
**[`server/README.md`](server/README.md)**.

> ⚠️ APIs não-oficiais do WhatsApp podem levar ao **bloqueio do número**. Use por sua
> conta e risco, de preferência com um chip dedicado.

## Como usar no celular

1. Publique o app (veja abaixo) ou abra o `index.html` de um servidor local.
2. **iPhone:** abra no Safari → botão compartilhar → *Adicionar à Tela de Início*.
   **Android:** Chrome → menu → *Instalar app*.
3. Abra pelo ícone. A partir daí funciona offline.

### Sobre os avisos ⚠️

O sininho no topo liga as notificações, mas **navegador só avisa com o app aberto ou
há pouco tempo em segundo plano** — no iPhone isso é ainda mais limitado. Para a
madrugada, **continue usando os alarmes do celular**; use a *Agenda do dia* para
acertar os horários. O app serve para saber *quanto falta* e *o que já foi feito*.

## Publicar de graça (GitHub Pages)

O repositório já vem com o workflow `.github/workflows/pages.yml`, que liga o Pages
sozinho (`enablement: true`) no primeiro push na branch principal. O app fica em
`https://<seu-usuario>.github.io/baby-routine/`.

Se o deploy falhar com *"Get Pages site failed"*, ative uma vez à mão em
**Settings → Pages → Source: GitHub Actions** e rode o workflow de novo.

Como é tudo estático, também funciona em qualquer hospedagem de arquivos.

## Rodar e testar localmente

```bash
npm start          # serve em http://localhost:8080
npm install        # só para os testes (baixa o Playwright)
npm test           # abre um Chromium e percorre os fluxos principais
SHOTS=1 npm test   # o mesmo, salvando telas em tests/screenshots/
npm run icons      # regera os ícones PNG (script Python sem dependências)
node server/test.mjs   # testa o worker e o adaptador de WhatsApp (sem rede)
```

## Estrutura

```
index.html                 telas (uma <section> por aba)
assets/css/style.css       tema escuro, botões grandes para uso com uma mão
assets/js/store.js         estado + localStorage; eventos são a fonte da verdade
assets/js/format.js        formatação de horas, durações e contagens regressivas
assets/js/app.js           renderização das telas, interações e avisos
assets/js/wa.js            adaptador de WhatsApp (WAHA/Evolution) — usado no app e no worker
sw.js                      service worker (abre offline)
tools/make_icons.py        gera os ícones PNG sem dependências
tests/smoke.mjs            teste de fumaça ponta a ponta
server/                    worker 24/7 de WhatsApp + Docker (veja server/README.md)
  worker.mjs               recebe a agenda e dispara os lembretes na hora
  docker-compose.yml       WAHA + worker
  test.mjs                 testes do worker e do adaptador (sem rede)
```

Os horários (próxima mamada, próxima dose) nunca são gravados: são sempre calculados
a partir do último registro. Assim, atrasar ou adiantar uma dose reajusta o resto sozinho.

## Backup

Tudo fica no `localStorage` **deste aparelho**. Em *Ajustes → Exportar* sai um `.json`
que pode ser importado no celular do parceiro(a) ou depois de trocar de telefone.
Limpar os dados do site apaga os registros.

---

Este app apenas lembra os horários que você configurou. Dose, intervalo e duração do
tratamento são sempre os da prescrição médica.
