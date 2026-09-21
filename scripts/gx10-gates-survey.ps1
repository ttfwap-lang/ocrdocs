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
param([switch]$Start, [switch]$Status, [switch]$Summary,
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
} elseif ($Summary) {
    $cmd = "$py -c ""import json; d=json.load(open('$dir/survey.json')); print('files', d['files'], 'long_side', d['long_side']); [print(k, v) for k, v in sorted(d['counts'].items(), key=lambda kv: -kv[1])]"""
    Remote $cmd
} else {
    Write-Error "Pass -Start, -Status or -Summary."
    exit 2
}
