# Carpeta de destino
$OutputDir = "R:\home\philippe\node.js\tuya\public\media"

# Crear carpeta si no existe
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Lista oficial de iconos de OpenWeather
$Icons = @(
    "01d","01n",
    "02d","02n",
    "03d","03n",
    "04d","04n",
    "09d","09n",
    "10d","10n",
    "11d","11n",
    "13d","13n",
    "50d","50n"
)

# URL base
$BaseUrl = "https://openweathermap.org/img/w"

# Descargar iconos
foreach ($icon in $Icons) {
    $url = "$BaseUrl/$icon.png"
    $outputFile = Join-Path $OutputDir "$icon.png"

    Write-Host "Descargando $icon..."
    Invoke-WebRequest -Uri $url -OutFile $outputFile
}

Write-Host "✅ Descarga completada. Iconos guardados en $OutputDir"
