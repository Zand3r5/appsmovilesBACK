# Base de datos de WhatNext

Fuente de verdad: [prisma/schema.prisma](../prisma/schema.prisma). Los cambios se aplican con `npm run db:setup`, que usa migraciones versionadas; no usar un reset ni db push para actualizar datos existentes.

SQLite guarda cuentas, sesiones, películas, listas TMDB, reseñas, relaciones sociales, avisos, dispositivos/entregas push, premios/logros/rangos, canjes y el historial de puntos. Las imágenes se guardan en uploads; Upload registra dueño, nombre y tamaño.

`npm run db:setup` crea una copia consistente de SQLite y uploads, aplica las migraciones y restaura las referencias de imágenes con su dueño. [ARCHITECTURE.md](../ARCHITECTURE.md) explica las relaciones y los cálculos. `npm run db:studio` abre el explorador; mantener el proceso activo. La ubicación activa se define en `DATABASE_URL`; localmente usamos `prisma/local.db`.
