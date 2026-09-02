#!/bin/bash

if [ -z "$SLACK_WEBHOOK_URL" ]; then
  echo "Error: SLACK_WEBHOOK_URL environment variable is not set." >&2
  exit 1
fi

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then
  echo "Error: No message provided." >&2
  exit 1
fi

curl -X POST -H 'Content-type: application/json' \
     --data "{\"text\":\"🤖 *Pi Agent Update:* $MESSAGE\"}" \
     "$SLACK_WEBHOOK_URL"
