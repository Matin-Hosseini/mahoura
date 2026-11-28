
FROM postgres:18-bookworm

COPY --chmod=755 init-app.sh /docker-entrypoint-initdb.d/10-app.sh

# Normalize Windows line endings and validate the initialization script.
RUN sed -i 's/\r$//' /docker-entrypoint-initdb.d/10-app.sh \
    && test "$(head -n 1 /docker-entrypoint-initdb.d/10-app.sh)" = '#!/bin/sh' \
    && /bin/sh -n /docker-entrypoint-initdb.d/10-app.sh
    