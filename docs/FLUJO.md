# Flujo de WhatNext

La guía actual está en [ARCHITECTURE.md](../ARCHITECTURE.md). Incluye inicio de procesos, rutas /api, cálculos, cron TMDB, push, Wallet y el mapa de funciones.

Para ejecutar la API y el worker: [README.md](../README.md). Para actualizar datos existentes: `npm run db:setup` respalda la base y uploads, aplica migraciones, inicializa definiciones faltantes y migra las imágenes conservando sus dueños. El frontend vive en su repositorio separado.

El cambio de contraseña usa `POST /api/auth/change-password`: verifica la contraseña actual y actualiza su hash junto con la revocación de otras sesiones en una transacción. La sesión que hizo el cambio continúa activa. Las contraseñas deben respetar el límite de bcrypt de 72 bytes UTF-8.
