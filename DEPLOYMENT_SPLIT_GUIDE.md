# Activepieces: Split Deployment Guide (Frontend + Backend)

## CRITICAL: Known Issues That Can Break Deployment

> **READ THIS FIRST before deploying.**

### 1. AP_FRONTEND_URL MUST be the public URL (webhooks depend on it)
The backend uses `AP_FRONTEND_URL` to generate webhook callback URLs that external
services (Google, Slack, etc.) use to send data back. The generated URL is:
```
{AP_FRONTEND_URL}/api/v1/webhooks/{flowId}
```
If this is wrong (localhost, internal IP, etc.), external webhooks will silently fail.
**This was already correctly set to https://activepieces-dev.8bit.ai in the previous deployment.**
Just make sure it stays correct in the new ConfigMap.

### 2. DO NOT set AP_CONTAINER_TYPE
The default is `WORKER_AND_APP` which is correct. The backend pod runs both the API
server and the worker (which executes flows). If you set this to `APP` only, the worker
won't start and NO flows will execute.

### 3. DO NOT separate Worker from Backend
The engine runs as a child process of the worker. The worker communicates with the API
via hardcoded `http://127.0.0.1:3000`. They MUST be in the same pod.

### 4. Socket.io WebSocket proxy is required
The frontend uses Socket.io for real-time updates (flow run status, test results).
The Nginx config must proxy `/socket.io` to the backend with WebSocket upgrade headers.
This is already handled in `nginx.k8s.conf`.

---

## Overview

We are splitting the single Activepieces container into two separate pods:
- **Frontend pod**: Nginx serving static React files + reverse proxy to backend
- **Backend pod**: Node.js API server + flow execution engine

This gives us independent scaling, smaller images, and clearer resource allocation.

---

## Architecture

```
                        ┌─────────────────────────────┐
                        │       Envoy / Gateway        │
                        │   activepieces-dev.8bit.ai   │
                        └─────────────┬───────────────┘
                                      │
                              all requests go to
                                      │
                                      ▼
                        ┌─────────────────────────────┐
                        │     Frontend Pod (Nginx)     │
                        │         Port 80              │
                        │                              │
                        │  /            → React SPA    │
                        │  /api/*       → proxy ──────────────┐
                        │  /socket.io/* → proxy ──────────────┤
                        └─────────────────────────────┘       │
                                                              │
                                                              ▼
                                                ┌─────────────────────────┐
                                                │    Backend Pod (Node)   │
                                                │       Port 3000         │
                                                │                         │
                                                │  ├── API logic          │
                                                │  ├── Engine (subprocess)│
                                                │  ├── → PostgreSQL       │
                                                │  └── → Redis            │
                                                └─────────────────────────┘
```

**Key point**: The Gateway/Envoy HTTPRoute does NOT change. All traffic still goes to one
place (frontend). The frontend's Nginx handles the internal routing to backend.

---

## Step 1: Build Pipeline Changes

The NX build step (#18 in current pipeline) stays exactly the same:

```bash
npx nx run-many --target=build --projects=react-ui,server-api --configuration production --parallel=2
```

This produces:
- `dist/packages/react-ui/`  → goes into frontend image
- `dist/packages/server/`    → goes into backend image
- `dist/packages/engine/`    → goes into backend image
- `dist/packages/shared/`    → goes into backend image

After the NX build, build TWO Docker images instead of one:

```bash
# Frontend image (small ~50MB - just Nginx + static files)
docker build -f Dockerfile.frontend -t harbor.8bit.ai/activepieces/activepieces-frontend:${VERSION} .

# Backend image (large ~800MB - Node.js + all dependencies)
docker build -f Dockerfile.backend -t harbor.8bit.ai/activepieces/activepieces-backend:${VERSION} .
```

**Note**: The `bun install --production` step for backend dependencies (step #19 in current
pipeline) should run BEFORE `docker build -f Dockerfile.backend`, same as today. The
`dist/packages/server/api/` folder needs its `node_modules` populated.

---

## Step 2: Push to Harbor

Push both images:

```bash
docker push harbor.8bit.ai/activepieces/activepieces-frontend:${VERSION}
docker push harbor.8bit.ai/activepieces/activepieces-backend:${VERSION}
```

---

## Step 3: Kubernetes Deployments

### 3a. Frontend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: activepieces-frontend-deployment
  namespace: activepieces
spec:
  replicas: 2
  selector:
    matchLabels:
      app: activepieces-frontend
  template:
    metadata:
      labels:
        app: activepieces-frontend
    spec:
      imagePullSecrets:
        - name: harbor-registry-secret
      containers:
        - name: activepieces-frontend
          image: harbor.8bit.ai/activepieces/activepieces-frontend:${VERSION}
          ports:
            - containerPort: 80
          env:
            - name: AP_BACKEND_HOST
              value: "activepieces-backend-service"
            - name: AP_BACKEND_PORT
              value: "3000"
            - name: AP_APP_TITLE
              value: "Activepieces"
            - name: AP_FAVICON_URL
              value: "https://cdn.activepieces.com/brand/favicon.ico"
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 5
```

### 3b. Frontend Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: activepieces-frontend-service
  namespace: activepieces
spec:
  type: ClusterIP
  selector:
    app: activepieces-frontend
  ports:
    - port: 80
      targetPort: 80
      name: http
```

### 3c. Backend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: activepieces-backend-deployment
  namespace: activepieces
spec:
  replicas: 2
  selector:
    matchLabels:
      app: activepieces-backend
  template:
    metadata:
      labels:
        app: activepieces-backend
    spec:
      hostAliases:
        # ... (same hostAliases as current deployment.yaml)
      imagePullSecrets:
        - name: harbor-registry-secret
      containers:
        - name: activepieces-backend
          image: harbor.8bit.ai/activepieces/activepieces-backend:${VERSION}
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: activepieces-configmap
            - secretRef:
                name: activepieces-secret
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 4Gi
          livenessProbe:
            httpGet:
              path: /v1/health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /v1/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
```

### 3d. Backend Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: activepieces-backend-service
  namespace: activepieces
spec:
  type: ClusterIP
  selector:
    app: activepieces-backend
  ports:
    - port: 3000
      targetPort: 3000
      name: http
```

---

## Step 4: HTTPRoute (Gateway)

The HTTPRoute does NOT need to change. All traffic still goes to one service.
Just update it to point to the frontend service instead of the old combined service:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: activepieces-httproute
  namespace: activepieces
spec:
  parentRefs:
    - name: eg
      namespace: harbor
      sectionName: https
  hostnames:
    - "activepieces-dev.8bit.ai"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: activepieces-frontend-service
          namespace: activepieces
          port: 80
```

---

## Step 5: Environment Variables

### Frontend pod needs ONLY these (passed as env vars):

| Variable          | Value                              | Purpose                              |
|-------------------|------------------------------------|--------------------------------------|
| AP_BACKEND_HOST   | activepieces-backend-service       | K8s service name of backend pod      |
| AP_BACKEND_PORT   | 3000                               | Backend port                         |
| AP_APP_TITLE      | Activepieces                       | Browser tab title                    |
| AP_FAVICON_URL    | https://cdn.activepieces.com/...   | Browser tab icon                     |

### Backend pod needs ALL existing env vars (from activepieces-configmap):

These are the same env vars currently in your `activepieces-configmap`. No changes needed.
The backend reads them from the process environment at startup.

| Variable                        | Example Value                | Required |
|---------------------------------|------------------------------|----------|
| AP_ENVIRONMENT                  | prod                         | Yes      |
| AP_EDITION                      | ce                           | Yes      |
| AP_DB_TYPE                      | POSTGRES                     | Yes      |
| AP_POSTGRES_HOST                | (your postgres host)         | Yes      |
| AP_POSTGRES_PORT                | 5432                         | Yes      |
| AP_POSTGRES_DATABASE            | activepieces                 | Yes      |
| AP_POSTGRES_USERNAME            | (your db user)               | Yes      |
| AP_POSTGRES_PASSWORD            | (your db password)           | Yes      |
| AP_QUEUE_MODE                   | REDIS                        | Yes      |
| AP_REDIS_HOST                   | (your redis host)            | Yes      |
| AP_REDIS_PORT                   | 6379                         | Yes      |
| AP_REDIS_TYPE                   | STANDALONE                   | Yes      |
| AP_ENCRYPTION_KEY               | (256-bit hex key)            | Yes      |
| AP_JWT_SECRET                   | (256-bit hex key)            | Yes      |
| AP_FRONTEND_URL                 | https://activepieces-dev.8bit.ai | Yes  |
| AP_EXECUTION_MODE               | UNSANDBOXED                  | Yes      |
| AP_PIECES_SOURCE                | CLOUD_AND_DB                 | Yes      |
| AP_PIECES_SYNC_MODE             | OFFICIAL_AUTO                | Yes      |
| AP_TELEMETRY_ENABLED            | false                        | No       |
| AP_WEBHOOK_TIMEOUT_SECONDS      | 30                           | No       |
| AP_FLOW_TIMEOUT_SECONDS         | 600                          | No       |
| AP_TRIGGER_DEFAULT_POLL_INTERVAL| 5                            | No       |

**Recommendation**: Move sensitive values (AP_ENCRYPTION_KEY, AP_JWT_SECRET,
AP_POSTGRES_PASSWORD) into a Kubernetes Secret instead of the ConfigMap:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: activepieces-secret
  namespace: activepieces
type: Opaque
stringData:
  AP_ENCRYPTION_KEY: "your-256-bit-hex-key"
  AP_JWT_SECRET: "your-256-bit-hex-key"
  AP_POSTGRES_PASSWORD: "your-db-password"
```

---

## Step 6: Pipeline Stage Mapping

Current pipeline stages and what changes:

| Stage                         | Current                    | New                                          |
|-------------------------------|----------------------------|----------------------------------------------|
| Build Docker Image - Main     | Builds 1 combined image    | Build frontend: `Dockerfile.frontend`        |
| Build Docker Image - Worker   | SKIPPED                    | ENABLE - Build backend: `Dockerfile.backend` |
| Push to Harbor - Main         | Push 1 image               | Push frontend image                          |
| Push to Harbor - Worker       | SKIPPED                    | ENABLE - Push backend image                  |
| Cleanup Old Images - Main     | Clean 1 repo               | Clean frontend repo                          |
| Cleanup Old Images - Worker   | SKIPPED                    | ENABLE - Clean backend repo                  |
| Deploy to K8s - Main          | 1 deployment + 1 service   | Frontend deployment + service                |
| Deploy to K8s - Worker        | SKIPPED                    | ENABLE - Backend deployment + service        |
| Run DB Migrations             | No change                  | No change (backend handles migrations)       |
| Setup Gateway / HTTPRoute     | Points to combined service | Points to frontend service (port 80)         |

---

## Step 7: Rollout Order

When deploying for the first time:

1. Build both images
2. Push both images to Harbor
3. Deploy backend FIRST (so it's ready to receive traffic)
4. Wait for backend readiness probe to pass
5. Deploy frontend (it will connect to backend via K8s DNS)
6. Update HTTPRoute to point to `activepieces-frontend-service`

---

## Step 8: Verification

After deployment, verify:

1. `curl https://activepieces-dev.8bit.ai/` → should return the React HTML page
2. `curl https://activepieces-dev.8bit.ai/api/v1/health` → should return health check from backend
3. Open browser → login should work → creating/running flows should work
4. Check that WebSocket connection works (real-time updates in the builder)

---

## FAQ

**Q: Why does the engine stay with the backend?**
A: The engine is not a separate HTTP service. It's a JavaScript file that the backend
runs as a child process (subprocess) to execute flows. They must be in the same pod.

**Q: Do I need to change the React code?**
A: No. The React app calls `/api/*` on the same domain. Nginx handles proxying.
The browser never talks to the backend directly.

**Q: What about WebSocket (Socket.io)?**
A: Nginx proxies `/socket.io/*` to the backend, same as before. The only difference
is `localhost:3000` becomes `activepieces-backend-service:3000`.

**Q: Can I scale frontend and backend independently?**
A: Yes! Frontend can have many replicas (it's just static files). Backend scaling
depends on your database and Redis capacity.

**Q: What about the root .env and packages/server/api/.env files?**
A: Those are for local development only. In K8s, all env vars come from
ConfigMap + Secret. Those .env files are not used in production containers.

**Q: What if I want to go back to the single-container setup?**
A: The original Dockerfile, nginx.react.conf, and docker-entrypoint.sh are untouched.
Just use the original Dockerfile to build one image like before.
