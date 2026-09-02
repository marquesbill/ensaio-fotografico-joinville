#!/usr/bin/env bash
# Publica apps-script/agendamentos.gs no Apps Script via clasp.
#
# clasp casa arquivo remoto por NOME; o projeto remoto chama o arquivo "Code" —
# por isso o staging copia para Code.gs em vez de empurrar agendamentos.gs
# direto, o que criaria um SEGUNDO arquivo com funções duplicadas no mesmo
# projeto (Apps Script compartilha um namespace global entre todos os .gs).
#
# push só atualiza o conteúdo "salvo" do projeto (o que você vê no editor).
# Para o SCRIPT_URL em produção mudar de verdade, precisa de uma versão nova
# + apontar o deployment pra ela — os dois passos abaixo, sempre nessa ordem.
set -euo pipefail
SCRIPT_ID="1CfNosMdFMB7axBKsWCE4ii7KB_Yt4wn9E2ae5WhPcuy0Tj40DKevmFaB"
DEPLOYMENT_ID="AKfycby4RQxi6a4DTR1ml-LlJkK5D4GOCPug5SIB-GmRrCa0uu2U3Dgtrj4vzgm_Owzz285eGQ"  # o mesmo id do SCRIPT_URL
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESC="${1:?uso: deploy-gs.sh \"descrição da mudança\"}"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp "$REPO/apps-script/agendamentos.gs" "$STAGE/Code.gs"
cp "$REPO/apps-script/appsscript.json" "$STAGE/appsscript.json"
cat > "$STAGE/.clasp.json" <<EOF
{"scriptId":"$SCRIPT_ID","rootDir":"."}
EOF

cd "$STAGE"
clasp push
V=$(clasp version "$DESC" | grep -oE '[0-9]+' | tail -1)
echo "versão criada: $V"
clasp deploy -i "$DEPLOYMENT_ID" -V "$V" -d "$DESC"
echo "publicado como versão $V em $DEPLOYMENT_ID"
echo "https://script.google.com/home/projects/$SCRIPT_ID/edit"
