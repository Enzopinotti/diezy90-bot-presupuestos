#!/bin/bash
# Script de despliegue simple para producción

set -e  # Salir si hay error

echo "🚀 Iniciando despliegue..."

# 1. Descargar cambios de GitHub
echo "📥 Descargando cambios desde GitHub..."
git pull origin main

# 2. Ver commit actual
COMMIT=$(git rev-parse --short HEAD)
echo "✅ Código actualizado a commit: $COMMIT"

# 3. Reconstruir contenedor app (sin tocar la DB)
echo "🐳 Reconstruyendo contenedor..."
docker compose up -d --build --no-deps app

# 4. Esperar unos segundos
echo "⏳ Esperando a que la app esté lista..."
sleep 5

# 5. Ver logs recientes
echo ""
echo "📋 Últimos logs:"
docker logs --tail=30 kaia-app

echo ""
echo "✅ Despliegue completado"
echo "📊 Ver logs en vivo: docker logs -f kaia-app"
