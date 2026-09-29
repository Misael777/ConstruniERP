import os
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

# ===== CONFIGURACIÓN =====
CARPETA_ENTRADA = "C:\\Users\\linar\\Desktop\\PROYECTOS_2026\\ERPConstruni\\ConstruniERP\\app\\assets\\Animacion_loading_frames"          # carpeta con los frames originales
CARPETA_SALIDA  = "C:\\Users\\linar\\Desktop\\PROYECTOS_2026\\ERPConstruni\\ConstruniERP\\app\\assets\\Animacion_loading_frames_rmbkg" # carpeta de salida
MODELO          = "u2net"           # opciones: u2net, u2netp, isnet-general-use, silueta
EXTENSIONES     = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
# =========================

def quitar_fondo_carpeta():
    entrada = Path(CARPETA_ENTRADA)
    salida  = Path(CARPETA_SALIDA)
    salida.mkdir(parents=True, exist_ok=True)

    if not entrada.exists():
        print(f"❌ La carpeta '{CARPETA_ENTRADA}' no existe.")
        return

    # Cargamos el modelo una sola vez (mucho más rápido en lote)
    print(f"🧠 Cargando modelo '{MODELO}'...")
    session = new_session(MODELO)

    # Listamos y ordenamos los frames
    archivos = sorted(
        [f for f in entrada.iterdir() if f.suffix.lower() in EXTENSIONES]
    )

    if not archivos:
        print("⚠️  No se encontraron imágenes en la carpeta.")
        return

    total = len(archivos)
    print(f"📸 Procesando {total} frames...\n")

    for i, archivo in enumerate(archivos, 1):
        try:
            img = Image.open(archivo).convert("RGBA")
            resultado = remove(img, session=session)

            # Guardamos como PNG para conservar la transparencia
            destino = salida / f"{archivo.stem}.png"
            resultado.save(destino, "PNG")

            print(f"[{i}/{total}] ✅ {archivo.name} → {destino.name}")
        except Exception as e:
            print(f"[{i}/{total}] ❌ Error con {archivo.name}: {e}")

    print(f"\n🎉 Listo. Frames guardados en: {salida.resolve()}")


if __name__ == "__main__":
    quitar_fondo_carpeta()