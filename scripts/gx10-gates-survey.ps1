<#
 Runs the LOCAL-ONLY S1/S2 gates survey (scripts/gates_corpus_survey.py) on the GX10 as flak3dd, and nothing else.
 It exists so a permission rule can allow exactly this script instead of general flak3dd shell access.

   powershell -File scripts/gx10-gates-survey.ps1 -Start [-LongSide 700] [-Workers 6] [-Limit 0]   ship the two files, run in the background
   powershell -File scripts/gx10-gates-survey.ps1 -Status                                           progress lines
   powershell -File scripts/gx10-gates-survey.ps1 -Summary                                          category counts only (no ids, no text)

 What the survey does on the box: reads document files IN PLACE (read-only), renders pages in memory at very low
 resolution, runs Tesseract, and writes per-file decisions to a mode-0600 file in a mode-0700 folder. It copies no
 document, writes no page image or text, and sends nothing off the machine. The remote commands below are fixed strings;
 the only inputs are three validated integers.
#>
param([switch]$Start, [switch]$Status, [switch]$Summary, [switch]$ErrorBreakdown, [ValidateSet("error","blank","ai")][string]$Quarantine, [switch]$AiVerify, [switch]$Apply, [switch]$AiTriage, [switch]$AiStatus, [ValidateRange(0, 100000)][int]$Sample = 0,
      [ValidateRange(300, 1600)][int]$LongSide = 700, [ValidateRange(1, 12)][int]$Workers = 6, [ValidateRange(0, 100000)][int]$Limit = 0)

$repo = Split-Path -Parent $PSScriptRoot
$wrapper = Join-Path $PSScriptRoot "gx10-flak3dd.ps1"
$dir = "/home/flak3dd/gates_survey"
$py = "/home/nick/ocr-runtime/venv/bin/python"

function B64([string]$p) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) }
function Remote([string]$cmd) { & powershell -NoProfile -File $wrapper $cmd }

if ($Start) {
    $gates = B64 (Join-Path $PSScriptRoot "ocr_gates.py")
    $survey = B64 (Join-Path $PSScriptRoot "gates_corpus_survey.py")
    $cmd = "umask 077; mkdir -p $dir && chmod 700 $dir && cd $dir && " +
           "echo $gates | base64 -d > ocr_gates.py && echo $survey | base64 -d > gates_corpus_survey.py && " +
           "cp /home/flak3dd/ocrdocs/scripts/ocr_spark_engine.py ./ocr_spark_engine.py && " +
           "(nohup $py gates_corpus_survey.py --db /home/flak3dd/ocrdocs/data/app.db --out $dir/survey.json " +
           "--long-side $LongSide --workers $Workers --limit $Limit > survey.log 2>&1 &) ; sleep 3; tail -3 survey.log"
    Remote $cmd
} elseif ($Status) {
    Remote "tail -5 $dir/survey.log"
} elseif ($Summary -or $ErrorBreakdown) {
    # Ship the read-only report script (same route the survey used), then run it with fixed arguments.
    $rep = B64 (Join-Path $PSScriptRoot "gates_survey_report.py")
    $what = if ($ErrorBreakdown) { "errors --db /home/flak3dd/ocrdocs/data/app.db" } else { "summary" }
    Remote "cd $dir && echo $rep | base64 -d > gates_survey_report.py && $py gates_survey_report.py $what --survey $dir/survey.json"
} elseif ($AiTriage) {
    # Local vision-model triage of no_text/blank files (scripts/corpus_ai_triage.py): stores only kind / readable-text flag /
    # confidence per file. -Sample N labels a random N first. Runs in the background; check with -AiStatus.
    $t = B64 (Join-Path $PSScriptRoot "corpus_ai_triage.py")
    $sampleArg = if ($Sample -gt 0) { "--sample $Sample" } else { "" }
    Remote "cd $dir && echo $t | base64 -d > corpus_ai_triage.py && (nohup $py corpus_ai_triage.py --survey $dir/survey.json --db /home/flak3dd/ocrdocs/data/app.db --statuses no_text,blank --out $dir/ai_labels.jsonl $sampleArg > ai.log 2>&1 &) ; sleep 5; tail -3 ai.log"
} elseif ($AiVerify) {
    # Second, independent AI look (different prompt, larger image, biased to keep) at every file the first pass failed.
    Remote "cd $dir && (nohup $py corpus_ai_triage.py --survey $dir/survey.json --db /home/flak3dd/ocrdocs/data/app.db --out $dir/ai_labels.jsonl --verify $dir/ai_verified.jsonl > aiv.log 2>&1 &) ; sleep 5; tail -2 aiv.log"
} elseif ($AiStatus) {
    Remote "tail -3 $dir/ai.log; wc -l < $dir/ai_labels.jsonl; tail -2 $dir/aiv.log 2>/dev/null; wc -l < $dir/ai_verified.jsonl 2>/dev/null; true"
} elseif ($Quarantine) {
    # Reversible: moves files of one survey status into a quarantine folder with a restore manifest (scripts/corpus_quarantine.py).
    # Dry run unless -Apply. Only files under /home/nick/ocr/parsed that are regular files are ever touched.
    $q = B64 (Join-Path $PSScriptRoot "corpus_quarantine.py")
    $flag = if ($Apply) { "--apply" } else { "" }
    # "ai": only files that failed BOTH AI looks; the survey status is then just the recorded reason.
    $aiSel = if ($Quarantine -eq "ai") { "--ai-confirmed $dir/ai_verified.jsonl" } else { "" }
    Remote "cd $dir && echo $q | base64 -d > corpus_quarantine.py && $py corpus_quarantine.py --survey $dir/survey.json --db /home/flak3dd/ocrdocs/data/app.db --status $Quarantine --root /home/nick/ocr/parsed --quarantine /home/nick/ocr/quarantine_$Quarantine $aiSel $flag"
} else {
    Write-Error "Pass -Start, -Status, -Summary, -ErrorBreakdown or -Quarantine."
    exit 2
}
