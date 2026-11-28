# Isolated C++17 compile + run sandbox image (PA#3 Criterion 2, Task N2).
# Contains ONLY g++ (C++17) and the compiled zero-mount `sandbox-exec` wrapper.
# Zero repository source files, zero .env files, zero secrets, non-root USER 65534:65534.
FROM gcc:12.4.0-bookworm

COPY sandbox-exec.c /tmp/sandbox-exec.c
RUN gcc -O2 -Wall -Wextra -Werror /tmp/sandbox-exec.c -o /usr/local/bin/sandbox-exec \
    && chmod 0755 /usr/local/bin/sandbox-exec \
    && rm -f /tmp/sandbox-exec.c

USER 65534:65534
WORKDIR /tmp

ENTRYPOINT ["/usr/local/bin/sandbox-exec"]
