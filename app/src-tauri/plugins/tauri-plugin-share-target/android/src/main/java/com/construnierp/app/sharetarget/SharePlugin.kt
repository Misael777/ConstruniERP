package com.construnierp.app.sharetarget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream

/**
 * Recibe una imagen compartida desde otra app (Galería, capturas de pantalla) vía el Share Sheet de
 * Android (intent-filter ACTION_SEND declarado en AndroidManifest.xml de este plugin, ver ahí) y la
 * deja lista para que el frontend la pida con `getPendingShare` al abrir/reanudar la app — así el
 * flujo de "compartir un comprobante" termina en "Nueva Transacción" ya con el archivo adjunto.
 *
 * El intent puede llegar por dos caminos, según si la app ya estaba abierta:
 * - Arranque en frío: Android lanza MainActivity CON el ACTION_SEND como intent inicial de la
 *   Activity — se revisa en `load()`, que corre después de `onCreate()`.
 * - App ya abierta (MainActivity usa launchMode="singleTask"): Android reutiliza la misma Activity y
 *   entrega el intent nuevo por `onNewIntent`, que Tauri ya reenvía a todos los plugins
 *   automáticamente (ver TauriActivity.onNewIntent en el proyecto Android generado).
 *
 * Los bytes viajan como base64 en la propia respuesta del comando (en vez de copiar a un archivo y
 * devolver la ruta) para no depender del scope de `@tauri-apps/plugin-fs` del lado JS — una ruta de
 * caché armada acá no viene de un diálogo nativo de Tauri, así que quedaría sujeta a las reglas de
 * scope de fs y podría bloquearse. Un comprobante nunca pasa de 5MB (ver MAX_FILE_SIZE en
 * TransaccionModal.svelte), así que el tamaño del payload no es un problema real.
 */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
    private var pending: JSObject? = null

    override fun load(webView: WebView) {
        super.load(webView)
        handleIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null || intent.action != Intent.ACTION_SEND) return
        val mimeType = intent.type
        if (mimeType == null || !mimeType.startsWith("image/")) return

        val uri = getStreamExtra(intent) ?: return
        try {
            val bytes = activity.contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArrayOutputStream()
                input.copyTo(buffer)
                buffer.toByteArray()
            } ?: return

            val extension = mimeType.substringAfter('/', "jpg")
            pending = JSObject().apply {
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                put("fileName", "comprobante-compartido.$extension")
                put("mimeType", mimeType)
            }
        } catch (ex: Exception) {
            // Best-effort: si falla la lectura, no queda nada pendiente — el usuario igual puede
            // adjuntar el comprobante a mano, como siempre.
            Log.w("SharePlugin", "No se pudo leer la imagen compartida", ex)
        }
    }

    private fun getStreamExtra(intent: Intent): Uri? {
        return if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
    }

    /** Devuelve la imagen pendiente UNA sola vez — se limpia acá mismo para no reabrir la misma
     * transacción dos veces si el frontend vuelve a preguntar (ej. al navegar entre pantallas). */
    @Command
    fun getPendingShare(invoke: Invoke) {
        val result = pending
        pending = null
        invoke.resolve(result)
    }
}
