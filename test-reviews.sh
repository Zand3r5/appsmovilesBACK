#!/usr/bin/env bash
# Prueba rápida del Sprint 4. Requiere servidor corriendo y `npm run db:seed`
U=${1:-http://localhost:3000}
J='Content-Type: application/json'
short() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.length>330?s.slice(0,330)+"...":s))'; }
list() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(Array.isArray(j)?j.length+" reseñas: "+j.map(r=>r.author?.name+" → "+r.movie?.title+" ("+r.rating+", "+r.likes+" likes)").join(" | "):JSON.stringify(j))})'; }
login() { curl -s -X POST $U/api/auth/login -H "$J" -d "{\"email\":\"$1\",\"password\":\"Demo1234\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token'; }
field() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).$1"; }

echo "== reseñas de Interstellar";       curl -s "$U/api/movies/157336/reviews" | list
echo "== reseñas de Mateo (id 3)";       curl -s "$U/api/users/3/reviews" | list
echo "== populares";                     curl -s "$U/api/reviews/popular" | list

MATEO=$(login mateo.demo@whatsnext.app); LUCIA=$(login lucia.demo@whatsnext.app); ADMIN=$(login admin.demo@whatsnext.app); NIC=$(login nicolas.demo@whatsnext.app)
echo "== feed de amigos de Mateo";       curl -s $U/api/reviews/friends -H "Authorization: Bearer $MATEO" | list
echo "== feed de amigos sin sesión (401)"; curl -s $U/api/reviews/friends; echo

echo "== crear reseña como Admin en Barbie (201)"
curl -s -X POST $U/api/movies/346698/reviews -H "$J" -H "Authorization: Bearer $ADMIN" -d '{"text":"Reseña de prueba","rating":4}' > rev.tmp; short < rev.tmp
RID=$(field id < rev.tmp); rm -f rev.tmp
echo "== crear de nuevo en la misma peli (409 + code)"; curl -s -X POST $U/api/movies/346698/reviews -H "$J" -H "Authorization: Bearer $ADMIN" -d '{"text":"otra","rating":3}'; echo
echo "== sin puntaje (400)";             curl -s -X POST $U/api/movies/278/reviews -H "$J" -H "Authorization: Bearer $ADMIN" -d '{"text":"hola"}'; echo
echo "== puntaje 4.3 (400)";             curl -s -X POST $U/api/movies/278/reviews -H "$J" -H "Authorization: Bearer $ADMIN" -d '{"text":"hola","rating":4.3}'; echo
echo "== peli inexistente (404)";        curl -s -X POST $U/api/movies/999/reviews -H "$J" -H "Authorization: Bearer $ADMIN" -d '{"text":"hola","rating":4}'; echo
echo "== editar propia (200)";           curl -s -X PATCH $U/api/reviews/$RID -H "$J" -H "Authorization: Bearer $ADMIN" -d '{"text":"Editada","rating":4.5}' | short; echo
echo "== editar ajena (403)";            curl -s -X PATCH $U/api/reviews/$RID -H "$J" -H "Authorization: Bearer $MATEO" -d '{"text":"hack"}'; echo
echo "== like de Mateo (liked:true)";    curl -s -X POST $U/api/reviews/$RID/like -H "Authorization: Bearer $MATEO" | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));"liked="+j.liked+" likes="+j.comment.likes'
echo "== like de Lucía (likes=2)";       curl -s -X POST $U/api/reviews/$RID/like -H "Authorization: Bearer $LUCIA" | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));"liked="+j.liked+" likes="+j.comment.likes'
echo "== like de Mateo otra vez (liked:false)"; curl -s -X POST $U/api/reviews/$RID/like -H "Authorization: Bearer $MATEO" | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));"liked="+j.liked+" likes="+j.comment.likes'
echo "== repost de Mateo (reposted:true)"; curl -s -X POST $U/api/reviews/$RID/repost -H "Authorization: Bearer $MATEO" | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));"reposted="+j.reposted+" reposts="+j.comment.reposts'
echo "== reposts de Mateo";              curl -s $U/api/users/3/reposts | list
echo "== /me de Mateo trae reposts";     curl -s $U/api/auth/me -H "Authorization: Bearer $MATEO" | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")).user;"likes="+JSON.stringify(j.likes)+" reposts="+JSON.stringify(j.reposts)'
echo "== borrar ajena como user (403)";  curl -s -X DELETE $U/api/reviews/$RID -H "Authorization: Bearer $NIC"; echo
echo "== borrar como autor (204)";       curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $U/api/reviews/$RID -H "Authorization: Bearer $ADMIN"
echo "== borrar de nuevo (404)";         curl -s -X DELETE $U/api/reviews/$RID -H "Authorization: Bearer $ADMIN"; echo
echo "== likes de Mateo tras borrar (sin el like a la reseña borrada)"
curl -s $U/api/auth/me -H "Authorization: Bearer $MATEO" | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")).user;"reposts="+JSON.stringify(j.reposts)'
