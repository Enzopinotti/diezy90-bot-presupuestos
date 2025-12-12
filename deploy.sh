#!/bin/bash
set -e

echo "🚀 Iniciando despliegue Diez y 90 Bot..."

echo "📥 Descargando cambios desde GitHub..."
git pull origin main

COMMIT=$(git rev-parse --short HEAD)
echo "✅ Código actualizado a commit: $COMMIT"

echo "🐳 Reconstruyendo contenedor app..."
docker compose up -d --build

echo "⏳ Esperando a que la app esté lista..."
sleep 5

echo ""
echo "📋 Últimos logs:"
docker logs --tail=30 diezy90-bot-presupuestos-app-1

echo ""
echo "✅ Despliegue completado"
echo "📊 Ver logs en vivo:"
echo "docker logs -f diezy90-bot-presupuestos-app-1"
