# WhatNext

Requiere Node 22.

## Back

En la carpeta del back:

```powershell
npm ci
cp .env.example .env
npm run db:setup
npm run catalog:sync
npm run dev
```

## Front

En otra terminal, en la carpeta del front:

```powershell
npm ci
npm start
```

Escaneá el QR con Expo Go, con el celular y la computadora en la misma red.
## Crear el administrador

```powershell
$env:ADMIN_EMAIL = "admin@ejemplo.com"
$env:ADMIN_NAME = "Admin"
$env:ADMIN_PASSWORD = "UnaClave1234"
npm run admin:create
npm run catalog:sync
npm run dev
```

## usuarios predeterminados
 mail: mateo.demo@whatsnext.app
contra: Demo1234

mail: sofia.demo@whatsnext.app
contra: Demo1234