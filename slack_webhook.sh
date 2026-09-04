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
# sanitize: head 500 chars, json escape via python or sed
MESSAGE=$(echo "$MESSAGE" | head -c 500 | tr -d '\n' | sed 's/"/\\"/g')
# retry 3 times, 2s delay, 10s max, fail on http error
curl --retry 3 --retry-delay 2 --max-time 10 --retry-all-errors -X POST -H 'Content-type: application/json' \
     --data "{\"text\":\"🤖 *Pi Agent Update:* $MESSAGE\"}" \
     "$SLACK_WEBHOOK_URL" || {
  echo "Error: Slack webhook failed after 3 retries" >&2
  exit 1
}
