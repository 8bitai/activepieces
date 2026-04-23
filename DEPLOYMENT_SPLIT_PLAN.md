# Activepieces Deployment Split Plan

## Part 1: Current Concurrency & Rate Limiting Analysis

### Current Architecture (Single Instance)
Everything runs in **one container**: Nginx (frontend static files + reverse proxy) + Node.js (API server + worker + engine). All share the same CPU/memory pool.

### Rate Limiting in Place

| Layer | Setting | Default | Notes |
|-------|---------|---------|-------|
| API Auth Rate Limit | `AP_API_RATE_LIMIT_AUTHN_ENABLED` | `true` | Per-IP throttling |
| Auth Max Requests | `AP_API_RATE_LIMIT_AUTHN_MAX` | `50` per window | Per IP address |
| Auth Window | `AP_API_RATE_LIMIT_AUTHN_WINDOW` | `1 minute` | Rolling window |
| Project Rate Limiter | `AP_PROJECT_RATE_LIMITER_ENABLED` | `false` (disabled!) | Per-project job limiting |
| Max Concurrent Jobs/Project | `AP_MAX_CONCURRENT_JOBS_PER_PROJECT` | `100` | Only if project limiter enabled |
| Nginx Max Body Size | `client_max_body_size` | `100MB` | File upload limit |

### Worker Concurrency Settings

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `AP_WORKER_CONCURRENCY` | `5` | BullMQ concurrent job processing |
| `AP_FLOW_WORKER_CONCURRENCY` | (inherits from above) | Flow-specific concurrency |
| `AP_SCHEDULED_WORKER_CONCURRENCY` | (inherits from above) | Scheduled trigger concurrency |
| `AP_RUNS_METADATA_UPDATE_CONCURRENCY` | `10` | Metadata DB update concurrency |
| BullMQ stalled interval | `30s` | Detects stuck jobs |
| BullMQ max stalled count | `5` | Retries for stalled jobs |
| BullMQ retry attempts | `5` | With exponential backoff (8min base) |

### Timeouts

| Setting | Default |
|---------|---------|
| `AP_FLOW_TIMEOUT_SECONDS` | `600` (10 min) |
| `AP_WEBHOOK_TIMEOUT_SECONDS` | `30` |
| `AP_TRIGGER_TIMEOUT_SECONDS` | `60` |
| Nginx proxy read/send timeout | `900s` (15 min) |

### Connection Pools

| Resource | Setting | Default |
|----------|---------|---------|
| PostgreSQL pool size | `AP_POSTGRES_POOL_SIZE` | Dynamic (TypeORM default ~10) |
| PostgreSQL idle timeout | `AP_POSTGRES_IDLE_TIMEOUT_MS` | `300000` (5 min) |
| Redis | Single connection per client | Shared across BullMQ + Socket.IO + cache |
| Sandbox memory | `AP_SANDBOX_MEMORY_LIMIT` | `1048576` KB (1 GB) |

### Estimated Max Concurrency (Single Instance)

**The bottleneck is flow execution, not API requests.**

With default `AP_WORKER_CONCURRENCY=5`:
- **5 flows executing simultaneously** per instance
- Each flow can run up to 10 minutes (600s timeout)
- At steady state: ~5 concurrent flow executions
- Throughput: if average flow takes 5s, that's ~60 flows/min = 1 flow/sec
- If average flow takes 1s, that's ~300 flows/min = 5 flows/sec

**API layer** (Fastify on Node.js single-thread):
- Can handle ~1000-3000 req/sec for simple CRUD operations
- Webhook ingestion is limited by worker queue drain rate
- Auth endpoints: 50 req/min per IP (rate limited)

**Reference benchmark from docs**: 95 flow executions/sec on 16GB RAM, 8-core machine with concurrency 25.

### How to Measure Your Actual Capacity

Since I can't access your running infrastructure, here are the steps:

1. **Check current resource usage**:
   ```bash
   # On your K8s cluster
   kubectl top pods -n <namespace>
   kubectl describe pod <activepieces-pod> -n <namespace>
   ```

2. **Check current worker concurrency**:
   ```bash
   kubectl exec -it <pod> -n <namespace> -- env | grep -i concurrency
   kubectl exec -it <pod> -n <namespace> -- env | grep -i worker
   ```

3. **Enable BullMQ Board for queue monitoring**:
   ```
   AP_QUEUE_UI_ENABLED=true
   AP_QUEUE_UI_USERNAME=admin
   AP_QUEUE_UI_PASSWORD=<password>
   ```
   Then visit `https://<your-domain>/api/v1/worker/queue/ui` to see:
   - Queue depth (waiting jobs)
   - Active jobs count
   - Completed/Failed rates
   - Job processing time

4. **Load test with k6 or Apache Bench**:
   ```bash
   # Test webhook throughput
   ab -n 1000 -c 25 -T 'application/json' -p webhook_payload.json \
     https://<your-domain>/api/v1/webhooks/<flow-id>

   # Test API throughput
   ab -n 5000 -c 50 -H "Authorization: Bearer <token>" \
     https://<your-domain>/api/v1/flows
   ```

5. **Monitor during load test**:
   ```bash
   kubectl top pods -n <namespace> --containers
   # Watch for CPU/memory spikes
   ```

---

## Part 2: Deployment Split Options

### The Key Insight

Activepieces **already supports** splitting via the `AP_CONTAINER_TYPE` environment variable:
- `APP` = API server only (handles HTTP, WebSocket, webhooks, database)
- `WORKER` = Worker only (processes flow executions from BullMQ queue)
- Default (unset) = Both APP + WORKER in one process

Both connect to the **same PostgreSQL and Redis** instances.

---

### Option A: Two Deployments (Recommended)

**Deployment 1: Frontend + API Server ("app")**
- Nginx serving React static files
- Fastify API server (`AP_CONTAINER_TYPE=APP`)
- Handles: HTTP API, WebSocket/Socket.IO, webhook ingestion, database queries
- Lightweight - mostly I/O bound (DB queries, Redis enqueue)

**Deployment 2: Worker ("worker")**
- Node.js worker process (`AP_CONTAINER_TYPE=WORKER`)
- Handles: Flow execution, sandbox management, piece loading
- CPU/memory heavy - this is what eats your resources

```
                    ┌──────────────┐
                    │   Ingress    │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │  Deployment 1: APP      │
              │  ┌─────────────────┐    │
              │  │ Nginx (frontend)│    │
              │  │ Fastify (API)   │    │  ← Scale for API traffic
              │  └─────────────────┘    │
              └────────┬───────┬────────┘
                       │       │
                 ┌─────▼──┐ ┌──▼─────┐
                 │Postgres│ │ Redis  │
                 └─────┬──┘ └──┬─────┘
                       │       │
              ┌────────▼───────▼────────┐
              │  Deployment 2: WORKER   │
              │  ┌─────────────────┐    │
              │  │ Flow Executor   │    │
              │  │ Sandbox Pool    │    │  ← Scale for flow execution
              │  │ Piece Runtime   │    │
              │  └─────────────────┘    │
              └─────────────────────────┘
```

**Pros:**
- Simplest split - uses built-in `AP_CONTAINER_TYPE` support
- Workers can scale independently (HPA on CPU)
- API stays responsive even under heavy flow execution load
- Worker crash doesn't take down the UI/API
- No code changes needed

**Cons:**
- Frontend is still bundled with API (minor, Nginx is very lightweight)

---

### Option B: Three Deployments

**Deployment 1: Frontend (Nginx only)**
- Just static React files served by Nginx
- Proxy `/api/*` and `/socket.io` to the API service

**Deployment 2: API Server**
- Fastify backend only (`AP_CONTAINER_TYPE=APP`)
- No Nginx, no static files
- Exposed on port 3000

**Deployment 3: Worker**
- Same as Option A worker

```
              ┌──────────────┐
              │   Ingress    │
              └──┬────────┬──┘
                 │        │
     ┌───────────▼──┐  ┌──▼──────────────┐
     │ Dep 1: Nginx │  │ Dep 2: API      │
     │ (static SPA) │──│ (Fastify :3000) │
     └──────────────┘  └───────┬──────────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
               ┌────▼──┐  ┌───▼───┐  ┌───▼──────────┐
               │  PG   │  │ Redis │  │ Dep 3: Worker│
               └───────┘  └───────┘  └──────────────┘
```

**Pros:**
- Maximum isolation
- Frontend can be served from CDN/edge
- Each component scales independently

**Cons:**
- Requires a **custom Dockerfile** for the API-only image (strip Nginx)
- Requires a **separate Nginx image** with custom config to proxy to API service
- More operational complexity for marginal gain
- Activepieces doesn't officially provide separate images

---

### Option C: Two Deployments with PM2 Cluster Mode for API

Same as Option A, but the API deployment uses PM2 cluster mode to utilize multiple CPU cores:

```
AP_CONTAINER_TYPE=APP
AP_PM2_ENABLED=true
```

PM2 with `-i 0` spawns one Node.js process per CPU core. This multiplies API throughput on multi-core pods.

**Pros:** Everything from Option A + better API CPU utilization
**Cons:** Higher memory usage (each PM2 worker is a separate Node.js process ~200-400MB)

---

## Part 3: Recommendation - Go With Option A

Option A is the clear winner for your use case:

1. **Zero code changes** - just environment variables
2. **Built-in support** - `AP_CONTAINER_TYPE` is a first-class feature
3. **Biggest impact** - separating workers from API is where 90% of the resource contention is
4. **Simple to operate** - two deployments, one Helm chart with overrides

---

## Part 4: Implementation Plan for Option A (Kubernetes)

### Step 1: Create Two values files

**`values-app.yaml`** (API + Frontend):
```yaml
replicaCount: 2   # Start with 2 for HA

image:
  repository: ghcr.io/activepieces/activepieces
  tag: "0.77.6"

container:
  port: 80

resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 2000m
    memory: 2Gi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70

# Override: This instance is APP only
activepieces:
  frontendUrl: "https://your-domain.com"
  edition: "ce"
  executionMode: "SANDBOX_CODE_ONLY"
  environment: "prod"
  # Rate limiting - ENABLE THESE for public traffic
  apiRateLimiting:
    authn:
      enabled: true
      max: 50
      window: 60
  projectRateLimiter:
    enabled: true

# Add this env var to deployment
# You'll need to add AP_CONTAINER_TYPE=APP to the Helm template
# (see Step 2 below)
```

**`values-worker.yaml`** (Worker only):
```yaml
replicaCount: 2   # Start with 2 workers

image:
  repository: ghcr.io/activepieces/activepieces
  tag: "0.77.6"

container:
  port: 80   # Still needed for health check

resources:
  requests:
    cpu: 1000m
    memory: 2Gi
  limits:
    cpu: 4000m
    memory: 4Gi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

# Workers need more resources and higher concurrency
activepieces:
  frontendUrl: "https://your-domain.com"
  edition: "ce"
  executionMode: "SANDBOX_CODE_ONLY"
  environment: "prod"
  flowWorkerConcurrency: "10"
  scheduledWorkerConcurrency: "5"

# No ingress needed for workers
ingress:
  enabled: false

# Add AP_CONTAINER_TYPE=WORKER
```

### Step 2: Add AP_CONTAINER_TYPE to Helm Template

Add this to `deploy/activepieces-helm/values.yaml`:
```yaml
activepieces:
  containerType: ""   # APP, WORKER, or empty (both)
```

Add this to `deploy/activepieces-helm/templates/deployment.yaml` in the env section:
```yaml
{{- if .Values.activepieces.containerType }}
- name: AP_CONTAINER_TYPE
  value: {{ .Values.activepieces.containerType | quote }}
{{- end }}
```

### Step 3: Deploy Two Releases

```bash
# Deploy APP instance (handles API + frontend)
helm upgrade --install activepieces-app ./deploy/activepieces-helm \
  -f values-app.yaml \
  --set activepieces.containerType=APP \
  -n activepieces

# Deploy WORKER instance (handles flow execution)
helm upgrade --install activepieces-worker ./deploy/activepieces-helm \
  -f values-worker.yaml \
  --set activepieces.containerType=WORKER \
  --set ingress.enabled=false \
  --set service.type=ClusterIP \
  -n activepieces
```

### Step 4: Ingress Configuration

Point your Ingress **only** at the APP service:
```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "900"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "900"
  hosts:
    - host: your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: activepieces-tls
      hosts:
        - your-domain.com
```

Workers don't need an Ingress - they only communicate via Redis (BullMQ) and PostgreSQL.

### Step 5: Shared Infrastructure

Both deployments must point to the **same** PostgreSQL and Redis:
- If using Helm subcharts, only deploy PG/Redis once (from the app release)
- Worker release should use `postgresql.enabled: false` and `redis.enabled: false` with explicit host/password pointing to the same instances

---

## Part 5: Scaling Guidelines

### API (APP) Scaling
- Scale based on **HTTP request rate** and **response latency**
- HPA on CPU (70%) is a good starting point
- 2 replicas minimum for HA
- Each replica handles ~1000-3000 req/sec (simple API calls)
- Memory: ~1-2 GB per pod is usually sufficient

### Worker Scaling
- Scale based on **queue depth** and **CPU usage**
- HPA on CPU (70%) works well
- Consider custom metrics HPA on BullMQ queue size (requires prometheus adapter)
- Each replica with `WORKER_CONCURRENCY=10` handles 10 concurrent flow executions
- Memory: 2-4 GB per pod (depends on flow complexity and sandbox mode)
- **This is where you'll see the biggest benefit** - more workers = more flow throughput

### Concurrency Tuning
Start with these and adjust based on monitoring:

| Setting | APP value | WORKER value | Notes |
|---------|-----------|--------------|-------|
| `AP_FLOW_WORKER_CONCURRENCY` | N/A | `10` | Increase if CPU is underutilized |
| `AP_SCHEDULED_WORKER_CONCURRENCY` | N/A | `5` | Increase for many scheduled flows |
| `AP_WORKER_CONCURRENCY` | N/A | `10` | Total concurrency cap |
| `AP_API_RATE_LIMIT_AUTHN_MAX` | `50` | N/A | Per-IP auth limit |
| `AP_PROJECT_RATE_LIMITER_ENABLED` | `true` | `true` | Enable to prevent one project hogging all workers |
| `AP_MAX_CONCURRENT_JOBS_PER_PROJECT` | `20` | `20` | Fairness across projects |

### Expected Capacity After Split (2 worker pods, concurrency 10 each)
- **Flow execution**: ~20 concurrent flows (vs 5 before) = **4x improvement**
- **API**: Completely independent, won't be starved by flow execution
- **Webhook ingestion**: Can accept webhooks at full speed, queued in Redis
- With autoscaling to 10 worker pods: ~100 concurrent flows

---

## Part 6: Quick Wins Before Splitting

These can be done immediately on your current single-instance:

1. **Enable project rate limiter** (currently disabled!):
   ```
   AP_PROJECT_RATE_LIMITER_ENABLED=true
   AP_MAX_CONCURRENT_JOBS_PER_PROJECT=20
   ```
   This prevents one project from monopolizing all workers.

2. **Increase worker concurrency** if you have spare CPU/memory:
   ```
   AP_WORKER_CONCURRENCY=10
   ```

3. **Enable API rate limiting** (you have it disabled in Helm values):
   ```
   AP_API_RATE_LIMIT_AUTHN_ENABLED=true
   AP_API_RATE_LIMIT_AUTHN_MAX=50
   ```

4. **Enable BullMQ Board** to see queue health:
   ```
   AP_QUEUE_UI_ENABLED=true
   AP_QUEUE_UI_USERNAME=admin
   AP_QUEUE_UI_PASSWORD=<secure-password>
   ```
