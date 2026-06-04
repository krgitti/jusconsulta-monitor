import * as admin from 'firebase-admin';
import { Resend } from 'resend';

// ── Firebase Admin ────────────────────────────────────────────────────────────

let firebaseApp: admin.app.App | null = null;

function getFirebase(): admin.app.App {
  if (firebaseApp) return firebaseApp;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT não configurado');
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccount)),
  });
  return firebaseApp;
}

export async function sendPush(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const app = getFirebase();
    await admin.messaging(app).send({
      token: fcmToken,
      notification: { title, body },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'movimentacoes',
          priority: 'high',
          defaultSound: true,
        },
      },
    });
    console.log(`[PUSH] Enviado para token ...${fcmToken.slice(-8)}`);
  } catch (err: any) {
    console.error(`[PUSH] Erro: ${err.message}`);
    throw err;
  }
}

// ── Resend (e-mail) ───────────────────────────────────────────────────────────

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY não configurado');
  return new Resend(key);
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'JusConsulta TJSP <noreply@jusconsulta.app>';

export async function sendEmail(
  to: string,
  numero: string,
  movimentacoes: { data: string; titulo: string }[]
): Promise<void> {
  const resend = getResend();

  const linhasMovs = movimentacoes
    .map(m => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;
                   font-family:monospace;white-space:nowrap">${m.data}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0">${m.titulo}</td>
      </tr>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <div style="background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155">

      <div style="background:linear-gradient(135deg,#f59e0b20,#1e293b);
                  padding:24px;border-bottom:1px solid #334155">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <span style="font-size:28px">⚖️</span>
          <span style="color:#f59e0b;font-size:20px;font-weight:700">JusConsulta TJSP</span>
        </div>
        <h1 style="color:#fff;font-size:16px;margin:0;font-weight:600">
          Nova movimentação detectada
        </h1>
      </div>

      <div style="padding:24px">
        <div style="background:#0f172a;border-radius:10px;padding:12px 16px;
                    border:1px solid #334155;margin-bottom:20px">
          <div style="color:#64748b;font-size:11px;text-transform:uppercase;
                      letter-spacing:.05em;margin-bottom:4px">Processo</div>
          <div style="color:#f59e0b;font-family:monospace;font-size:15px;
                      font-weight:600">${numero}</div>
        </div>

        <p style="color:#94a3b8;font-size:14px;margin:0 0 16px">
          ${movimentacoes.length === 1 ? 'Uma nova movimentação foi' : `${movimentacoes.length} novas movimentações foram`}
          registrada${movimentacoes.length > 1 ? 's' : ''} neste processo:
        </p>

        <table style="width:100%;border-collapse:collapse;background:#0f172a;
                      border-radius:10px;overflow:hidden;border:1px solid #334155">
          <thead>
            <tr style="background:#1e293b">
              <th style="padding:10px 12px;text-align:left;color:#64748b;
                         font-size:11px;text-transform:uppercase;letter-spacing:.05em">Data</th>
              <th style="padding:10px 12px;text-align:left;color:#64748b;
                         font-size:11px;text-transform:uppercase;letter-spacing:.05em">Movimentação</th>
            </tr>
          </thead>
          <tbody>${linhasMovs}</tbody>
        </table>

        <div style="margin-top:24px;text-align:center">
          <a href="https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&dePesquisaNuUnificado=${encodeURIComponent(numero)}"
             style="display:inline-block;background:#f59e0b;color:#0f172a;
                    text-decoration:none;padding:12px 24px;border-radius:10px;
                    font-weight:700;font-size:14px">
            Ver no e-SAJ oficial ↗
          </a>
        </div>
      </div>

      <div style="padding:16px 24px;border-top:1px solid #1e293b;text-align:center">
        <p style="color:#475569;font-size:12px;margin:0">
          JusConsulta TJSP — monitoramento automático de processos
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `⚖️ Nova movimentação — ${numero}`,
    html,
  });

  console.log(`[EMAIL] Enviado para ${to} — processo ${numero}`);
}
