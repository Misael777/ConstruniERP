package com.construnierp.app.sharetarget

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File

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
/** Argumentos de `compartir` (ticket #83) — mismos nombres que CompartirPayload en lib.rs (camelCase). */
@InvokeArg
class CompartirArgs {
    var texto: String? = null
    var data: String? = null
    var mimeType: String? = null
    var fileName: String? = null
}

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

    /**
     * Ticket #83: abre el Share Sheet de Android (WhatsApp, correo, etc.) con el comprobante de una
     * transacción + su mensaje. El archivo se escribe en cacheDir/compartir y se expone con el
     * FileProvider que la app ya declara (`${applicationId}.fileprovider`, ver gen/android/.../file_paths.xml,
     * que incluye cache-path). Se excluye a la propia ERP de la lista (también recibe imágenes, ver arriba).
     */
    @Command
    fun compartir(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(CompartirArgs::class.java)
            val intent = Intent(Intent.ACTION_SEND)
            val data = args.data
            if (!data.isNullOrEmpty()) {
                val bytes = Base64.decode(data, Base64.DEFAULT)
                val dir = File(activity.cacheDir, "compartir")
                dir.mkdirs()
                val nombre = (args.fileName ?: "comprobante.jpg").replace(Regex("[^A-Za-z0-9._-]"), "_")
                val file = File(dir, nombre)
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
                intent.type = args.mimeType ?: "image/*"
                intent.putExtra(Intent.EXTRA_STREAM, uri)
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                intent.type = "text/plain"
            }
            val texto = args.texto
            if (!texto.isNullOrEmpty()) intent.putExtra(Intent.EXTRA_TEXT, texto)

            val chooser = Intent.createChooser(intent, "Compartir")
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, arrayOf(ComponentName(activity, activity.javaClass)))
            activity.startActivity(chooser)
            invoke.resolve()
        } catch (ex: Exception) {
            Log.w("SharePlugin", "No se pudo abrir el menú de compartir", ex)
            invoke.reject(ex.message ?: "No se pudo compartir")
        }
    }
}
