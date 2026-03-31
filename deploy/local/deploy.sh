#!/bin/bash
# ==============================================================================
# Activepieces Split Deployment Script
# Tested and verified on local minikube on 2026-03-31
#
# This script deploys Activepieces as two separate pods:
#   1. Frontend (Nginx + React static files) - port 80
#   2. Backend (Node.js API + Engine + Worker) - port 3000
#
# Prerequisites:
#   - Docker running
#   - kubectl configured
#   - For local testing: minikube installed
#   - The monorepo build output in dist/ (see Step 2)
#
# Usage:
#   For local minikube:  ./deploy.sh local
#   For remote cluster:  ./deploy.sh remote <registry> <version>
#
# Examples:
#   ./deploy.sh local
#   ./deploy.sh remote harbor.8bit.ai/activepieces v2.7
# ==============================================================================

set -euo pipefail

MODE="${1:-local}"
REGISTRY="${2:-}"
VERSION="${3:-latest}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==========================================="
echo " Activepieces Split Deployment"
echo " Mode: $MODE"
echo "==========================================="

# ----------------------------------------------------------
# Step 1: Verify prerequisites
# ----------------------------------------------------------
echo ""
echo "[Step 1] Verifying prerequisites..."

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not found"; exit 1; }
echo "  docker: OK"
echo "  kubectl: OK"

if [ "$MODE" = "local" ]; then
    command -v minikube >/dev/null 2>&1 || { echo "ERROR: minikube not found"; exit 1; }
    echo "  minikube: OK"

    if ! minikube status | grep -q "Running" 2>/dev/null; then
        echo "  Starting minikube (4 CPU, 6GB RAM)..."
        minikube start --cpus=4 --memory=6144 --driver=docker
    fi
    echo "  minikube: Running"

    # Point docker to minikube's daemon
    eval $(minikube docker-env)
    echo "  docker env: pointing to minikube"
fi

# ----------------------------------------------------------
# Step 2: Build the project (skip if dist/ exists)
# ----------------------------------------------------------
echo ""
echo "[Step 2] Checking build output..."

cd "$REPO_ROOT"

if [ ! -f "dist/packages/react-ui/index.html" ] || [ ! -f "dist/packages/server/api/main.cjs" ]; then
    echo "  Build output not found. Building..."
    bun install
    npx nx run-many --target=build --projects=react-ui,server-api --configuration production --parallel=2
    echo "  Build complete."
else
    echo "  Build output exists, skipping build."
fi

# ----------------------------------------------------------
# Step 3: Build Docker images
# ----------------------------------------------------------
echo ""
echo "[Step 3] Building Docker images..."

# Temporarily swap .dockerignore to allow dist/ in context
if [ -f ".dockerignore" ]; then
    cp .dockerignore .dockerignore.backup
fi

# Create a .dockerignore that allows dist/
cat > .dockerignore <<'IGNORE'
.angular
.dockerignore
.env
.git
.gitattributes
.github
.history
.idea
*.log
.vscode
builds
deploy
docs
node_modules
IGNORE

if [ "$MODE" = "local" ]; then
    FRONTEND_IMAGE="activepieces-frontend:local"
    BACKEND_IMAGE="activepieces-backend:local"
else
    FRONTEND_IMAGE="${REGISTRY}/activepieces-frontend:${VERSION}"
    BACKEND_IMAGE="${REGISTRY}/activepieces-backend:${VERSION}"
fi

echo "  Building frontend image: $FRONTEND_IMAGE"
docker build -f Dockerfile.frontend -t "$FRONTEND_IMAGE" .

echo "  Building backend image: $BACKEND_IMAGE"
docker build -f Dockerfile.backend -t "$BACKEND_IMAGE" .

# Restore .dockerignore
if [ -f ".dockerignore.backup" ]; then
    mv .dockerignore.backup .dockerignore
fi

echo "  Images built successfully."

# ----------------------------------------------------------
# Step 4: Push images (remote mode only)
# ----------------------------------------------------------
if [ "$MODE" = "remote" ]; then
    echo ""
    echo "[Step 4] Pushing images to registry..."
    docker push "$FRONTEND_IMAGE"
    docker push "$BACKEND_IMAGE"
    echo "  Images pushed."
else
    echo ""
    echo "[Step 4] Skipping push (local mode - images built directly in minikube)"
fi

# ----------------------------------------------------------
# Step 5: Deploy to Kubernetes
# ----------------------------------------------------------
echo ""
echo "[Step 5] Deploying to Kubernetes..."

# For remote mode, we'd need to update the image names in the YAML
# For local mode, we use the all-in-one.yaml as-is
if [ "$MODE" = "local" ]; then
    kubectl apply -f "$SCRIPT_DIR/all-in-one.yaml"
else
    # Replace image names in YAML for remote deployment
    sed "s|activepieces-frontend:local|${FRONTEND_IMAGE}|g; s|activepieces-backend:local|${BACKEND_IMAGE}|g; s|imagePullPolicy: Never|imagePullPolicy: IfNotPresent|g" \
        "$SCRIPT_DIR/all-in-one.yaml" | kubectl apply -f -
fi

echo "  Resources applied."

# ----------------------------------------------------------
# Step 6: Wait for pods to be ready
# ----------------------------------------------------------
echo ""
echo "[Step 6] Waiting for pods..."

echo "  Waiting for PostgreSQL..."
kubectl -n activepieces wait --for=condition=ready pod -l app=postgres --timeout=120s

echo "  Waiting for Redis..."
kubectl -n activepieces wait --for=condition=ready pod -l app=redis --timeout=120s

echo "  Waiting for Backend (this can take 2-5 minutes for piece sync)..."
kubectl -n activepieces wait --for=condition=ready pod -l app=activepieces-backend --timeout=600s

echo "  Waiting for Frontend..."
kubectl -n activepieces wait --for=condition=ready pod -l app=activepieces-frontend --timeout=120s

echo "  All pods ready!"

# ----------------------------------------------------------
# Step 7: Verify deployment
# ----------------------------------------------------------
echo ""
echo "[Step 7] Verifying deployment..."

echo ""
echo "  Pod status:"
kubectl -n activepieces get pods

echo ""
echo "  Service status:"
kubectl -n activepieces get svc

# Quick health check via port-forward
kubectl -n activepieces port-forward svc/activepieces-frontend-service 18080:80 &
PF_PID=$!
sleep 3

echo ""
echo "  Health check (via frontend proxy):"
HEALTH=$(curl -s http://localhost:18080/api/v1/health 2>/dev/null || echo "FAILED")
echo "    /api/v1/health -> $HEALTH"

echo ""
echo "  Frontend check:"
FRONTEND=$(curl -s http://localhost:18080/ 2>/dev/null | head -1 || echo "FAILED")
echo "    / -> $FRONTEND"

kill $PF_PID 2>/dev/null

# ----------------------------------------------------------
# Done
# ----------------------------------------------------------
echo ""
echo "==========================================="
echo " Deployment complete!"
echo "==========================================="
echo ""
echo " To access Activepieces:"
if [ "$MODE" = "local" ]; then
    echo "   kubectl -n activepieces port-forward svc/activepieces-frontend-service 8080:80"
    echo "   Then open: http://localhost:8080"
else
    echo "   Configure your Ingress/Gateway to point to activepieces-frontend-service:80"
fi
echo ""
echo " To check logs:"
echo "   kubectl -n activepieces logs -f deploy/activepieces-backend"
echo "   kubectl -n activepieces logs -f deploy/activepieces-frontend"
echo ""
echo " To cleanup (local):"
echo "   minikube delete"
echo ""
