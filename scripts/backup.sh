#!/bin/bash

# Create Backup Directory with Timestamp
TIMESTAMP=$(date +"%Y%m%d-%H%M")
BACKUP_DIR="backup/$TIMESTAMP"

echo "Iniciando backup en $BACKUP_DIR..."

mkdir -p "$BACKUP_DIR"

# Define critical files to backup
FILES=(
    "instalacion.ini"
    "instalacion.json"
    "config.mjs"
    "server.mjs"
    "consumptionManager.mjs"
    "src/managers/tariff.mjs"
    "src/managers/weather.mjs"
    "src/api/tuya/client.mjs"
    "package.json"
    "retentionManager.mjs"
)

for FILE in "${FILES[@]}"; do
    if [ -f "$FILE" ]; then
        cp "$FILE" "$BACKUP_DIR/"
    fi
done

# Folders to backup
FOLDERS=(
    "scripts"
    "user_prefs"
)

for FOLDER in "${FOLDERS[@]}"; do
    if [ -d "$FOLDER" ]; then
        cp -r "$FOLDER" "$BACKUP_DIR/"
    fi
done

echo "Backup completado con éxito en: $BACKUP_DIR"
