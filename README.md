# JusConsulta Monitor — Backend

Backend de monitoramento de processos TJSP com notificações push (Firebase) e e-mail (Resend).

## Arquitetura

```
Cron (4h/4h)
    └── busca movimentações no e-SAJ (scraping público)
        └── compara hash com estado salvo no SQLite
            └── se mudou → envia Push (FCM) + E-mail (Resend)
```

## Setup rápido no Render

1. Fork/clone este repositório
2. Crie uma conta em [render.com](https://render.com)
3. **New → Web Service → Connect repo**
4. Configure as variáveis de ambiente (ver abaixo)
5. Deploy automático

## Variáveis de ambiente necessárias

| Variável | Descrição |
|---|---|
| `RESEND_API_KEY` | Chave do [Resend](https://resend.com) |
| `FROM_EMAIL` | E-mail remetente verificado no Resend |
| `FIREBASE_SERVICE_ACCOUNT` | JSON do service account Firebase (minificado) |
| `ADMIN_KEY` | Chave secreta para trigger manual |
| `CRON_SCHEDULE` | Frequência (padrão: `0 */4 * * *`) |

## Como obter as credenciais

### Resend (e-mail)
1. [resend.com](https://resend.com) → criar conta gratuita
2. API Keys → Create API Key
3. Domains → verificar domínio (ou usar `onboarding@resend.dev` para testes)

### Firebase (push)
1. [console.firebase.google.com](https://console.firebase.google.com)
2. Criar projeto → Project Settings → Service Accounts
3. **Generate new private key** → baixar JSON
4. Minificar: `cat service-account.json | jq -c .`
5. Colar o JSON minificado na variável `FIREBASE_SERVICE_ACCOUNT`

## API

```
POST /api/monitor           Cadastrar CPF/CNPJ/número/nome para monitoramento
GET  /api/monitor?email=... Listar monitoramentos de um e-mail
DELETE /api/monitor/:id     Remover monitoramento
PATCH /api/monitor/:id/fcm  Atualizar token FCM do dispositivo
POST /api/monitor/run       Disparar ciclo manual (requer x-api-key header)
GET  /health                Health check
```

### Exemplo de cadastro
```bash
curl -X POST https://seu-backend.onrender.com/api/monitor \
  -H "Content-Type: application/json" \
  -d '{
    "tipo": "cpf",
    "valor": "123.456.789-00",
    "label": "Meus processos",
    "email": "kleber@exemplo.com",
    "fcm_token": "token-do-dispositivo"
  }'
```
