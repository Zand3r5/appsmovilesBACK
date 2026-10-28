#!/usr/bin/env bash
# Prueba rápida del Sprint 5. Requiere servidor corriendo y `npm run db:seed`
U=${1:-http://localhost:3000}
J='Content-Type: application/json'
login() { curl -s -X POST $U/api/auth/login -H "$J" -d "{\"email\":\"$1\",\"password\":\"Demo1234\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token'; }
js() { node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));$1"; }

MATEO=$(login mateo.demo@whatsnext.app); ADMIN=$(login admin.demo@whatsnext.app)
echo "== catálogo de premios";            curl -s $U/api/rewards | js 'j.map(r=>r.title+" ("+r.cost+")").join(" | ")'
echo "== logros de Mateo (id 3)";         curl -s $U/api/users/3/achievements | js '"puntos="+j.totalPoints+" desbloqueados="+j.list.filter(a=>a.unlocked).map(a=>a.id)+" reseñas="+j.profile.reviews+" likes="+j.profile.likes'
echo "== usuario inexistente (404)";      curl -s $U/api/users/999/achievements; echo
echo "== perfil público de Mateo";        curl -s $U/api/users/3/profile | js '"rank="+(j.rank.current?j.rank.current.name:"ninguno")+" siguiente="+j.rank.next.name+" progreso="+j.rank.progress.toFixed(2)+" stats="+JSON.stringify(j.stats)+" reseñas="+j.comments.length'
echo "== mis canjes sin sesión (401)";    curl -s $U/api/rewards/redemptions; echo
echo "== mis canjes (vacío)";             curl -s $U/api/rewards/redemptions -H "Authorization: Bearer $MATEO" | js 'JSON.stringify(j)'
echo "== canjear premio inexistente (404)"; curl -s -X POST $U/api/rewards/nada/redeem -H "Authorization: Bearer $MATEO"; echo
echo "== canjear 'free_ticket' sin puntos (400)"; curl -s -X POST $U/api/rewards/free_ticket/redeem -H "Authorization: Bearer $MATEO"; echo
echo "== canjear 'popcorn' (201)"
curl -s -X POST $U/api/rewards/popcorn/redeem -H "Authorization: Bearer $MATEO" > red.tmp; js 'JSON.stringify(j)' < red.tmp
RID=$(js 'j.redemption.id' < red.tmp); rm -f red.tmp
echo "== canjear two_for_one (60) con 25 disponibles (400)"; curl -s -X POST $U/api/rewards/two_for_one/redeem -H "Authorization: Bearer $MATEO"; echo
echo "== mis canjes (1, gastados 30)";    curl -s $U/api/rewards/redemptions -H "Authorization: Bearer $MATEO" | js '"gastados="+j.spentPoints+" canjes="+j.redeemed.length+" estado="+j.redeemed[0].status'
echo "== devolver canje activo (200, vuelve a 0 gastados)"
curl -s -X POST $U/api/redemptions/$RID/refund -H "Authorization: Bearer $ADMIN" | js '"estado="+j.status'
curl -s $U/api/rewards/redemptions -H "Authorization: Bearer $MATEO" | js '"gastados="+j.spentPoints'
echo "== canjear de nuevo 'popcorn' (201)"
curl -s -X POST $U/api/rewards/popcorn/redeem -H "Authorization: Bearer $MATEO" | js 'j.redemption.id' > rid2.tmp
RID2=$(cat rid2.tmp); rm -f rid2.tmp
echo "== usar canje como user (403)";     curl -s -X POST $U/api/redemptions/$RID2/use -H "Authorization: Bearer $MATEO"; echo
echo "== usar canje como admin (200)";    curl -s -X POST $U/api/redemptions/$RID2/use -H "Authorization: Bearer $ADMIN" | js 'j.status'
echo "== usar de nuevo (409)";            curl -s -X POST $U/api/redemptions/$RID2/use -H "Authorization: Bearer $ADMIN"; echo
echo "== devolver canje ya usado (409)";  curl -s -X POST $U/api/redemptions/$RID2/refund -H "Authorization: Bearer $ADMIN"; echo
echo "== gastados (solo el usado: 30)";   curl -s $U/api/rewards/redemptions -H "Authorization: Bearer $MATEO" | js 'j.spentPoints+" | "+j.redeemed.map(r=>r.status).join(",")'
