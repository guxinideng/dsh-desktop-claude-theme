#!/bin/bash
# 测当前代理节点到 Google API 的连接质量。
#
# 切一个节点跑一次,记下数字,再换下一个。看的是两件事:
#   1. TLS 握手时间 —— 这是链路质量最直接的体现
#   2. 波动(最慢 ÷ 最快)—— 比平均值更要紧
#
# 为什么盯波动:实测同一张图识别,一次 10.3 秒、一次 40.5 秒,差 4 倍。
# 而一次被 400 立即拒绝的往返稳定在 4.5 秒——模型那边是稳的,4 倍的
# 差距只能来自链路。一个平均 2 秒但偶尔卡 30 秒的节点,体感比稳定
# 3 秒的差得多。
#
# 不带 key,只打一个需要鉴权的端点看它回 403 —— 够测通路,不花配额。

URL="https://generativelanguage.googleapis.com/v1beta/models"
N="${1:-6}"

printf '测 %s 次 → %s\n\n' "$N" "$URL"
printf '  %-6s %-12s %-12s %s\n' '#' 'TLS握手' '总计' '状态'
printf '  %-6s %-12s %-12s %s\n' '─────' '──────────' '──────────' '────'

tmp=$(mktemp)
for i in $(seq 1 "$N"); do
  read -r tls total code < <(
    curl -o /dev/null -s --max-time 30 \
      -w '%{time_appconnect} %{time_total} %{http_code}' "$URL"
  )
  printf '  %-6s %-12s %-12s %s\n' "$i" "${tls}s" "${total}s" "$code"
  echo "$total" >> "$tmp"
done

echo
sort -n "$tmp" | awk '
  { v[NR] = $1 }
  END {
    if (NR == 0) { print "  没有采到数据"; exit }
    min = v[1]; max = v[NR]
    mid = (NR % 2) ? v[(NR+1)/2] : (v[NR/2] + v[NR/2+1]) / 2
    ratio = (min > 0) ? max / min : 0
    printf "  最快 %.2fs   中位 %.2fs   最慢 %.2fs\n", min, mid, max
    printf "  波动 %.1f 倍\n\n", ratio
    if (mid > 2.0)      print "  → 中位数偏高,这个节点到 Google 的链路本身就慢"
    else if (ratio > 3) print "  → 单次不慢但很不稳,长请求容易卡住甚至超时重试"
    else                print "  → 这个节点可用,继续对比其他节点看能不能更好"
  }
'
rm -f "$tmp"
