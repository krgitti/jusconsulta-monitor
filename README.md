# JusConsulta Monitor

Monitora processos no TJSP e envia e-mail ao detectar novas movimentações.  
Roda **100% grátis** no GitHub Actions — sem servidor, sem cadastro externo.

## Como funciona

```
GitHub Actions (cron: 7h, 12h, 18h)
  └── busca movimentações no e-SAJ (scraping público)
      └── compara com estado salvo no GitHub Gist (JSON privado)
          └── se houver novidade → envia e-mail via Gmail
```

## Setup (5 minutos)

### 1. Senha de app do Gmail

> Não usa sua senha normal — é uma senha separada só pra isso.

1. Acesse: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Selecione **Outro (nome personalizado)** → digite `JusConsulta`
3. Clique em **Gerar** → copie os 16 caracteres (sem espaços)

> ⚠️ Verificação em duas etapas precisa estar ativa na conta Gmail.

### 2. Configurar os Secrets no GitHub

Acesse: **github.com/krgitti/jusconsulta-monitor → Settings → Secrets → Actions**

| Secret | Valor |
|---|---|
| `MONITOR_CPF` | Seu CPF (só números: `12345678900`) |
| `MONITOR_EMAIL` | E-mail que receberá os alertas |
| `GMAIL_USER` | Seu Gmail (`kleber@gmail.com`) |
| `GMAIL_APP_PASS` | Senha de app gerada no passo 1 |
| `GIST_TOKEN` | Seu GitHub PAT (o mesmo `ghp_...` já usado) |
| `GIST_ID` | **Deixar vazio na 1ª execução** — o script cria e exibe o ID |

### 3. Rodar pela primeira vez

**Actions → Monitor TJSP → Run workflow**

No log da execução você verá:
```
✅ Gist criado! Adicione este ID ao secret GIST_ID: abc123def456
```

Copie esse ID e adicione como secret `GIST_ID`.  
A partir daí, o monitoramento é totalmente automático.

## Horários de verificação

- **Seg–Sex:** 7h, 12h e 18h (horário de Brasília)
- **Sáb–Dom:** 12h

Para alterar, edite o `cron:` em `.github/workflows/monitor.yml`.

## Monitorar por nome

Além do CPF, é possível monitorar por nome da parte:  
Adicione o secret `MONITOR_NOME` com o nome completo.
