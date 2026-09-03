FROM ubuntu:24.04 AS base

RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    git \
    bash \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Install pi-freeflow exclusively via pi CLI (do NOT use npm install -g pi-freeflow)
# This avoids version skew between /opt and /root/.pi/agent/npm
RUN pi install npm:pi-freeflow && \
    mkdir -p /opt/pi-freeflow && \
    cp -r /root/.pi/agent/npm/node_modules/pi-freeflow/* /opt/pi-freeflow/ && \
    ln -sf /opt/pi-freeflow /usr/lib/node_modules/pi-freeflow && \
    pi --list-models | head -n 20

# Additional pi extensions: web access, subagents + standalone feynman CLI
RUN pi install npm:pi-web-access && \
    pi install npm:pi-subagents && \
    pi list && \
    mkdir -p /opt/feynman && npm install --prefix /opt/feynman --ignore-scripts @companion-ai/feynman && \
    ln -sf /opt/feynman/node_modules/@companion-ai/feynman/bin/feynman.js /usr/local/bin/feynman && \
    feynman --version && \
    mkdir -p /root/.pi/agent/agents && echo "installed feynman standalone $(feynman --version)"

# Patch pi-freeflow proxy to clamp max_completion_tokens for AtlasCloud (dots) – empirical limit ~390k, advertised 512k causes 400 bad request
# See debugging in workspace/*.py – pi sends max_completion_tokens 506566 which fails at >390k
RUN python3 << 'PY'
import pathlib
p = pathlib.Path('/opt/pi-freeflow/src/proxy.ts')
t = p.read_text()
if 'AtlasCloud safe limit' not in t:
    if 'getModelDef' not in t:
        t = t.replace('import { KILO_MODEL_IDS, resolveCanonicalModelId } from "./models.ts";',
                      'import { KILO_MODEL_IDS, getModelDef, resolveCanonicalModelId } from "./models.ts";')
    old = 'if (isKilo && parsedBody) {\n'
    new = '''if (isKilo && parsedBody) {
                    // Clamp max_completion_tokens to AtlasCloud safe limit (dots fails >390k, advertised 512k is overstated)
                    try {
                        const modelDef = getModelDef(parsedBody.model as string);
                        if (modelDef) {
                            const safeLimit = Math.min(modelDef.maxTokens ?? 32000, (modelDef.contextWindow ?? 128000) - 1000);
                            const atlasCap = (typeof parsedBody.model === 'string' && parsedBody.model.includes('dots')) ? 390000 : safeLimit;
                            const limit = Math.min(safeLimit, atlasCap);
                            if (typeof (parsedBody as any).max_completion_tokens === 'number' && (parsedBody as any).max_completion_tokens > limit) {
                                (parsedBody as any).max_completion_tokens = limit;
                            }
                            if (typeof (parsedBody as any).max_tokens === 'number' && (parsedBody as any).max_tokens > limit) {
                                (parsedBody as any).max_tokens = limit;
                            }
                            if (typeof (parsedBody as any).max_completion_tokens === 'number' && (parsedBody as any).max_completion_tokens > 390000 && typeof parsedBody.model === 'string' && parsedBody.model.includes('dots')) {
                                (parsedBody as any).max_completion_tokens = 390000;
                            }
                        } else {
                            if (typeof (parsedBody as any).max_completion_tokens === 'number' && (parsedBody as any).max_completion_tokens > 390000) {
                                (parsedBody as any).max_completion_tokens = 390000;
                            }
                            if (typeof (parsedBody as any).max_tokens === 'number' && (parsedBody as any).max_tokens > 390000) {
                                (parsedBody as any).max_tokens = 390000;
                            }
                        }
                    } catch {}
'''
    if old in t:
        t = t.replace(old, new)
        p.write_text(t)
        print('patched proxy clamp')
# Also correct model definition advertised maxTokens for dots (512k -> 390k) to prevent pi from requesting too much
p2 = pathlib.Path('/opt/pi-freeflow/src/models.ts')
t2 = p2.read_text()
old2 = 'id: "dots-studio/dots-3-note-preview:free",\n\t\tname: "Dots3-Note Preview (512K)",\n\t\treasoning: true,\n\t\tcontextWindow: 512_000,\n\t\tmaxTokens: 512_000,'
new2 = 'id: "dots-studio/dots-3-note-preview:free",\n\t\tname: "Dots3-Note Preview (390K)",\n\t\treasoning: true,\n\t\tcontextWindow: 512_000,\n\t\tmaxTokens: 390_000,'
if old2 in t2:
    t2 = t2.replace(old2, new2)
    p2.write_text(t2)
    print('fixed dots model')
PY

RUN mkdir -p /tools /workspace /.pi

# Bake coder sub-agent (all 4 extensions) into image
COPY .pi/agents/coder.md /root/.pi/agent/agents/coder.md
COPY .pi/agents/coder.md /workspace/.pi/agents/coder.md

COPY slack_webhook.sh /tools/slack_webhook.sh
COPY task_watcher.sh /tools/task_watcher.sh
COPY docker-entrypoint.sh /tools/docker-entrypoint.sh
RUN chmod +x /tools/slack_webhook.sh /tools/task_watcher.sh /tools/docker-entrypoint.sh

# Helper: always attach to main persistent pi session (stored at /root/.pi/agent/sessions, mounted to host)
RUN printf '%s\n' '#!/bin/bash' \
  '# pi-main: attach to persistent main agent session (same file across restarts)' \
  '# usage: pi-main [extra pi args] – always uses --session-id pi-personal-agent-main' \
  'set -e' \
  'if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then echo "Usage: pi-main [--no-attach] [pi args]"; echo "  Default: pi --session-id pi-personal-agent-main"; echo "  Env PI_NO_AUTO=1 or PI_MANUAL_BASH=1 disables bash auto-attach"; exit 0; fi' \
  'exec pi --session-id pi-personal-agent-main "$@"' \
  > /tools/pi-main && chmod +x /tools/pi-main && ln -sf /tools/pi-main /usr/local/bin/pi-main

# Make `docker exec -it pi-personal-agent bash` auto-open pi main session
# Disable with: docker exec -it -e PI_NO_AUTO=1 pi-personal-agent bash  OR  docker exec -it pi-personal-agent bash --noprofile
RUN grep -q "pi-main auto-attach" /root/.bashrc 2>/dev/null || cat >> /root/.bashrc << 'BASHRC'
# pi-main auto-attach: docker exec -it pi-personal-agent bash -> pi main session
# bypass: PI_NO_AUTO=1 or PI_MANUAL_BASH=1 or `bash --noprofile`
if [[ $- == *i* ]] && [ -t 0 ] && [ -z "$PI_NO_AUTO" ] && [ -z "$PI_MANUAL_BASH" ]; then
  if command -v pi >/dev/null 2>&1; then
    # only auto-attach when no args were given to bash (i.e. plain `bash`)
    if [ $# -eq 0 ]; then
      exec /tools/pi-main
    fi
  fi
fi
BASHRC

# --- Detailed logging defaults (visible in `docker logs`) ---
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8
ENV FREEFLOW_LOG_LEVEL=debug
ENV FREEFLOW_DEBUG=1
# Enable pi-freeflow debug on disk as well (overrides persisted state)
RUN mkdir -p /root/.pi/agent && echo '{"debug": true, "level": "debug"}' > /root/.pi/agent/pi-freeflow-debug.json

WORKDIR /workspace

ENTRYPOINT ["/tools/docker-entrypoint.sh"]
CMD []
