# Base de datos de WhatNext

Fuente de verdad: [prisma/schema.prisma](../prisma/schema.prisma). Los cambios se aplican con `npm run db:setup`, que usa migraciones versionadas; no usar un reset ni db push para actualizar datos existentes.

SQLite guarda cuentas, sesiones, películas, listas TMDB, reseñas, relaciones sociales, avisos, dispositivos/entregas push, premios/logros/rangos, canjes y el historial de puntos. Las imágenes se guardan en uploads; Upload registra dueño, nombre y tamaño.

[TRANSFER.md](../TRANSFER.md) explica copias de seguridad, saldos históricos, migración de fotos y el cambio desde el backend simplificado. [ARCHITECTURE.md](../ARCHITECTURE.md) explica las relaciones y los cálculos. `npm run db:studio` abre el explorador; mantener el proceso activo.
