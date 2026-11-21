#!/usr/bin/env bash
# One-shot (idempotent) GCP deployment of SentinelDesk.
#
#   export GCP_PROJECT=my-project            # required
#   export GCP_REGION=us-central1            # optional
#   ./infra/deploy.sh all                    # setup + upload data + build + deploy everything
#   ./infra/deploy.sh setup|data|build|deploy|web|pubsub|urls
#
# Topology:
#   web (public) -> gateway (public) --Pub/Sub topic `tickets`--> orchestrator (private, push w/ OIDC)
#   orchestrator -> ml (private), rag (private, Vertex AI)  ; all state in Firestore ; artifacts in GCS
set -euo pipefail

: "${GCP_PROJECT:?set GCP_PROJECT}"
REGION="${GCP_REGION:-us-central1}"
REPO=sentinel
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
BUCKET="${BUCKET:-${GCP_PROJECT}-sentinel-artifacts}"
RUN_SA="sentinel-run@${GCP_PROJECT}.iam.gserviceaccount.com"
PUSH_SA="sentinel-push@${GCP_PROJECT}.iam.gserviceaccount.com"
IMG="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO}"
INTERNAL_TOKEN="${INTERNAL_TOKEN:-$(openssl rand -hex 16)}"

gc() { gcloud --project "$GCP_PROJECT" "$@"; }
url() { gc run services describe "$1" --region "$REGION" --format='value(status.url)'; }

setup() {
  gc services enable run.googleapis.com pubsub.googleapis.com firestore.googleapis.com \
    artifactregistry.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com \
    storage.googleapis.com iam.googleapis.com secretmanager.googleapis.com
  gc artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 || \
    gc artifacts repositories create "$REPO" --repository-format=docker --location "$REGION"
  gc firestore databases describe --database='(default)' >/dev/null 2>&1 || \
    gc firestore databases create --location="$REGION" --type=firestore-native
  gcloud storage buckets describe "gs://$BUCKET" --project "$GCP_PROJECT" >/dev/null 2>&1 || \
    gcloud storage buckets create "gs://$BUCKET" --project "$GCP_PROJECT" --location "$REGION" --uniform-bucket-level-access
  for sa in sentinel-run sentinel-push; do
    gc iam service-accounts describe "${sa}@${GCP_PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1 || \
      gc iam service-accounts create "$sa" --display-name "SentinelDesk $sa"
  done
  for role in roles/datastore.user roles/pubsub.publisher roles/aiplatform.user roles/storage.objectAdmin roles/run.invoker roles/logging.logWriter; do
    gc projects add-iam-policy-binding "$GCP_PROJECT" --member "serviceAccount:$RUN_SA" --role "$role" --condition=None >/dev/null
  done
  gc projects add-iam-policy-binding "$GCP_PROJECT" --member "serviceAccount:$PUSH_SA" --role roles/run.invoker --condition=None >/dev/null
  echo "setup done"
}

data() {
  [[ -f data/kb_train.csv ]] || { echo "data/kb_train.csv missing: git pull (CSVs are committed) or python -m src.data_split"; exit 1; }
  gcloud storage cp data/kb_train.csv data/test_inputs.csv "gs://$BUCKET/data/"
  [[ -f research/ml/artifacts/model.joblib ]] && gcloud storage cp research/ml/artifacts/model.joblib "gs://$BUCKET/models/model.joblib" || true
  [[ -d research/rag/index ]] && gcloud storage cp -r research/rag/index "gs://$BUCKET/" || true
  echo "artifacts uploaded to gs://$BUCKET"
}

build() {
  gc builds submit --config infra/cloudbuild.services.yaml --substitutions="_REGION=$REGION,_REPO=$REPO,_TAG=$TAG" .
}

deploy_svc() { # name, public(yes/no), extra args...
  local name=$1 public=$2; shift 2
  local auth="--no-allow-unauthenticated"; [[ $public == yes ]] && auth="--allow-unauthenticated"
  gc run deploy "$name" --image "$IMG/$name:$TAG" --region "$REGION" --service-account "$RUN_SA" \
    $auth --min-instances 1 --port 8080 "$@" --quiet
}

deploy() {
  local common="GCP_PROJECT=$GCP_PROJECT,GCP_REGION=$REGION,USE_ID_TOKEN=1"
  local model_uri="research/ml/artifacts/model.joblib"
  gcloud storage ls "gs://$BUCKET/models/model.joblib" >/dev/null 2>&1 && model_uri="gs://$BUCKET/models/model.joblib"
  deploy_svc ml no  --cpu 2 --memory 4Gi --concurrency 20 --set-env-vars "$common,MODEL_URI=$model_uri"
  deploy_svc rag no --cpu 2 --memory 8Gi --concurrency 20 --timeout 120 \
    --set-env-vars "$common,KB_URI=gs://$BUCKET/data/kb_train.csv,INDEX_URI=gs://$BUCKET/index/,GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}"
  local ML RAG; ML=$(url ml); RAG=$(url rag)
  deploy_svc orchestrator no --cpu 1 --memory 1Gi --timeout 300 \
    --set-env-vars "$common,STORE=firestore,ML_URL=$ML,RAG_URL=$RAG"
  local ORCH; ORCH=$(url orchestrator)
  deploy_svc gateway yes --cpu 1 --memory 1Gi --timeout 3600 --concurrency 200 \
    --set-env-vars "$common,STORE=firestore,BUS=pubsub,PUBSUB_TOPIC=tickets,ORCHESTRATOR_URL=$ORCH,ML_URL=$ML,RAG_URL=$RAG,EVAL_REPORT_URI=gs://$BUCKET/eval/latest.json,SIM_TICKETS_URI=gs://$BUCKET/data/test_inputs.csv,INTERNAL_TOKEN=$INTERNAL_TOKEN"
  pubsub
}

pubsub() {
  local ORCH; ORCH=$(url orchestrator)
  local PN; PN=$(gc projects describe "$GCP_PROJECT" --format='value(projectNumber)')
  local PUBSUB_AGENT="service-${PN}@gcp-sa-pubsub.iam.gserviceaccount.com"
  gc pubsub topics describe tickets >/dev/null 2>&1 || gc pubsub topics create tickets
  gc pubsub topics describe tickets-dlq >/dev/null 2>&1 || gc pubsub topics create tickets-dlq
  gc pubsub subscriptions describe tickets-dlq-sub >/dev/null 2>&1 || gc pubsub subscriptions create tickets-dlq-sub --topic tickets-dlq
  # Pub/Sub agent must mint OIDC tokens for the push SA and handle dead-lettering.
  gc iam service-accounts add-iam-policy-binding "$PUSH_SA" --member "serviceAccount:$PUBSUB_AGENT" \
    --role roles/iam.serviceAccountTokenCreator >/dev/null
  gc pubsub topics add-iam-policy-binding tickets-dlq --member "serviceAccount:$PUBSUB_AGENT" --role roles/pubsub.publisher >/dev/null
  if gc pubsub subscriptions describe tickets-orchestrator >/dev/null 2>&1; then
    gc pubsub subscriptions update tickets-orchestrator --push-endpoint "$ORCH/pubsub/push" \
      --push-auth-service-account "$PUSH_SA" --push-auth-token-audience "$ORCH"
  else
    gc pubsub subscriptions create tickets-orchestrator --topic tickets \
      --push-endpoint "$ORCH/pubsub/push" --push-auth-service-account "$PUSH_SA" --push-auth-token-audience "$ORCH" \
      --ack-deadline 120 --dead-letter-topic tickets-dlq --max-delivery-attempts 5 \
      --min-retry-delay 2s --max-retry-delay 30s
  fi
  gc pubsub subscriptions add-iam-policy-binding tickets-orchestrator --member "serviceAccount:$PUBSUB_AGENT" --role roles/pubsub.subscriber >/dev/null
  echo "pubsub wired -> $ORCH/pubsub/push"
}

web() {
  local GW; GW=$(url gateway)
  gc builds submit web --config infra/cloudbuild.web.yaml --substitutions="_REGION=$REGION,_REPO=$REPO,_TAG=$TAG,_API_URL=$GW"
  gc run deploy web --image "$IMG/web:$TAG" --region "$REGION" --allow-unauthenticated --min-instances 1 --port 8080 --quiet
}

urls() { for s in web gateway orchestrator ml rag; do printf "%-13s %s\n" "$s" "$(url $s 2>/dev/null || echo '-')"; done; }

case "${1:-all}" in
  setup) setup ;; data) data ;; build) build ;; deploy) deploy ;; pubsub) pubsub ;; web) web ;; urls) urls ;;
  all) setup; data; build; deploy; web; urls ;;
  *) echo "usage: $0 [all|setup|data|build|deploy|pubsub|web|urls]"; exit 1 ;;
esac
