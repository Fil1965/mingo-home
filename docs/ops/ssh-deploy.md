# Guía de operaciones: SSH y despliegue

Procedimientos para acceder al servidor de producción (Raspberry Pi) y desplegar
cambios desde cualquier máquina de desarrollo.

---

## Servidor de producción

| Dato | Valor |
|------|-------|
| Host | `192.168.1.5` |
| Usuario | `philippe` |
| Hostname | `raspberrypi` |
| Ruta del proyecto | `/home/philippe/node.js/tuya` |
| Servicio | `mingo-home` (systemd) |
| Puerto app | `3000` |

---

## 1. Configurar acceso SSH por clave (una vez por máquina)

Sustituye a la autenticación por contraseña. Más seguro, cómodo y permite
automatización (scripts, sync, etc.).

### 1.1 Desde Linux

```bash
# 1. Generar la clave (ed25519: moderna, rápida, segura)
ssh-keygen -t ed25519 -C "mingo-home@<nombre-maquina>"
#   - Ruta por defecto: ~/.ssh/id_ed25519
#   - Passphrase: vacía para automatización, o con valor para más seguridad
#     (entonces usar ssh-agent para no teclearla cada vez)

# 2. Copiar la clave pública al servidor (pide la contraseña una última vez)
ssh-copy-id philippe@192.168.1.5

# 3. Verificar que entra sin contraseña
ssh philippe@192.168.1.5 "hostname && uptime"
```

### 1.2 Desde Windows 11

Windows 10 (1809+) y Windows 11 traen OpenSSH de serie.

```powershell
# 1. Generar la clave
ssh-keygen -t ed25519 -C "mingo-home@windows11"
#   - Ruta por defecto: C:\Users\<tu_usuario>\.ssh\id_ed25519

# 2. Copiar la clave pública (Windows no tiene ssh-copy-id)
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh philippe@192.168.1.5 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# 3. Verificar
ssh philippe@192.168.1.5 "hostname && uptime"
```

### 1.3 Endurecer el SSH del servidor (recomendado)

**Solo después de confirmar que la clave funciona desde todas las máquinas
que necesiten acceso.**

```bash
ssh philippe@192.168.1.5
sudo nano /etc/ssh/sshd_config
```

Cambiar/verificar estas directivas:

```
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
```

Reiniciar el servicio:

```bash
sudo systemctl restart sshd
```

> ⚠️ **Cuidado**: si te equivocas y no tienes ninguna clave funcionando, te
> quedas sin acceso SSH. Verifica con `ssh philippe@192.168.1.5` **antes** de
> desactivar passwords. Ten a mano un teclado/monitor por si acaso.

### 1.4 Backup de claves

Guarda las claves privadas (`~/.ssh/id_ed25519` o el `.pem` que uses) en un
sitio seguro: pen drive cifrado, gestor de contraseñas, etc. Si las pierdes y
has desactivado passwords, te quedas fuera del servidor.

---

## 2. Desplegar cambios en producción

### 2.1 Desde Windows 11 (mapeo UNC)

El script `npm run sync` copia el proyecto a `N:\home\philippe\node.js\tuya`
(mapeo UNC a la Raspberry). Configuración en `sync.config.json`.

```powershell
# En la raíz del proyecto, desde Windows 11 con la unidad N: mapeada
npm run sync
```

Exclusiones automáticas: `node_modules`, `logs`, `sessions`, `instalacion.json`,
`instalacion.backups`, `user_prefs`, etc. (ver `sync.config.json`).

Ficheros preservados en destino: `instalacion.json`, `notifications.json`.

### 2.2 Desde Linux (rsync por SSH)

Si no tienes el mapeo UNC `N:` montado en Linux, usa `rsync` por SSH:

```bash
# Desde la raíz del proyecto
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='logs' \
  --exclude='sessions' \
  --exclude='user_prefs' \
  --exclude='instalacion.json' \
  --exclude='instalacion.backups' \
  --exclude='notifications.json' \
  --exclude='public/json' \
  --exclude='test' \
  --exclude='_borrar' \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.idea' \
  --exclude='.vscode' \
  --exclude='sync.config.json' \
  --exclude='scripts/sync.mjs' \
  --exclude='eslint.config.mjs' \
  ./ philippe@192.168.1.5:/home/philippe/node.js/tuya/
```

> Las exclusiones replican las de `sync.config.json`. Si añades una exclusión
> nueva ahí, recuerda añadirla también a este comando.

### 2.3 Reiniciar el servicio

```bash
ssh philippe@192.168.1.5 "sudo systemctl restart mingo-home"
```

Verificar que está corriendo:

```bash
ssh philippe@192.168.1.5 "sudo systemctl status mingo-home"
```

---

## 3. Leer logs de producción

### 3.1 Log crudo (formato JSON de pino)

```bash
# Últimas 50 líneas
ssh philippe@192.168.1.5 "tail -50 /home/philippe/node.js/tuya/logs/server.log"

# Buscar un error concreto con su traza
ssh philippe@192.168.1.5 "grep 'Error energy update' /home/philippe/node.js/tuya/logs/server.log | tail -1"
```

### 3.2 Log formateado (vía API del servidor)

```bash
# Últimas 35 líneas (requiere auth)
curl -s -u admin:cambia_esta_clave http://192.168.1.5:3000/log/35

# Últimas 24h
curl -s -u admin:cambia_esta_clave http://192.168.1.5:3000/log/24h
```

> El log viewer formatea el JSON de pino a `[timestamp] LEVEL: msg` y, desde
> v1.1.1, incluye `err.message` y `err.stack` cuando existen.

---

## 4. Checklist de despliegue rápido

```
[ ] 1. Cambios probados en desarrollo (npm start)
[ ] 2. Tests pasan (npm test)
[ ] 3. Sin errores de lint (npx eslint .)
[ ] 4. Sincronizar (npm run sync desde Windows, o rsync desde Linux)
[ ] 5. Reiniciar servicio (ssh ... systemctl restart mingo-home)
[ ] 6. Verificar log de arranque (ssh ... tail -20 .../server.log)
[ ] 7. Verificar que los paneles responden (curl .../log/35 o abrir web UI)
```