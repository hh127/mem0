#!/usr/bin/env bash
# 全量回归（tests/ 全树）——一条命令跑完，失败时退出码非 0。
#
# 为什么分两段跑：
#   1) 默认 MEM0_TELEMETRY=True 时，mem0 每个 Memory() 都会建一个 Posthog 客户端；机器连不上
#      us.i.posthog.com 时，tests/test_main.py::test_add 单条用例就能把进程撑到 ~6.9GB 并卡在
#      退出阶段的 full GC（/usr/bin/time 报 Exit status 124）。加 MEM0_TELEMETRY=False 后同一
#      用例是 ~174MB / 3 秒。
#   2) 但有 3 个文件本身在断言「遥测事件被抓取」，关掉遥测它们必然失败，所以这 3 个文件单独
#      用 MEM0_TELEMETRY=True 跑。
#
# 环境依赖：CI 口径是 .[test,vector-stores,llms,extras]（不含 nlp/spaCy）。装了 spaCy 却没装
# en_core_web_sm 会让 mem0/utils/spacy_models.py 的 download() 走 sys.exit(2)（SystemExit 是
# BaseException，except Exception 抓不住），直接带崩一批用例。
#
# 用法：
#   bash scripts/run_full_tests.sh            # 自动找 .venv-test / .venv / venv 里的 python
#   PY=/path/to/python bash scripts/run_full_tests.sh
#   OUT=/tmp/mine bash scripts/run_full_tests.sh
#
# 提示：在 WSL 上把仓库和 venv 放在原生盘跑，别放在 /mnt/* ——9p 文件系统上 collect（导入 255
# 个包）要十几分钟且随时超时；原生盘上全树约 2 分钟。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

if [ -z "${PY:-}" ]; then
  for candidate in .venv-test/bin/python .venv/bin/python venv/bin/python; do
    if [ -x "$candidate" ]; then PY="$candidate"; break; fi
  done
fi
PY="${PY:-python3}"
OUT="${OUT:-/tmp/mem0_full_tests}"
# 断言遥测事件被抓取的文件：必须在 MEM0_TELEMETRY=True 下跑。
TEL_FILES=(
  tests/test_oss_to_platform_migrate.py
  tests/memory/test_notices.py
  tests/vector_stores/test_opensearch.py
)

mkdir -p "$OUT"
rm -f "$OUT"/part1.log "$OUT"/part2.log
overall=0

echo "python: $PY"
echo "== 1/2  全量（MEM0_TELEMETRY=False，排除 ${#TEL_FILES[@]} 个遥测断言文件）$(date +%T) =="
ignore=()
for f in "${TEL_FILES[@]}"; do ignore+=("--ignore=$f"); done
if [ -x /usr/bin/time ]; then
  MEM0_TELEMETRY=False /usr/bin/time -v -o "$OUT/part1.time" \
    "$PY" -m pytest tests/ -q --continue-on-collection-errors "${ignore[@]}" >"$OUT/part1.log" 2>&1
else
  MEM0_TELEMETRY=False "$PY" -m pytest tests/ -q --continue-on-collection-errors "${ignore[@]}" >"$OUT/part1.log" 2>&1
fi
rc1=$?
grep -E "[0-9]+ (passed|failed|error)|no tests ran" "$OUT/part1.log" | tail -1
if [ $rc1 -eq 0 ]; then echo "   rc=0"; else echo "   rc=$rc1  ← 有失败"; grep -E "^(FAILED|ERROR) " "$OUT/part1.log"; overall=1; fi

echo
echo "== 2/2  遥测断言文件（MEM0_TELEMETRY=True）$(date +%T) =="
if [ -x /usr/bin/time ]; then
  MEM0_TELEMETRY=True /usr/bin/time -v -o "$OUT/part2.time" \
    "$PY" -m pytest "${TEL_FILES[@]}" -q >"$OUT/part2.log" 2>&1
else
  MEM0_TELEMETRY=True "$PY" -m pytest "${TEL_FILES[@]}" -q >"$OUT/part2.log" 2>&1
fi
rc2=$?
grep -E "[0-9]+ (passed|failed|error)|no tests ran" "$OUT/part2.log" | tail -1
if [ $rc2 -eq 0 ]; then echo "   rc=0"; else echo "   rc=$rc2  ← 有失败"; grep -E "^(FAILED|ERROR) " "$OUT/part2.log"; overall=1; fi

if [ -f "$OUT/part1.time" ]; then
  peak1=$(grep -i "Maximum resident set size" "$OUT/part1.time" | grep -oE '[0-9]+')
  peak2=$(grep -i "Maximum resident set size" "$OUT/part2.time" | grep -oE '[0-9]+')
  echo
  echo "峰值内存: 第1段 $(( ${peak1:-0} / 1024 ))MB  第2段 $(( ${peak2:-0} / 1024 ))MB"
fi

# 汇总用例数（缺该字段时按 0 计，否则 set -u / 算术会炸）
count() {
  local n
  n=$(grep -oE "[0-9]+ $2" "$1" 2>/dev/null | tail -1 | grep -oE '[0-9]+')
  echo "${n:-0}"
}
tp=$(( $(count "$OUT/part1.log" passed) + $(count "$OUT/part2.log" passed) ))
ts=$(( $(count "$OUT/part1.log" skipped) + $(count "$OUT/part2.log" skipped) ))
tf=$(( $(count "$OUT/part1.log" failed) + $(count "$OUT/part2.log" failed) ))
echo "合计: ${tp} passed, ${ts} skipped, ${tf} failed   ($(date +%T))"
echo "日志: $OUT/part1.log  $OUT/part2.log"
exit $overall
