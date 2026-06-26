$currentDir = Get-Location
$zipName = "tuya_$(Get-Date -Format 'yyyyMMdd-HHmm')" # Calcula el nombre del archivo ZIP con fecha y hora
$outputPath = Join-Path -Path $currentDir -ChildPath "_7z"
$zipFile = Join-Path -Path $outputPath -ChildPath "$zipName.7z"

# Asegúrate de que la carpeta _7z existe
if (-Not (Test-Path -Path $outputPath)) {
    New-Item -ItemType Directory -Force -Path $outputPath
}

$7zipPath = "C:\Program Files\7-Zip\7z.exe" # Ruta de tu 7z.exe

# Excluir directorios _7z, node_modules y .github
$excludeList = '_7z', 'node_modules', '.github', '.idea', '_borrar'

# Convertir la lista de exclusiones en un array de argumentos para 7z
$excludeArgs = @()
foreach ($dir in $excludeList) {
    $excludeArgs += "-xr!`"$dir`""
}

& $7zipPath a -t7z $zipFile * @excludeArgs

Write-Output "Archivo ZIP generado en $zipFile"