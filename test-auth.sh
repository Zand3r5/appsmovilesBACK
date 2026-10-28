#!/usr/bin/env bash
# Prueba rápida del Sprint 2. Requiere el servidor corriendo (npm start) y el seed (npm run db:seed)
U=${1:-http://localhost:3000}
J='Content-Type: application/json'
echo "== login admin (espera token + user)"
curl -s -X POST $U/api/auth/login -H "$J" -d '{"email":"admin.demo@whatsnext.app","password":"Demo1234"}'; echo
echo "== login mal (401)"
curl -s -X POST $U/api/auth/login -H "$J" -d '{"email":"admin.demo@whatsnext.app","password":"xxx"}'; echo
echo "== registro nuevo, rol ignorado (201, role user)"
curl -s -X POST $U/api/auth/register -H "$J" -d "{\"name\":\"Test\",\"email\":\"t$RANDOM@x.com\",\"password\":\"Clave1234\",\"role\":\"superadmin\"}" | tee reg.tmp; echo
echo "== registro email repetido (409)"
curl -s -X POST $U/api/auth/register -H "$J" -d '{"name":"X","email":"admin.demo@whatsnext.app","password":"Clave1234"}'; echo
echo "== registro pass debil (400)"
curl -s -X POST $U/api/auth/register -H "$J" -d '{"name":"X","email":"a@b.com","password":"abc"}'; echo
T=$(node -pe 'JSON.parse(require("fs").readFileSync("reg.tmp","utf8")).token')
rm -f reg.tmp
echo "== me sin token (401)"
curl -s $U/api/auth/me; echo
echo "== me con token (200)"
curl -s $U/api/auth/me -H "Authorization: Bearer $T"; echo
echo "== patch nombre (200)"
curl -s -X PATCH $U/api/users/me -H "$J" -H "Authorization: Bearer $T" -d '{"name":"Renombrado"}'; echo
echo "== patch email tomado (409)"
curl -s -X PATCH $U/api/users/me -H "$J" -H "Authorization: Bearer $T" -d '{"email":"admin.demo@whatsnext.app"}'; echo
