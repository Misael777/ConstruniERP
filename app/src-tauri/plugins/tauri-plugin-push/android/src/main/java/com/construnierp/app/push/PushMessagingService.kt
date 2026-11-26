package com.construnierp.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Ticket #113 (imagen de la clienta): recibe los avisos de Firebase aunque la app esté cerrada y los muestra
 * AGRUPADOS POR CATEGORÍA ("CONSTRUNI ERP · Finanzas · 3 notificaciones"). Llegan como mensajes de solo datos
 * (titulo, cuerpo, categoria, categoria_nombre, url; ver la Edge Function notificar-push), así que siempre pasan por
 * aquí. Cada categoría tiene su canal (el usuario puede silenciar una en Ajustes) y su grupo con un resumen.
 */
class PushMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // El frontend vuelve a pedir el token al abrir la app y lo registra (no hace falta guardarlo aquí).
    }

    override fun onMessageReceived(mensaje: RemoteMessage) {
        val d = mensaje.data
        val titulo = d["titulo"] ?: mensaje.notification?.title ?: "Construni ERP"
        val cuerpo = d["cuerpo"] ?: mensaje.notification?.body ?: ""
        val categoria = d["categoria"] ?: "general"
        val nombreCategoria = d["categoria_nombre"] ?: "General"
        mostrar(applicationContext, categoria, nombreCategoria, titulo, cuerpo, d["url"])
    }

    companion object {
        private const val PREFIJO_GRUPO = "construni_"

        fun mostrar(contexto: Context, categoria: String, nombreCategoria: String, titulo: String, cuerpo: String, url: String?) {
            val canal = "erp_$categoria"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val gestor = contexto.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (gestor.getNotificationChannel(canal) == null) {
                    gestor.createNotificationChannel(NotificationChannel(canal, nombreCategoria, NotificationManager.IMPORTANCE_HIGH))
                }
            }
            if (!NotificationManagerCompat.from(contexto).areNotificationsEnabled()) return

            val abrir = contexto.packageManager.getLaunchIntentForPackage(contexto.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                if (!url.isNullOrBlank()) putExtra("construni_url", url)
            }
            val pendiente = abrir?.let {
                PendingIntent.getActivity(contexto, (System.currentTimeMillis() % Int.MAX_VALUE).toInt(), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }
            val grupo = PREFIJO_GRUPO + categoria
            val icono = contexto.applicationInfo.icon

            val aviso = NotificationCompat.Builder(contexto, canal)
                .setSmallIcon(icono)
                .setContentTitle(titulo)
                .setContentText(cuerpo.lineSequence().firstOrNull() ?: "")
                .setStyle(NotificationCompat.BigTextStyle().bigText(cuerpo))
                .setSubText(nombreCategoria)
                .setGroup(grupo)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .apply { if (pendiente != null) setContentIntent(pendiente) }
                .build()

            // Resumen del grupo: Android junta ahí los avisos de la misma categoría.
            val resumen = NotificationCompat.Builder(contexto, canal)
                .setSmallIcon(icono)
                .setContentTitle("Construni ERP · $nombreCategoria")
                .setSubText(nombreCategoria)
                .setStyle(NotificationCompat.InboxStyle().setSummaryText(nombreCategoria))
                .setGroup(grupo)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .apply { if (pendiente != null) setContentIntent(pendiente) }
                .build()

            try {
                val gestor = NotificationManagerCompat.from(contexto)
                gestor.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), aviso)
                gestor.notify(grupo.hashCode(), resumen)
            } catch (e: SecurityException) {
                // Sin permiso de notificaciones (Android 13+): no se muestra.
            }
        }
    }
}
