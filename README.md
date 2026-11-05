# WhatNext: backend

API en Express, Prisma y SQLite, con un worker para tareas programadas. Requiere Node 22.

## Instalación

```powershell
npm ci
Copy-Item .env.example .env
```

En `.env`, completá `JWT_SECRET` con un texto largo al azar. Para sincronizar el catálogo, completá también `TMDB_KEY`.

```powershell
npm run db:setup
```

## Crear el administrador

```powershell
$env:ADMIN_EMAIL = "admin@ejemplo.com"
$env:ADMIN_NAME = "Admin"
$env:ADMIN_PASSWORD = "UnaClave1234"
npm run admin:create
```

## Ejecutar

En dos terminales:

```powershell
npm run dev
npm run worker
```

La API queda en `http://localhost:3000/api`.
