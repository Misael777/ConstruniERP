package com.construnierp.app.push

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Ticket #113: expone el token de Firebase del celular para que el frontend lo registre en Supabase
 * (fn_registrar_dispositivo_push). Si la app se compiló sin google-services.json, Firebase no está inicializado:
 * devuelve token null en vez de fallar.
 */
@TauriPlugin
class PushPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun obtenerToken(invoke: Invoke) {
        val sinToken = JSObject().apply { put("token", null) }
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { tarea ->
                if (tarea.isSuccessful && !tarea.result.isNullOrBlank()) {
                    invoke.resolve(JSObject().apply { put("token", tarea.result) })
                } else {
                    invoke.resolve(sinToken)
                }
            }
        } catch (e: Exception) {
            invoke.resolve(sinToken)
        }
    }
}
