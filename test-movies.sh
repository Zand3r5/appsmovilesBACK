#!/usr/bin/env bash
# Prueba rápida del Sprint 3. Requiere servidor corriendo y `npm run db:seed`
U=${1:-http://localhost:3000}
J='Content-Type: application/json'
short() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.length>400?s.slice(0,400)+"...":s))'; }
count() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(Array.isArray(j)?j.length+" resultados: "+j.map(m=>m.title||m).join(" | "):JSON.stringify(j))})'; }
login() { curl -s -X POST $U/api/auth/login -H "$J" -d "{\"email\":\"$1\",\"password\":\"Demo1234\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token'; }

echo "== catálogo completo";                curl -s "$U/api/movies" | count
echo "== search=war (Expediente Warren)";   curl -s "$U/api/movies?search=war" | count
echo "== genre=Ciencia ficción";            curl -s "$U/api/movies?genre=Ciencia%20ficci%C3%B3n" | count
echo "== year=2023";                        curl -s "$U/api/movies?year=2023" | count
echo "== featured=true";                    curl -s "$U/api/movies?featured=true" | count
echo "== sort=title limit=3 offset=1";      curl -s "$U/api/movies?sort=title&limit=3&offset=1" | count
echo "== géneros";                          curl -s "$U/api/genres" | count
echo "== detalle 157336 (Interstellar)";    curl -s "$U/api/movies/157336" | short
echo "== recomendadas de 157336";           curl -s "$U/api/movies/157336/recommendations" | count
echo "== id inválido (400)";                curl -s "$U/api/movies/abc"; echo
echo "== no existe (404)";                  curl -s "$U/api/movies/999"; echo

USER_T=$(login mateo.demo@whatsnext.app); ADMIN_T=$(login admin.demo@whatsnext.app)
echo "== crear sin sesión (401)";           curl -s -X POST $U/api/movies -H "$J" -d '{"title":"X","overview":"Y"}'; echo
echo "== crear como user (403)";            curl -s -X POST $U/api/movies -H "$J" -H "Authorization: Bearer $USER_T" -d '{"title":"X","overview":"Y"}'; echo
echo "== crear como admin, sin tmdbId (201)"
curl -s -X POST $U/api/movies -H "$J" -H "Authorization: Bearer $ADMIN_T" -d '{"title":"Peli manual","overview":"Prueba","genres":["Drama","Género nuevo"],"releaseDate":"2026-01-15","runtime":"95","featured":true}' | tee manual.tmp | short; echo
ID=$(node -pe 'JSON.parse(require("fs").readFileSync("manual.tmp","utf8")).id'); rm -f manual.tmp
echo "== crear con título vacío (400)";     curl -s -X POST $U/api/movies -H "$J" -H "Authorization: Bearer $ADMIN_T" -d '{"title":" ","overview":"Y"}'; echo
echo "== editar título y géneros (200)";    curl -s -X PATCH $U/api/movies/$ID -H "$J" -H "Authorization: Bearer $ADMIN_T" -d '{"title":"Peli editada","genres":["Comedia"]}' | short; echo
echo "== borrar (204)";                     curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $U/api/movies/$ID -H "Authorization: Bearer $ADMIN_T"
echo "== borrar de nuevo (404)";            curl -s -X DELETE $U/api/movies/$ID -H "Authorization: Bearer $ADMIN_T"; echo
echo "== importar de TMDB 550 (Fight Club)"; curl -s -X POST $U/api/movies/import/550 -H "Authorization: Bearer $ADMIN_T" | short; echo
curl -s -o /dev/null -X DELETE $U/api/movies/550 -H "Authorization: Bearer $ADMIN_T"

echo "== cartelera";                        curl -s "$U/api/releases/now-playing" | count
echo "== próximos estrenos";                curl -s "$U/api/releases/upcoming" | count
