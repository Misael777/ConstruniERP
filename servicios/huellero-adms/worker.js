// Receptor ADMS (protocolo PUSH de ZKTeco) para Cloudflare Workers.
// Los huelleros de las obras envían aquí sus marcaciones por HTTP y este Worker las pasa a Supabase
// con la función fn_asistencia_ingesta (migración 20261030120000_asistencia_huellero.sql).
// Entiende los dos dialectos: asistencia (PUSH 2.x, table=ATTLOG/OPERLOG) y control de acceso
// (PUSH 3.x, DeviceType=acc, table=rtlog y tabledata user/transaction), que es como se presenta el SenseFace 2A.
// Cada petición con datos queda en asistencia_trafico (15 días) para diagnosticar otros modelos.
// En sentido contrario entrega las órdenes del ERP (asistencia_comando: registrar/retirar trabajadores,
// sincronizar) en /iclock/getrequest y recibe su resultado en /iclock/devicecmd.
//
// Variables del Worker (Settings → Variables and Secrets):
//   SUPABASE_URL       (texto)   https://<ref>.supabase.co
//   SUPABASE_ANON_KEY  (texto)   anon key pública del proyecto
//   INGESTA_TOKEN      (secreto) token cuyo SHA-256 está en asistencia_config.token_ingesta_sha256
// Opcionales, para enviar un huellero a la base de desarrollo (botón "Huelleros PRD/DEV" del rol developer,
// migración 20261103120000_huellero_destino.sql). Sin ellas todo va a la base de arriba:
//   DEV_SUPABASE_URL, DEV_SUPABASE_ANON_KEY (texto) y DEV_INGESTA_TOKEN (secreto), los mismos tres datos de Dev.
//
// Configuración en el huellero (Red → Conf. Srvr. de Nube): Modo ADMS, Habilitar Nombre de Dominio = Sí,
// Dirección = <worker>.workers.dev (puerto 80), Proxy = No.

const texto = (cuerpo, status = 200) =>
  new Response(cuerpo, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const FECHA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// Opciones que el huellero pide al conectarse. Stamp=None / TransTables hacen que reenvíe lo que tenga
// guardado (las marcas repetidas se ignoran en la BD); Realtime=1 → envía cada marca al momento;
// Delay/RequestDelay → cada cuántos segundos consulta (latido).
function opciones(sn, pushver) {
  if (Number.parseFloat(pushver) >= 3) {
    return [
      'registry=ok',
      'RegistryCode=CONSTRUNI',
      'ServerVersion=3.0.1',
      'ServerName=ADMS',
      `PushProtVer=${pushver}`,
      'ErrorDelay=60',
      'RequestDelay=30',
      'TransTimes=00:00\t12:00',
      'TransInterval=1',
      'TransTables=User\tTransaction',
      'Realtime=1',
      `SessionID=${sn}`,
      'TimeoutSec=10',
      ''
    ].join('\r\n');
  }
  return [
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=None',
    'ATTPHOTOStamp=None',
    'ErrorDelay=60',
    'Delay=60',
    'TransTimes=00:00;12:00',
    'TransInterval=1',
    'TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser',
    'TimeZone=-5',
    'Realtime=1',
    'Encrypt=None',
    ''
  ].join('\r\n');
}

const lineas = (cuerpo) => cuerpo.split(/\r?\n/).filter((l) => l.trim());

// "user uid=1\tpin=7\tname=Juan" o "time=2026-10-30 08:00:00\tpin=7\t..." → { pin: '7', ... }.
// El prefijo (user/transaction/USER) se descarta.
function camposClaveValor(linea) {
  const partes = linea.split('\t');
  const primera = partes[0].match(/^[A-Za-z]+ (\w+=.*)$/);
  if (primera) partes[0] = primera[1];
  const campos = {};
  for (const par of partes) {
    const i = par.indexOf('=');
    if (i > 0) campos[par.slice(0, i).trim().toLowerCase()] = par.slice(i + 1).trim();
  }
  return campos;
}

// time_second de ZKTeco: segundos contados con meses de 31 días y años de 12 meses desde el 2000.
function desdeSegundosZk(valor) {
  let t = Number.parseInt(valor, 10);
  if (!Number.isFinite(t) || t <= 0) return null;
  const seg = t % 60; t = Math.floor(t / 60);
  const min = t % 60; t = Math.floor(t / 60);
  const hora = t % 24; t = Math.floor(t / 24);
  const dia = (t % 31) + 1; t = Math.floor(t / 31);
  const mes = (t % 12) + 1;
  const anio = Math.floor(t / 12) + 2000;
  const d2 = (n) => String(n).padStart(2, '0');
  return `${anio}-${d2(mes)}-${d2(dia)} ${d2(hora)}:${d2(min)}:${d2(seg)}`;
}

// PUSH 2.x ATTLOG: PIN \t AAAA-MM-DD HH:MM:SS \t estado \t verificación \t ...
function marcasAttlog(cuerpo) {
  return lineas(cuerpo)
    .map((l) => l.split('\t'))
    .filter(([pin, fechaHora]) => pin && FECHA_HORA.test(fechaHora ?? ''))
    .map(([pin, fechaHora, estado, verificacion]) => ({ pin: pin.trim(), fecha_hora: fechaHora, estado: estado ?? '', verificacion: verificacion ?? '' }));
}

// PUSH 3.x rtlog (tiempo real) y tabledata transaction (pendientes guardadas en el equipo).
function marcasAcceso(cuerpo) {
  const marcas = [];
  for (const linea of lineas(cuerpo)) {
    const c = camposClaveValor(linea);
    const fechaHora = FECHA_HORA.test(c.time ?? '') ? c.time : desdeSegundosZk(c.time_second);
    if (!c.pin || !fechaHora) continue;
    marcas.push({
      pin: c.pin,
      fecha_hora: fechaHora,
      estado: c.inoutstatus ?? c.inoutstate ?? '',
      verificacion: c.verifytype ?? c.verified ?? '',
      evento: c.event ?? c.eventtype ?? ''
    });
  }
  return marcas;
}

// Usuarios ("USER PIN=1\tName=Juan" en 2.x, "user uid=1\tpin=1\tname=Juan" en 3.x): solo PIN y nombre,
// nunca claves ni plantillas biométricas.
function usuarios(cuerpo) {
  return lineas(cuerpo)
    .filter((l) => /^user\s/i.test(l))
    .map(camposClaveValor)
    .filter((c) => c.pin)
    .map((c) => ({ pin: c.pin, nombre: c.name ?? '' }));
}

// Plantillas biométricas ("biodata pin=2\tno=6\tindex=0\tvalid=1\ttype=1\tmajorver=13\t…\ttmp=<base64>").
// Se pasan a la BD, que solo guarda (cifradas) las de trabajadores con consentimiento; nunca van al tráfico.
function plantillas(cuerpo) {
  return lineas(cuerpo)
    .filter((l) => /^biodata\s/i.test(l))
    .map(camposClaveValor)
    .filter((c) => c.pin && c.type && c.tmp)
    .map((c) => ({
      pin: c.pin,
      tipo: c.type,
      numero: c.no ?? '0',
      indice: c.index ?? '0',
      valid: c.valid,
      duress: c.duress,
      majorver: c.majorver,
      minorver: c.minorver,
      format: c.format,
      tmp: c.tmp
    }));
}

// devicecmd: una línea por orden ejecutada → "ID=15&Return=0&CMD=DATA".
function resultados(cuerpo) {
  return lineas(cuerpo)
    .map((l) => new URLSearchParams(l.trim()))
    .filter((p) => p.get('ID'))
    .map((p) => ({ id: p.get('ID'), retorno: p.get('Return') ?? '' }));
}

async function rpc(env, funcion, datos) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_token: env.INGESTA_TOKEN, ...datos })
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const ingesta = (env, datos) => rpc(env, 'fn_asistencia_ingesta', datos);

// Producción decide a qué base va cada huellero (asistencia_dispositivo.destino; lo cambia el rol developer desde
// el ERP). Con 'desarrollo' todo se envía a Dev con las variables DEV_*; sin ellas, o si la consulta falla, a
// Producción. Se recuerda 60 s por equipo para no consultarlo en cada latido.
const destinos = new Map();
async function baseDelHuellero(env, sn) {
  if (!env.DEV_SUPABASE_URL || !env.DEV_SUPABASE_ANON_KEY || !env.DEV_INGESTA_TOKEN) return env;
  let guardado = destinos.get(sn);
  if (!guardado || guardado.hasta < Date.now()) {
    let destino = 'produccion';
    try {
      destino = await rpc(env, 'fn_asistencia_destino', { p_sn: sn });
    } catch (e) {
      console.error('No se pudo leer el destino del huellero', sn, e.message);
    }
    guardado = { destino, hasta: Date.now() + 60_000 };
    destinos.set(sn, guardado);
  }
  return guardado.destino === 'desarrollo'
    ? { SUPABASE_URL: env.DEV_SUPABASE_URL, SUPABASE_ANON_KEY: env.DEV_SUPABASE_ANON_KEY, INGESTA_TOKEN: env.DEV_INGESTA_TOKEN }
    : env;
}

export default {
  async fetch(request, envGeneral) {
    const url = new URL(request.url);
    const ruta = url.pathname.replace(/\/+$/, '').toLowerCase();
    const sn = url.searchParams.get('SN') ?? '';

    if (!ruta.startsWith('/iclock/')) return texto('Receptor de asistencia Construni');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(sn)) return texto('SN requerido', 400);
    const env = await baseDelHuellero(envGeneral, sn);

    const cuerpo = request.method === 'POST' ? await request.text() : '';
    const base = { p_sn: sn, p_ip: request.headers.get('CF-Connecting-IP') };
    const tabla = (url.searchParams.get('table') ?? '').toLowerCase();
    const nombreTabla = (url.searchParams.get('tablename') ?? '').toLowerCase();
    // En el tráfico solo se guarda el contenido de marcaciones y del registro del equipo: usuarios, claves,
    // fotos y plantillas biométricas no se guardan (Ley 29733), solo cuántas líneas llegaron.
    const esMarcacion = tabla === 'attlog' || tabla === 'rtlog' || nombreTabla === 'transaction';
    const cuerpoTrafico = !cuerpo || esMarcacion || ruta === '/iclock/registry' || ruta === '/iclock/devicecmd'
      ? cuerpo
      : `[${lineas(cuerpo).length} líneas de ${nombreTabla || tabla || ruta}, contenido no guardado]`;
    // El latido (getrequest) no se guarda en el tráfico: llega cada 30-60 s y no trae datos.
    const crudo = ruta === '/iclock/getrequest' ? null : { metodo: request.method, ruta, consulta: url.search.slice(0, 500), cuerpo: cuerpoTrafico };

    try {
      if (ruta === '/iclock/cdata' && request.method === 'GET') {
        const info = ['pushver', 'DeviceType', 'language']
          .map((k) => url.searchParams.get(k) && `${k}=${url.searchParams.get(k)}`)
          .filter(Boolean)
          .join(' ');
        await ingesta(env, { ...base, p_info: info || null, p_crudo: crudo });
        return texto(opciones(sn, url.searchParams.get('pushver') ?? ''));
      }
      if (ruta === '/iclock/cdata') {
        if (tabla === 'attlog') {
          const marcas = marcasAttlog(cuerpo);
          await ingesta(env, { ...base, p_marcaciones: marcas, p_crudo: crudo });
          return texto(`OK:${marcas.length}`);
        }
        if (tabla === 'rtlog' || (tabla === 'tabledata' && nombreTabla === 'transaction')) {
          const marcas = marcasAcceso(cuerpo);
          await ingesta(env, { ...base, p_marcaciones: marcas, p_crudo: crudo });
          return texto(tabla === 'rtlog' ? 'OK' : `transaction=${lineas(cuerpo).length}`);
        }
        await ingesta(env, { ...base, p_usuarios: usuarios(cuerpo), p_crudo: crudo });
        if (nombreTabla === 'biodata') await rpc(env, 'fn_asistencia_biometria', { p_sn: sn, p_plantillas: plantillas(cuerpo) });
        // Usuarios, fotos, estado y demás tablas se aceptan; de usuarios solo se guardan PIN y nombre.
        if (tabla === 'tabledata' && nombreTabla) return texto(`${nombreTabla}=${lineas(cuerpo).length}`);
        return texto(`OK:${lineas(cuerpo).length}`);
      }
      if (ruta === '/iclock/getrequest') {
        await ingesta(env, base); // latido: así el ERP sabe que el huellero está en línea
        // Órdenes pendientes del ERP (alta/retiro de trabajadores, sincronizar): "C:<id>:<orden>" por línea.
        const comandos = await rpc(env, 'fn_asistencia_comandos', { p_sn: sn });
        if (!comandos.length) return texto('OK');
        return texto(comandos.map((c) => `C:${c.id}:${c.comando}`).join('\r\n') + '\r\n');
      }
      if (ruta === '/iclock/devicecmd') {
        await ingesta(env, { ...base, p_crudo: crudo });
        await rpc(env, 'fn_asistencia_resultados', { p_sn: sn, p_resultados: resultados(cuerpo) });
        return texto('OK');
      }
      if (ruta === '/iclock/querydata') {
        // Respuesta a DATA QUERY: la lista completa de usuarios (Sincronizar) o de plantillas (consentimiento).
        await ingesta(env, { ...base, p_usuarios: usuarios(cuerpo), p_crudo: crudo });
        if (nombreTabla === 'biodata') await rpc(env, 'fn_asistencia_biometria', { p_sn: sn, p_plantillas: plantillas(cuerpo) });
        return texto(`${nombreTabla || 'user'}=${lineas(cuerpo).length}`);
      }
      if (ruta === '/iclock/registry') {
        await ingesta(env, { ...base, p_crudo: crudo });
        return texto('RegistryCode=CONSTRUNI');
      }
      if (ruta === '/iclock/push') {
        await ingesta(env, { ...base, p_crudo: crudo });
        return texto(opciones(sn, url.searchParams.get('pushver') ?? '3.1.2'));
      }
      // devicecmd, ping y otras rutas: se registran y basta con aceptar.
      await ingesta(env, { ...base, p_crudo: crudo });
      return texto('OK');
    } catch (err) {
      console.error(`[${sn}] ${ruta}: ${err.message}`);
      // Un error hace que el huellero guarde la marca y la reintente más tarde.
      return texto('ERROR', 500);
    }
  }
};
