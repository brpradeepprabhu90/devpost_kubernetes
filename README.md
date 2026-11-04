# AI Agent Cluster — Decoupled AI Microkernel

A production-shaped AI agent runtime built as a **microkernel**: a thin HTTP
orchestrator that validates input, dispatches work to an **MCP (Model Context
Protocol) tool server** running in an isolated child process over stdio, then
verifies the result through an assertion gate before returning it.

Deterministic domain logic lives in the MCP server, never in the orchestrator —
so the pipeline has no hallucination surface and no out-of-bounds drift.

- **Orchestrator** — [src/index.ts](src/index.ts): Express API, Kubernetes health probe
- **Microkernel** — [src/microkernel.ts](src/microkernel.ts): 4-stage state machine, MCP client, token accounting
- **MCP server** — [src/mcp-server.ts](src/mcp-server.ts): `forecast_sensory_escalation`, `check_nutritional_variance`
- **Contracts** — [src/types.ts](src/types.ts): `AgentState` enum, Zod input schemas
- **Manifests** — [k8s/](k8s/): Deployment (3 replicas), ClusterIP Service, HPA (3→15 @ 70% CPU)

Pipeline stages: `HYDRATING_INPUT` → `QUERYING_MCP` → `EVALUATING_ASSERTIONS` →
`COMPLETED` (or `FAILED`, which surfaces as HTTP 400 with the error list).

---

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 22.x | `type: module` + `NodeNext` resolution |
| Docker | any recent | builds the image on the **host** daemon |
| minikube | v1.39.0 | `--driver=docker --container-runtime=containerd` |
| Kubernetes | v1.37.0 | provided by minikube |

`kubectl` is **not** installed standalone here — every command below uses
`minikube kubectl --`. Optional convenience:

```bash
alias kubectl='minikube kubectl --'
```

> **containerd, not dockerd.** `eval $(minikube docker-env)` does *not* work on
> this cluster — images built into that daemon are invisible to the kubelet
> (`ImagePullBackOff`). Use `minikube image load` instead.

---

## Install

```bash
git clone <repo-url> devfest2026
cd devfest2026
npm install
npm run build          # tsc -> dist/
```

### Run locally (no containers)

```bash
npm start              # node dist/index.js  -> http://localhost:8080
npm run dev            # tsx src/index.ts    (no build step)
```

The orchestrator spawns `dist/mcp-server.js` as a child process at boot, so
`npm run build` must have run at least once even when using `npm run dev`.

### Smoke-test

```bash
curl -s http://localhost:8080/healthz
# -> {"status":"UP"}

curl -s -X POST http://localhost:8080/api/v1/forecast \
  -H 'Content-Type: application/json' \
  -d '{"ambientNoiseDecibels":95,"lightingLux":1200,"timeSinceLastMealMinutes":300,"sugarIntakeGrams":60}'
# -> riskScore 100 / riskLevel "HIGH"
```

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness + readiness probe → `{"status":"UP"}` |
| `POST` | `/api/v1/forecast` | Run the full agent pipeline |

**Request body** (all fields required, all validated by Zod):

```json
{
  "ambientNoiseDecibels": 95,
  "lightingLux": 1200,
  "timeSinceLastMealMinutes": 300,
  "sugarIntakeGrams": 60
}
```

Bounds: noise `0–160`, lux `0–100000`, minutes `>= 0`, grams `>= 0`.
Anything outside them returns **400** with `currentState: "FAILED"`.

**Risk scoring** (deterministic, in the MCP server):

| Condition | Points |
|---|---|
| noise > 75 dB | +40 |
| noise > 60 dB | +20 |
| lux > 1000 or < 50 | +15 |
| since last meal > 180 min | +25 |
| sugar > 25 g | +20 |

`>= 60` → `HIGH`, `>= 35` → `MODERATE`, else `LOW`.

---

## Docker

```bash
# Build (multi-stage: builder compiles TS, runner ships dist/ as non-root)
docker build -t devfest/ai-microkernel:1.0.0 .

# Run standalone — host port 18080 avoids colliding with a local npm start
docker run --rm -p 18080:8080 --name mk-test devfest/ai-microkernel:1.0.0
curl -s http://localhost:18080/healthz

# Stop
docker stop mk-test
```

---

## Deploy to Kubernetes — the ADD path

### 0. Free port 8080 on the host

A local `npm start` holds `:8080` and collides with both `docker run -p 8080`
and the port-forward in step 5.

```bash
ss -ltnp | grep ':8080'                 # identify the holder (look for `node`)
pkill -f 'node dist/index.js'           # stop local dev server + its MCP child
ss -ltnp | grep ':8080' || echo "8080 is free"
```

### 1. Start a cluster

```bash
minikube start \
  --driver=docker \
  --container-runtime=containerd \
  --kubernetes-version=v1.37.0 \
  --cpus=4 \
  --memory=4096

minikube status                         # host/kubelet/apiserver => Running
minikube kubectl -- get nodes           # node => Ready
```

### 2. Enable metrics-server (REQUIRED for the HPA)

Without it the HPA reports `cpu: <unknown>/70%` and never scales.

```bash
minikube addons enable metrics-server
minikube kubectl -- wait --for=condition=ready pod \
  -l k8s-app=metrics-server -n kube-system --timeout=180s
```

### 3. Build and load the image

```bash
npm install
npm run build
docker build -t devfest/ai-microkernel:1.0.0 .

# Push it into minikube's containerd store — this is the step that matters
minikube image load devfest/ai-microkernel:1.0.0

# Verify the kubelet can see it
minikube image ls | grep microkernel
```

One-shot alternative that skips the load entirely:

```bash
minikube image build -t devfest/ai-microkernel:1.0.0 .
```

### 4. Apply the manifests

```bash
minikube kubectl -- apply -f k8s/deployment.yaml
minikube kubectl -- apply -f k8s/service.yaml
minikube kubectl -- apply -f k8s/hpa.yaml

minikube kubectl -- rollout status deployment/ai-microkernel-deployment --timeout=180s
```

### 5. Verify and access

```bash
minikube kubectl -- get pods -l app=ai-microkernel     # expect 3x 1/1 Running
minikube kubectl -- get svc ai-microkernel-service
minikube kubectl -- get hpa                            # expect cpu: 0%/70%
minikube kubectl -- top pods -l app=ai-microkernel
minikube kubectl -- logs -l app=ai-microkernel --tail=20

minikube kubectl -- port-forward svc/ai-microkernel-service 8080:80 &
# (use 18080:80 instead if anything still holds host :8080)

curl -s http://localhost:8080/healthz

curl -s -X POST http://localhost:8080/api/v1/forecast \
  -H 'Content-Type: application/json' \
  -d '{"ambientNoiseDecibels":70,"lightingLux":500,"timeSinceLastMealMinutes":120,"sugarIntakeGrams":20}'
# -> riskScore 20 / riskLevel "LOW"

# Validation-failure path (bad input -> 400 + FAILED state)
curl -s -X POST http://localhost:8080/api/v1/forecast \
  -H 'Content-Type: application/json' -d '{"ambientNoiseDecibels":"loud"}'

# Stop the forward when done
pkill -f 'port-forward svc/ai-microkernel-service'
```

### 6. Redeploy after a code change

```bash
npm run build
docker build -t devfest/ai-microkernel:1.0.0 .
minikube image load devfest/ai-microkernel:1.0.0
minikube kubectl -- rollout restart deployment/ai-microkernel-deployment
minikube kubectl -- rollout status deployment/ai-microkernel-deployment --timeout=180s
```

`rollout restart` is required: the tag is unchanged, so `imagePullPolicy:
IfNotPresent` means running pods would otherwise keep the old layers.

---

## Teardown — the DELETE path

### Soft: remove the app, keep the cluster

```bash
minikube kubectl -- delete -f k8s/hpa.yaml --ignore-not-found
minikube kubectl -- delete -f k8s/service.yaml --ignore-not-found
minikube kubectl -- delete -f k8s/deployment.yaml --ignore-not-found
```

Or by resource name:

```bash
minikube kubectl -- delete hpa ai-microkernel-hpa --ignore-not-found
minikube kubectl -- delete svc ai-microkernel-service --ignore-not-found
minikube kubectl -- delete deployment ai-microkernel-deployment --ignore-not-found
```

### Hard: destroy the cluster, all profiles, and `~/.minikube`

```bash
minikube delete --all --purge
```

### Verify nothing is left behind

```bash
minikube profile list                   # expect: no valid profiles
docker ps -a | grep minikube            # expect: no rows
```

### Reclaim host disk from old image layers

```bash
docker image rm devfest/ai-microkernel:1.0.0 2>/dev/null
docker system prune -f
```

### Clean local build output

```bash
rm -rf dist node_modules
```

---

## Troubleshooting

**`ImagePullBackOff`**
The image is not in minikube's containerd store. Re-run
`minikube image load devfest/ai-microkernel:1.0.0`. Do **not** rely on
`eval $(minikube docker-env)` — it does not work with containerd.

**`CreateContainerConfigError` — "container has runAsNonRoot and image has non-numeric user (node)"**
The Dockerfile sets `USER node` (a name) and the kubelet cannot verify a name
against `runAsNonRoot`. Fixed by `runAsUser: 1000` / `runAsGroup: 1000` in
[k8s/deployment.yaml](k8s/deployment.yaml). Keep them in sync if the
Dockerfile's `USER` changes.

**`docker: bind: address already in use`**
Host `:8080` is taken, usually by a local `npm start`. See step 0 above.

**HPA shows `cpu: <unknown>/70%`**
metrics-server is disabled or still warming up. See step 2 — the first scrape
takes roughly 45s after the pod goes Ready.

**Useful digging commands**

```bash
minikube kubectl -- describe pod -l app=ai-microkernel
minikube kubectl -- get events --sort-by=.lastTimestamp | tail -20
minikube ssh -- "sudo crictl images | grep microkernel"
```

---

## Project layout

```
.
├── Dockerfile            # multi-stage build, non-root runner, EXPOSE 8080
├── k8s/
│   ├── deployment.yaml   # 3 replicas, probes, resource limits, securityContext
│   ├── service.yaml      # ClusterIP 80 -> 8080
│   └── hpa.yaml          # 3–15 replicas @ 70% CPU
├── src/
│   ├── index.ts          # Express orchestrator + /healthz
│   ├── microkernel.ts    # state machine + MCP stdio client
│   ├── mcp-server.ts     # MCP tool server (deterministic scoring)
│   └── types.ts          # AgentState, Zod schemas
├── cmds.txt              # the raw runbook this README is based on
└── tsconfig.json         # ES2022 / NodeNext, strict
```

## npm scripts

| Script | Command |
|---|---|
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/index.js` |
| `npm run start:mcp` | `node dist/mcp-server.js` (MCP server alone, over stdio) |
| `npm run dev` | `tsx src/index.ts` |
