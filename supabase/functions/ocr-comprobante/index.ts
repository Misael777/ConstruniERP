// Lee fecha y monto de un comprobante de pago (imagen) usando Claude (Anthropic) con visión —
// a pedido del usuario, "Nueva Transacción" reconoce estos dos campos automáticamente al subir
// el boucher (ver "Fecha (reconocida)"/"Monto (reconocido)" en TransaccionModal.svelte).
//
// Se llama por fetch() directo desde el cliente (mismo patrón que user-admin/index.ts) en vez
// del SDK de Anthropic, porque el resto del proyecto ya usa fetch() plano para hablar con las
// Edge Functions y así evita agregar una dependencia npm más en el runtime de Deno.
//
// Requiere el secreto ANTHROPIC_API_KEY, configurado con:
//   supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
// NUNCA en app/.env — ese archivo es del lado del cliente (browser/Tauri) y cualquier variable
// ahí se incluye en el bundle, lo que filtraría la key.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

// Modelo económico y rápido — extraer dos campos de una foto de recibo no necesita el modelo
// más capaz; Haiku 4.5 soporta visión y es ~5x más barato que Opus para este tipo de tarea.
const MODEL = 'claude-haiku-4-5';

function buildJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...corsHeaders
    }
  });
}

interface ReconocerBody {
  imageBase64?: string;
  mediaType?: string;
}

async function reconocerComprobante(body: ReconocerBody) {
  if (!ANTHROPIC_API_KEY) {
    return buildJsonResponse({ success: false, error: 'ANTHROPIC_API_KEY no está configurada en las Edge Functions.' }, 500);
  }

  const { imageBase64, mediaType } = body;
  if (!imageBase64 || !mediaType) {
    return buildJsonResponse({ success: false, error: 'imageBase64 y mediaType son requeridos.' }, 400);
  }

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          {
            type: 'text',
            text: 'Este es un comprobante de pago peruano (boucher, voucher de transferencia, depósito, Yape/Plin, etc.). Extrae la fecha de la operación y el monto total pagado.'
          }
        ]
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              fecha: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                description: 'Fecha de la operación en formato YYYY-MM-DD. null si la imagen no permite determinarla con confianza.'
              },
              monto: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
                description: 'Monto total de la operación, solo el número (sin S/, comas de miles, etc.). null si no se puede determinar.'
              },
              confianza: {
                type: 'string',
                enum: ['alta', 'media', 'baja'],
                description: '"alta" si fecha y monto se leen con claridad, "baja" si la imagen está borrosa/incompleta o hay ambigüedad.'
              }
            },
            required: ['fecha', 'monto', 'confianza'],
            additionalProperties: false
          }
        }
      }
    })
  });

  if (!anthropicResponse.ok) {
    const errorText = await anthropicResponse.text().catch(() => '');
    return buildJsonResponse({ success: false, error: `Anthropic API error ${anthropicResponse.status}: ${errorText.slice(0, 300)}` }, 502);
  }

  const data = await anthropicResponse.json();

  if (data.stop_reason === 'refusal') {
    return buildJsonResponse({ success: false, error: 'El modelo no pudo procesar esta imagen.' }, 422);
  }

  const textBlock = (data.content ?? []).find((block: any) => block.type === 'text');
  if (!textBlock?.text) {
    return buildJsonResponse({ success: false, error: 'La respuesta del modelo no incluyó datos reconocidos.' }, 502);
  }

  let parsed: { fecha: string | null; monto: number | null; confianza: string };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return buildJsonResponse({ success: false, error: 'No se pudo interpretar la respuesta del modelo.' }, 502);
  }

  return buildJsonResponse({ success: true, fecha: parsed.fecha, monto: parsed.monto, confianza: parsed.confianza });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return buildJsonResponse({ success: false, error: 'Método no soportado.' }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) return buildJsonResponse({ success: false, error: 'Body inválido.' }, 400);
    return await reconocerComprobante(body);
  } catch (err) {
    return buildJsonResponse({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
