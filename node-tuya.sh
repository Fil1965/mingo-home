#!/bin/sh
if [[ $1 = "start" ]]; then
echo "INICIANDO SERVIDOR NODE"
node /volume1/server/tuya/server.mjs

else if [[ $1 = "stop" ]]; then

echo "DETENIENDO SERVIDOR NODE "

killall node

else

echo 'No se ha seleccionado ninguna opcion...';

fi

fi

