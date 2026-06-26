# Entorno de Desarrollo: Tuya & MingoTouch (Master Reference)

Este archivo centraliza la configuración técnica y la arquitectura de todo el ecosistema de domótica.

## 🗰 Arquitectura del Sistema
1.  **Servidor Tuya (Node.js)**: HUB central en **Raspberry Pi Zero 2W** (Debian/Linux).
2.  **MingoTouch (ESP32)**: Paneles táctiles de control basados en el hardware **ESP32-2432S024C** (Cheap Yellow Display).

---

## 🛠 Servidor Node.js (Raspberry Pi)
- **Ruta:** `r:\home\philippe\node.js\tuya` (Mapeada a unidad `R:` en Windows).
- **Gestión de Configuración:** `instalacion.ini`.
- **Nuevas Funcionalidades (Enero 2026):**
    - **Gestor MingoTouchs**: Sección en la UI web para organizar páginas mediante arrastrar y soltar. Actualiza automáticamente los campos `Esp32Pag` en el `.ini`.
    - **Corrección Drag & Drop (Enero 2026)**: Implementada ordenación por distancia Euclidiana para soportar layouts en rejilla (Grid). Eliminada duplicidad de funciones en `index.js`.
    - **Optimización de Estados**: Endpoint `/estados` que devuelve todos los estados de Tuya en un solo JSON para reducir latencia en los paneles ESP32.
    - **Normalización de Consumo (Enero 2026)**: Unificación de unidades a **décimas de vatio**. Los dispositivos que usan `phase_a` (ej: calentador) se decodifican en vatios y se multiplican por 10 en `consumptionManager.mjs` para ser coherentes con el `MedidorGeneral`.
    - **Reinicio de Servidor "Inteligente" (Enero 2026)**: Endpoint `/server/restart` para reinicio remoto. La UI web ahora utiliza un endpoint público `/health` para monitorizar el estado del arranque mediante polling activo. El sistema recarga la página tan pronto como detecta respuesta (típicamente ~15s), manteniendo una cuenta atrás visual de 25s como margen de seguridad.
    - **Conectividad Ngrok (Enero 2026)**: Conexión condicional si `WebHook === 'ngrok'`. Corregido error de binding usando la dirección explícita `${serverHost}:${serverPort}`.
    - **Ayuda Integrada (Enero 2026)**: Nueva sección `#bloque_ayuda` con guía de usuario y mantenimiento accesible desde el menú.
    - **Gestión de Dispositivos Offline (Enero 2026)**: El endpoint `/estados` ahora incluye el campo `online`. La UI web deshabilita y marca visualmente como "Desconectado" los equipos sin Wi-Fi para evitar confusiones.
    - **Control de Errores en UI (Enero 2026)**: Los interruptores de la web ahora tienen control de fallos; si el comando Tuya falla, el interruptor vuelve a su estado anterior y muestra un alert descriptivo.

    - **MingoTouch Simulator Fixes (Enero 2026)**: Actualizada lógica de `renderPreviewPage` para gestionar la estructura `{status, online}`. Corregido layout HTML en `index.html` restaurando el contenedor `bloque_mingotouchs`.
    - **Optimización Scroll (Enero 2026)**: Implementado `requestAnimationFrame` y aceleración hardware (`translate3d`) para el efecto parallax del fondo.

---

## 📱 MingoTouch (ESP32 / PlatformIO)
- **Ruta:** `C:\Users\Philippe\Documents\Mis Fuentes\platformio\tuyaio`
- **Hardware:** Pantalla 2.4", controlador **ILI9341**, táctil **XPT2046**.
- **Librerías Críticas:**
    - `LovyanGFX`: Motor gráfico con doble buffer. Uso obligatorio de `setColorDepth(8)` (1 octeto/pixel) para estabilidad; los 16-bit (2 octetos/pixel) requieren 150KB contiguos que el chip no puede garantizar sin PSRAM externa.
    - `ArduinoJson 7`: Procesamiento de datos del servidor.
- **Optimizaciones de Rendimiento (Enero 2026):**
    - **Multitarea (Dual Core)**: Lógica de red en Core 0, UI en Core 1 mediante FreeRTOS Tasks y Mutex (`dataMutex`).
    - **Velocidad del CPU**: Overclock estable a **240MHz**.
    - **Bus de Datos**: SPI subido a **80MHz** (velocidad máxima del ESP32 para transferencia a pantalla).
    - **Lectura Flash**: Modo **QIO a 80MHz** para carga instantánea de recursos.
- **Fuentes**: Carga archivos `.vlw` desde MicroSD (`/sd/font.vlw`) o LittleFS (`/littlefs/font.vlw`). Soporta UTF-8 (acentos españoles).

---

## 📺 Nota Técnica: Configuración de Pantalla (Frankenstein)
La configuración actual en `main.cpp` es **altamente específica y vital para la estabilidad**, aunque parezca "incorrecta":

1.  **Geometría Forzada (320x240 + Offset 80)**: El panel es físicamente 240x320. Se inicializa forzado a 320x240 con un desfase de 80 píxeles para saltar el área de memoria no visible del controlador ILI9341.
2.  **Rotación 4 (Mirror)**: Se usa el modo espejo de LovyanGFX para que el texto sea legible. Esto evita tener que recalcular manualmente todos los ejes, pero requiere que el táctil esté calibrado con `y_min > y_max`.
3.  **Límite de 8 bits (Sin PSRAM)**:
    - **16 bits**: Requiere 153.6 KB de RAM contigua. Imposible de asignar sin PSRAM en este modelo.
    - **PNG**: El decodificador PNG + el buffer del Sprite agotan la RAM. Por eso se usan **iconos programáticos** (dibujados por código).
4.  **⚠ AVISO**: No intentar "normalizar" a 240x320 con rotación lógica sin estar preparado para re-escribir TODAS las funciones de dibujo y coordenadas táctiles. Si funciona, no lo toques.

---


## ⚙️ Parámetros de Interacción (instalacion.ini)
Para que un dispositivo aparezca en un panel MingoTouch, debe tener definidos:
- `Esp32Dsp`: ID del panel (ej: `1`). Centralizado en el endpoint `/mingotouchs`.
- `Esp32Pag`: Orden de la página (1, 2, 3...). Gestionado visualmente desde la web.
- `Esp32Tip`: Estilo de visualización (`Consumo`, `Clima`, `Luz`, `Enchufe`).

---

## � Notas de Mantenimiento
- **Linter (C++):** El archivo `.clangd` en el proyecto ESP32 redirige las rutas de cabecera al toolchain de PlatformIO en Windows. Si falla, revisar rutas en `C:\Users\Philippe\.platformio\packages\toolchain-xtensa-esp32`.
- **Despliegue:** Los cambios en `server.mjs` requieren reinicio del servicio si no usas un watcher como `pm2` o `nodemon` (usar `sudo systemctl restart node-server`).
- **Backup:** Scripts disponibles en `scripts/backup.ps1` (ESP32) y `backup.cmd` (Pi).
- **Entorno Windows:** No dispone de `grep` nativo en la terminal estándar. Usar `Select-String` en PowerShell o instalar `Git Bash` / `GnuWin32` para tener comandos Unix.
