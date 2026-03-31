#!/bin/sh

# Set default values if not provided
export AP_APP_TITLE="${AP_APP_TITLE:-Activepieces}"
export AP_FAVICON_URL="${AP_FAVICON_URL:-https://cdn.activepieces.com/brand/favicon.ico}"
export AP_BACKEND_HOST="${AP_BACKEND_HOST:-activepieces-backend-service}"
export AP_BACKEND_PORT="${AP_BACKEND_PORT:-3000}"

echo "AP_APP_TITLE: $AP_APP_TITLE"
echo "AP_FAVICON_URL: $AP_FAVICON_URL"
echo "AP_BACKEND_HOST: $AP_BACKEND_HOST"
echo "AP_BACKEND_PORT: $AP_BACKEND_PORT"

# Process environment variables in index.html
envsubst '${AP_APP_TITLE} ${AP_FAVICON_URL}' < /usr/share/nginx/html/index.html > /usr/share/nginx/html/index.html.tmp && \
mv /usr/share/nginx/html/index.html.tmp /usr/share/nginx/html/index.html

# Process environment variables in nginx config (backend host/port)
envsubst '${AP_BACKEND_HOST} ${AP_BACKEND_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start Nginx (foreground)
nginx -g "daemon off;"
