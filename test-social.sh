#!/usr/bin/env bash
# Prueba rápida del Sprint 6. Requiere servidor corriendo y `npm run db:seed`.
# Deja la base como estaba (borra las amistades que crea).
U=${1:-http://localhost:3000}
J='Content-Type: application/json'
login() { curl -s -X POST $U/api/auth/login -H "$J" -d "{\"email\":\"$1\",\"password\":\"Demo1234\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token'; }
js() { node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));$1"; }
A() { echo "-H"; echo "Authorization: Bearer $1"; }

SOFIA=$(login sofia.demo@whatsnext.app); NIC=$(login nicolas.demo@whatsnext.app); MATEO=$(login mateo.demo@whatsnext.app); ADMIN=$(login admin.demo@whatsnext.app); LUCIA=$(login lucia.demo@whatsnext.app)
H() { echo "Authorization: Bearer $1"; }

echo "== amigos sin sesión (401)";                 curl -s $U/api/friends; echo
echo "== amigos de Mateo (Lucía y Nicolás)";       curl -s $U/api/friends -H "$(H $MATEO)" | js 'j.map(f=>f.name+"(req "+f.requestId+")").join(", ")'
echo "== estado Mateo→Lucía (friends)";            curl -s $U/api/friends/status/4 -H "$(H $MATEO)"; echo
echo "== estado Sofía→Nicolás (none)";             curl -s $U/api/friends/status/5 -H "$(H $SOFIA)"; echo
echo "== agregarse a sí mismo (400)";              curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $SOFIA)" -d '{"toId":2}'; echo
echo "== usuario inexistente (404)";               curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $SOFIA)" -d '{"toId":999}'; echo
echo "== ya son amigos (409)";                     curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $SOFIA)" -d '{"toId":4}'; echo
echo "== Sofía le manda solicitud a Nicolás (201)"
curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $SOFIA)" -d '{"toId":5}' > req.tmp; js 'JSON.stringify(j)' < req.tmp
RID=$(js 'j.id' < req.tmp); rm -f req.tmp
echo "== solicitud repetida, en cualquier sentido (409)"
curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $SOFIA)" -d '{"toId":5}'; echo
curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $NIC)" -d '{"toId":2}'; echo
echo "== estado: Sofía=sent, Nicolás=received"
curl -s $U/api/friends/status/5 -H "$(H $SOFIA)" | js 'j.status'; curl -s $U/api/friends/status/2 -H "$(H $NIC)" | js 'j.status'
echo "== pendientes de Nicolás";                   curl -s $U/api/friends/requests/pending -H "$(H $NIC)" | js 'j.map(r=>r.from.name).join(", ")'
echo "== notificaciones de Nicolás (friend_request sin leer)"
curl -s $U/api/notifications -H "$(H $NIC)" | js 'j.filter(n=>n.type==="friend_request").map(n=>n.actor.name+" read="+n.read).join(", ")'
echo "== Sofía intenta aceptar su propia solicitud (403)"
curl -s -X POST $U/api/friends/requests/$RID/respond -H "$J" -H "$(H $SOFIA)" -d '{"accept":true}'; echo
echo "== respond sin accept (400)";                curl -s -X POST $U/api/friends/requests/$RID/respond -H "$J" -H "$(H $NIC)" -d '{}'; echo
echo "== Nicolás acepta (200)";                    curl -s -X POST $U/api/friends/requests/$RID/respond -H "$J" -H "$(H $NIC)" -d '{"accept":true}'; echo
echo "== ahora son friends; aviso quedó leído"
curl -s $U/api/friends/status/5 -H "$(H $SOFIA)" | js 'j.status'
curl -s $U/api/notifications -H "$(H $NIC)" | js 'j.filter(n=>n.type==="friend_request").map(n=>"read="+n.read).join(", ")'
echo "== responder de nuevo (404)";                curl -s -X POST $U/api/friends/requests/$RID/respond -H "$J" -H "$(H $NIC)" -d '{"accept":true}'; echo
echo "== un tercero no puede eliminarla (403)";    curl -s -X DELETE $U/api/friends/$RID -H "$(H $MATEO)"; echo
echo "== Nicolás elimina la amistad (204)";        curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $U/api/friends/$RID -H "$(H $NIC)"
echo "== estado vuelve a none";                    curl -s $U/api/friends/status/5 -H "$(H $SOFIA)" | js 'j.status'

echo "== rechazo: Admin → Lucía, Lucía rechaza"
curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $ADMIN)" -d '{"toId":4}' | js 'j.id' > r2.tmp; R2=$(cat r2.tmp); rm -f r2.tmp
curl -s -X POST $U/api/friends/requests/$R2/respond -H "$J" -H "$(H $LUCIA)" -d '{"accept":false}'; echo
curl -s $U/api/friends/status/4 -H "$(H $ADMIN)" | js 'j.status'
echo "== cancelar solicitud enviada borra el aviso: Admin → Lucía, Admin cancela"
curl -s -X POST $U/api/friends/requests -H "$J" -H "$(H $ADMIN)" -d '{"toId":4}' | js 'j.id' > r3.tmp; R3=$(cat r3.tmp); rm -f r3.tmp
curl -s $U/api/notifications -H "$(H $LUCIA)" | js 'j.filter(n=>n.type==="friend_request"&&!n.read).length+" avisos sin leer de solicitud"'
curl -s -o /dev/null -X DELETE $U/api/friends/$R3 -H "$(H $ADMIN)"
curl -s $U/api/notifications -H "$(H $LUCIA)" | js 'j.filter(n=>n.type==="friend_request"&&!n.read).length+" avisos sin leer tras cancelar (esperado 0)"'

echo "== like de Nicolás a reseña de Mateo genera aviso a Mateo; sacar el like lo borra"
RV=$(curl -s $U/api/users/3/reviews | js 'j.find(r=>!r.likes||true).id')
curl -s -X POST $U/api/reviews/$RV/like -H "$(H $NIC)" | js '"liked="+j.liked'
curl -s $U/api/notifications -H "$(H $MATEO)" | js 'j.filter(n=>n.type==="review_like"&&n.actor.name.startsWith("Nic")).map(n=>"aviso: "+n.actor.name+" → "+n.movie.title+" read="+n.read).join(", ")' > like.tmp; cat like.tmp
NID=$(curl -s $U/api/notifications -H "$(H $MATEO)" | js 'j.find(n=>n.type==="review_like"&&n.actor.name.startsWith("Nic")).id')
echo "== marcar leída (200) y la de otro (404)"
curl -s -X PATCH $U/api/notifications/$NID/read -H "$(H $MATEO)" | js '"read="+j.read'
curl -s -X PATCH $U/api/notifications/$NID/read -H "$(H $NIC)"; echo
echo "== marcar todas leídas (204) y sin sin-leer"
curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/api/notifications/read-all -H "$(H $MATEO)"
curl -s $U/api/notifications -H "$(H $MATEO)" | js 'j.filter(n=>!n.read).length+" sin leer"'
curl -s -X POST $U/api/reviews/$RV/like -H "$(H $NIC)" | js '"liked="+j.liked'
curl -s $U/api/notifications -H "$(H $MATEO)" | js 'j.filter(n=>n.type==="review_like"&&n.actor.name.startsWith("Nic")).length+" avisos de Nicolás tras sacar el like (esperado 0)"'
rm -f like.tmp
