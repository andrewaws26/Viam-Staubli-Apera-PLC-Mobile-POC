#!/usr/bin/env bash
# ironsight-resource-report.sh — Analyze resource logs and print a summary report.
# Reads /var/log/ironsight/resources.jsonl
# Usage: ironsight-resource-report.sh [--last Nh|Nm] (default: all data)
# Compatible with mawk (Pi Zero default).

set -o pipefail

LOG_FILE="/var/log/ironsight/resources.jsonl"
BOLD='\033[1m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
NC='\033[0m'

# Parse --last flag
FILTER_SINCE=""
if [[ "${1:-}" == "--last" && -n "${2:-}" ]]; then
    val="${2}"
    unit="${val: -1}"
    num="${val%?}"
    case "$unit" in
        h) FILTER_SINCE=$(date -u -d "-${num} hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
                          date -u -v-${num}H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) ;;
        m) FILTER_SINCE=$(date -u -d "-${num} minutes" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
                          date -u -v-${num}M '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) ;;
    esac
fi

if [[ ! -f "$LOG_FILE" ]]; then
    echo "No log file found at $LOG_FILE"
    echo "Run ironsight-resource-logger.sh first (or wait for cron)."
    exit 1
fi

line_count=$(wc -l < "$LOG_FILE")
if [[ "$line_count" -eq 0 ]]; then
    echo "Log file is empty."
    exit 1
fi

printf "${BOLD}${CYAN}"
printf "╔═══════════════════════════════════════════════════╗\n"
printf "║      IronSight Resource Report                    ║\n"
printf "║      %s                          ║\n" "$(date '+%Y-%m-%d %H:%M:%S')"
printf "╚═══════════════════════════════════════════════════╝\n"
printf "${NC}\n"

# --- Helper: extract a JSON field value using sed/grep (mawk-safe) ---
# Extracts numeric or string values for a given key from JSONL
# Usage: jval "field_name" → outputs one value per line
jval() {
    local field="$1"
    sed -n "s/.*\"${field}\":\([^,}]*\).*/\1/p" "$LOG_FILE" | sed 's/"//g' | grep -v '^null$'
}

# Extract field with timestamp: "ts val" per line
jval_ts() {
    local field="$1"
    paste -d' ' \
        <(sed -n 's/.*"ts":"\([^"]*\)".*/\1/p' "$LOG_FILE") \
        <(sed -n "s/.*\"${field}\":\([^,}]*\).*/\1/p" "$LOG_FILE" | sed 's/"//g') | \
        awk '$2 != "null" {print}'
}

# Filter by timestamp if --last was given
filter_since() {
    if [[ -n "$FILTER_SINCE" ]]; then
        awk -v since="$FILTER_SINCE" '$1 >= since {print}'
    else
        cat
    fi
}

# --- Time range ---
first_ts=$(head -1 "$LOG_FILE" | sed -n 's/.*"ts":"\([^"]*\)".*/\1/p')
last_ts=$(tail -1 "$LOG_FILE" | sed -n 's/.*"ts":"\([^"]*\)".*/\1/p')
printf "${BOLD}Time Range:${NC} %s → %s (%s entries)\n" "$first_ts" "$last_ts" "$line_count"

# --- CPU ---
printf "\n${BOLD}${CYAN}═══ CPU ═══${NC}\n"
cpu_data=$(jval_ts "cpu_pct" | filter_since)
if [[ -n "$cpu_data" ]]; then
    echo "$cpu_data" | awk '
    BEGIN { sum=0; n=0; max=0 }
    { sum+=$2; n++; if($2>max) max=$2 }
    END {
        if(n>0) printf "  Avg: %.1f%%  Max: %.1f%%  Samples: %d\n", sum/n, max, n
    }'

    # Top 5 CPU spikes > 80%
    spikes=$(echo "$cpu_data" | awk '$2 > 80 {print}' | sort -k2 -rn | head -5)
    if [[ -n "$spikes" ]]; then
        printf "  ${YELLOW}CPU spikes >80%%:${NC}\n"
        echo "$spikes" | while read -r ts val; do
            printf "    %s  ${RED}%.1f%%${NC}\n" "$ts" "$val"
        done
    fi
else
    printf "  ${DIM}No CPU data available${NC}\n"
fi

# --- Memory ---
printf "\n${BOLD}${CYAN}═══ Memory ═══${NC}\n"
mem_data=$(jval_ts "mem_used_mb" | filter_since)
if [[ -n "$mem_data" ]]; then
    echo "$mem_data" | awk '
    BEGIN { sum=0; n=0; max=0 }
    { sum+=$2; n++; if($2>max) max=$2 }
    END {
        if(n>0) printf "  Avg: %dMB  Max: %dMB  Samples: %d\n", sum/n, max, n
    }'
    # viam-server RSS
    viam_data=$(jval_ts "viam_server_rss_mb" | filter_since)
    if [[ -n "$viam_data" ]]; then
        echo "$viam_data" | awk '
        BEGIN { sum=0; n=0; max=0 }
        { sum+=$2; n++; if($2>max) max=$2 }
        END {
            if(n>0) printf "  viam-server RSS — Avg: %dMB  Max: %dMB\n", sum/n, max
        }'
    fi
fi

# --- Temperature ---
printf "\n${BOLD}${CYAN}═══ Temperature ═══${NC}\n"
temp_data=$(jval_ts "cpu_temp_c" | filter_since)
if [[ -n "$temp_data" ]]; then
    echo "$temp_data" | awk '
    BEGIN { sum=0; n=0; max=0; max_ts="" }
    { sum+=$2; n++; if($2>max) { max=$2; max_ts=$1 } }
    END {
        if(n>0) printf "  Avg: %.1f°C  Max: %.1f°C (at %s)\n", sum/n, max, max_ts
    }'
fi

# --- Top processes during high-CPU periods ---
printf "\n${BOLD}${CYAN}═══ Top Processes During CPU Spikes ═══${NC}\n"
# Extract lines where cpu_pct > 70 and get top_process
high_cpu_procs=$(paste -d' ' \
    <(sed -n 's/.*"cpu_pct":\([^,}]*\).*/\1/p' "$LOG_FILE") \
    <(sed -n 's/.*"top_process":"\{0,1\}\([^",}]*\)"\{0,1\}.*/\1/p' "$LOG_FILE") | \
    awk '$1+0 > 70 && $2 != "null" && $2 != "" {print $2}' | \
    sort | uniq -c | sort -rn | head -5)
if [[ -n "$high_cpu_procs" ]]; then
    echo "$high_cpu_procs" | while read -r count proc; do
        printf "  %4dx  %s\n" "$count" "$proc"
    done
else
    printf "  ${DIM}No high-CPU periods recorded${NC}\n"
fi

# --- Capture backlog trend ---
printf "\n${BOLD}${CYAN}═══ Capture Backlog Trend ═══${NC}\n"
backlog_data=$(jval_ts "unsync_files_count" | filter_since)
if [[ -n "$backlog_data" ]]; then
    first_val=$(echo "$backlog_data" | head -1 | awk '{print $2}')
    last_val=$(echo "$backlog_data" | tail -1 | awk '{print $2}')
    first_val=${first_val:-0}
    last_val=${last_val:-0}
    if [[ "$last_val" -gt "$first_val" ]]; then
        printf "  ${RED}Growing:${NC} %s → %s files\n" "$first_val" "$last_val"
    elif [[ "$last_val" -lt "$first_val" ]]; then
        printf "  ${GREEN}Shrinking:${NC} %s → %s files\n" "$first_val" "$last_val"
    else
        printf "  Stable: %s files\n" "$last_val"
    fi
else
    printf "  ${DIM}No backlog data available${NC}\n"
fi

# --- ASCII CPU Chart (last hour) ---
printf "\n${BOLD}${CYAN}═══ CPU Usage (last hour) ═══${NC}\n"
one_hour_ago=$(date -u -d "-1 hour" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
               date -u -v-1H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
chart_data=$(jval_ts "cpu_pct" | awk -v since="$one_hour_ago" '$1 >= since {print}')
if [[ -n "$chart_data" ]]; then
    chart_count=$(echo "$chart_data" | wc -l)
    if [[ "$chart_count" -ge 2 ]]; then
        echo "$chart_data" | awk '
        BEGIN { n=0 }
        { vals[n]=$2; times[n]=$1; n++ }
        END {
            height=12
            max=100
            width = (n > 60) ? 60 : n
            step = int(n / width)
            if (step < 1) step = 1

            # Bucket the data
            bw = 0
            for (i=0; i<n; i+=step) {
                s = 0; cnt = 0
                for (j=i; j<i+step && j<n; j++) { s += vals[j]; cnt++ }
                bucket[bw] = (cnt > 0) ? s/cnt : 0
                bw++
            }

            # Print chart
            for (row=height; row>=0; row--) {
                threshold = row * (max/height)
                if (row == height) printf "  %3d%% |", int(threshold)
                else if (row == int(height/2)) printf "  %3d%% |", int(threshold)
                else if (row == 0) printf "    0%% |"
                else printf "       |"

                for (col=0; col<bw; col++) {
                    if (bucket[col] >= threshold) {
                        if (bucket[col] >= 80) printf "#"
                        else if (bucket[col] >= 50) printf "="
                        else printf "."
                    } else {
                        printf " "
                    }
                }
                printf "\n"
            }
            # X-axis
            printf "       +"
            for (col=0; col<bw; col++) printf "-"
            printf "\n"
            # Time labels
            t1 = substr(times[0], 12, 5)
            t2 = substr(times[n-1], 12, 5)
            printf "        %s", t1
            sp = bw - length(t1) - length(t2)
            if (sp > 0) for (x=0; x<sp; x++) printf " "
            printf "%s\n", t2
        }'
    else
        printf "  ${DIM}Not enough data points for chart (need >=2, have %s)${NC}\n" "$chart_count"
    fi
else
    printf "  ${DIM}No data in last hour${NC}\n"
fi

printf "\n${DIM}Log file: %s (%s lines, %s)${NC}\n" "$LOG_FILE" "$line_count" \
    "$(du -sh "$LOG_FILE" 2>/dev/null | cut -f1)"
