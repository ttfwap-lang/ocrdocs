#!/usr/bin/env bash
# Evidence-preserving pre-parse for the ocrdocs batch importer.
#
# Contract:
#   pre-parse.sh WORK_DIR [BATCH_DIR]
#
# WORK_DIR is disposable derived content. BATCH_DIR (when supplied) is the
# import id directory that owns WORK_DIR; immutable source/, quarantine/, and
# manifests/ live beside it. Nothing in this script deletes a file: every
# removal is a move into quarantine with a JSONL action record.
set -u

TARGET_DIR="${1:-}"
BASE_DIR="${2:-${TARGET_DIR%/}}"
if [[ -z "$TARGET_DIR" || ! -d "$TARGET_DIR" ]]; then
    echo "usage: pre-parse.sh <existing-work-dir> [batch-dir]" >&2
    exit 2
fi
if [[ -z "$BASE_DIR" || "$BASE_DIR" == "$TARGET_DIR" ]]; then
    BASE_DIR="${TARGET_DIR%/}"
fi

QUARANTINE_DIR="${BASE_DIR}.quarantine"
MANIFEST_DIR="${BASE_DIR}.manifests"
mkdir -p "$QUARANTINE_DIR" "$MANIFEST_DIR"
ACTION_MANIFEST="${MANIFEST_DIR}/actions.jsonl"
umask 077

SEVENZ="$(command -v 7z || command -v 7zz || true)"
FILE_CMD="$(command -v file || true)"
NPROC="$(nproc 2>/dev/null || echo 1)"

json_escape() {
    # Paths/reasons are operator-controlled filesystem strings; escape the
    # characters that would otherwise break a JSONL record.
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g' | tr '\n' ' '
}

log_action() {
    local stage="$1" reason="$2" from="$3" to="$4"
    printf '{"stage":"%s","reason":"%s","from":"%s","to":"%s","at":"%s"}\n' \
        "$(json_escape "$stage")" "$(json_escape "$reason")" \
        "$(json_escape "$from")" "$(json_escape "$to")" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$ACTION_MANIFEST"
}

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        # The importer's authoritative duplicate key is SHA-256. This fallback
        # is only for minimal POSIX images; it is recorded as a digest, not
        # used to merge documents.
        shasum -a 256 "$1" 2>/dev/null | awk '{print $1}' || true
    fi
}

unique_destination() {
    local dir="$1" name="$2" candidate="$1/$2" stem ext i
    if [[ ! -e "$candidate" ]]; then
        printf '%s' "$candidate"
        return 0
    fi
    if [[ "$name" == *.* ]]; then
        stem="${name%.*}"
        ext=".${name##*.}"
    else
        stem="$name"
        ext=""
    fi
    i=1
    while :; do
        candidate="${dir}/${stem}~${i}${ext}"
        [[ ! -e "$candidate" ]] && break
        i=$((i + 1))
    done
    printf '%s' "$candidate"
}

quarantine_file() {
    local filepath="$1" stage="$2" reason="$3" rel dest
    [[ -f "$filepath" ]] || return 0
    rel="${filepath#"$TARGET_DIR"/}"
    dest="$(unique_destination "${QUARANTINE_DIR}/${stage}" "$rel")"
    mkdir -p "$(dirname "$dest")"
    mv -- "$filepath" "$dest" || return 1
    log_action "$stage" "$reason" "$filepath" "$dest"
    printf '--> quarantined %s (%s)\n' "$rel" "$stage" >&2
}

identify_extension() {
    local filepath="$1" mime="" guess=""
    if [[ -n "$FILE_CMD" ]]; then
        mime="$($FILE_CMD -b --mime-type "$filepath" 2>/dev/null || true)"
        guess="$($FILE_CMD -b --extension "$filepath" 2>/dev/null || true)"
    fi
    case "$mime" in
        image/bmp|image/x-ms-bmp) printf 'bmp' ;;
        image/jpeg) printf 'jpg' ;;
        image/png) printf 'png' ;;
        image/tiff) printf 'tif' ;;
        image/webp) printf 'webp' ;;
        application/pdf) printf 'pdf' ;;
        text/plain) printf 'txt' ;;
        text/xml|application/xml) printf 'xml' ;;
        application/json) printf 'json' ;;
        application/rtf|text/rtf) printf 'rtf' ;;
        application/vnd.openxmlformats-officedocument.wordprocessingml.document) printf 'docx' ;;
        *)
            guess="${guess//\?/}"
            if [[ "$guess" == "???" || -z "$guess" ]]; then
                printf ''
            else
                printf '%s' "${guess%%/*}" | tr '[:upper:]' '[:lower:]'
            fi
            ;;
    esac
}

is_archive() {
    local filepath="$1" mime="" ext="${1##*.}"
    ext="${ext,,}"
    if [[ -n "$FILE_CMD" ]]; then
        mime="$($FILE_CMD -b --mime-type "$filepath" 2>/dev/null || true)"
    fi
    [[ "$ext" =~ ^(zip|rar|7z|gz|tgz|tar|bz2|xz)$ ]] || \
        [[ "$mime" =~ application/(zip|x-rar|x-7z-compressed|gzip|x-tar|x-bzip2|x-xz|vnd\.rar) ]]
}

flatten_directory() {
    local filepath rel base stem ext candidate digest n
    while IFS= read -r -d '' filepath; do
        [[ -f "$filepath" ]] || continue
        rel="${filepath#"$TARGET_DIR"/}"
        base="${rel##*/}"
        candidate="$TARGET_DIR/$base"
        if [[ -e "$candidate" ]]; then
            if [[ "$base" == *.* ]]; then
                stem="${base%.*}"
                ext=".${base##*.}"
            else
                stem="$base"
                ext=""
            fi
            digest="$(printf '%s' "$rel" | sha256_of /dev/stdin 2>/dev/null || true)"
            [[ -n "$digest" ]] || digest="$(printf '%s' "$rel" | cksum | awk '{print $1}')"
            candidate="$TARGET_DIR/${stem}~${digest:0:8}${ext}"
            n=1
            while [[ -e "$candidate" ]]; do
                candidate="$TARGET_DIR/${stem}~${digest:0:8}_${n}${ext}"
                n=$((n + 1))
            done
        fi
        mv -- "$filepath" "$candidate" || continue
        log_action flatten "nested:$rel" "$filepath" "$candidate"
    done < <(find "$TARGET_DIR" -mindepth 2 -type f -print0 2>/dev/null)
    # Directory removal is safe: rmdir only succeeds when no file remains.
    find "$TARGET_DIR" -depth -mindepth 1 -type d -empty -exec rmdir -- {} + 2>/dev/null || true
}

process_files() {
    local filepath base ext mime size digest short new_name target current_digest
    while IFS= read -r -d '' filepath; do
        [[ -f "$filepath" ]] || continue
        base="${filepath##*/}"
        # Test/prepare markers and the action manifest are not corpus files.
        [[ "$base" == .* || "$base" == "actions.jsonl" || "$base" == "intake.jsonl" ]] && continue
        if is_archive "$filepath"; then
            continue
        fi
        ext="$(identify_extension "$filepath")"
        [[ -n "$ext" ]] || { quarantine_file "$filepath" unsupported "unrecognised content type"; continue; }
        mime=""
        if [[ -n "$FILE_CMD" ]]; then
            mime="$($FILE_CMD -b --mime-type "$filepath" 2>/dev/null || true)"
        fi
        size=$(wc -c < "$filepath" 2>/dev/null || echo 0)
        case "${base,,}" in
            thumbs.db|ehthumbs.db|ehthumbs_vista.db|desktop.ini|iconcache.db|bootmgr|hiberfil.sys|pagefile.sys|swapfile.sys|.ds_store|win386.swp|ntuser.dat*)
                quarantine_file "$filepath" junk_name "known system metadata"; continue ;;
        esac
        if [[ "$ext" =~ ^(exe|com|dll|sys|scr|lnk|cpl|cab|msi|msp|inf|reg|chm|hlp|bat|cmd|vbs|vbe|wsf|wsc|cur|ani|ico|obj|lib|pdb)$ ]] || \
           [[ "$mime" =~ application/(x-dosexec|x-msdownload|vnd\.ms-cab-compressed|x-msi|x-ms-installer|x-ms-shortcut) ]]; then
            quarantine_file "$filepath" junk_type "executable or installer"; continue
        fi
        if [[ "$size" -le 0 ]] || { [[ "$size" -le 2048 ]] && [[ "$ext" =~ ^(png|jpg|jpeg|tif|tiff|bmp|webp|pdf|docx)$ ]]; }; then
            quarantine_file "$filepath" tiny "empty or implausibly small document"; continue
        fi
        digest="$(sha256_of "$filepath")"
        [[ -n "$digest" ]] || { quarantine_file "$filepath" unreadable "could not hash"; continue; }
        short="${digest:0:16}"
        new_name="${ext}_${short}.${ext}"
        target="$TARGET_DIR/$new_name"
        if [[ -e "$target" ]]; then
            current_digest="$(sha256_of "$target")"
            if [[ "$current_digest" == "$digest" ]]; then
                quarantine_file "$filepath" duplicate "same SHA-256 as kept file $new_name"
                continue
            fi
            target="$(unique_destination "$TARGET_DIR" "$new_name")"
        fi
        if [[ "$filepath" != "$target" ]]; then
            mv -- "$filepath" "$target" || continue
            log_action rename "canonical:$ext" "$filepath" "$target"
        fi
    done < <(find "$TARGET_DIR" -maxdepth 1 -type f -print0 2>/dev/null)
}

extract_archives() {
    local filepath temp_out rc base
    [[ -n "$SEVENZ" ]] || return 0
    while IFS= read -r -d '' filepath; do
        [[ -f "$filepath" ]] || continue
        is_archive "$filepath" || continue
        base="${filepath##*/}"
        temp_out="${TARGET_DIR}/_ext_${base}.$$.d"
        mkdir -p "$temp_out"
        "$SEVENZ" x -mmt=1 -y -bd -o"$temp_out" -- "$filepath" >/dev/null 2>&1
        rc=$?
        if [[ $rc -ge 2 ]]; then
            quarantine_file "$filepath" archive_failed "archive could not be extracted (rc=$rc)"
            if [[ -d "$temp_out" ]]; then
                local failed_dir="${QUARANTINE_DIR}/archive_failed_members/${base}.$$.d"
                mkdir -p "$(dirname "$failed_dir")"
                mv -- "$temp_out" "$failed_dir" 2>/dev/null || true
                log_action archive_failed_members "partial extraction retained" "$temp_out" "$failed_dir"
            fi
            continue
        fi
        # The archive itself is evidence. Move it to quarantine rather than
        # deleting it; members continue through flatten/process below.
        quarantine_file "$filepath" archive_original "retained after safe extraction"
        # Leave temp_out in place: flatten_directory() will move its members
        # into the derived root and then remove only empty directories.
    done < <(find "$TARGET_DIR" -maxdepth 1 -type f -print0 2>/dev/null)
}

# The temp directory removal above is limited to the freshly-created derived
# extraction directory; no source snapshot is ever passed to this script.
count_archives() {
    local n=0 filepath
    while IFS= read -r -d '' filepath; do
        [[ -f "$filepath" ]] || continue
        if is_archive "$filepath"; then n=$((n + 1)); fi
    done < <(find "$TARGET_DIR" -maxdepth 1 -type f -print0 2>/dev/null)
    printf '%s' "$n"
}

echo "=== Phase 1/3: flatten derived work tree ==="
flatten_directory
for round in 1 2 3 4 5 6; do
    remaining="$(count_archives)"
    [[ "${remaining:-0}" -eq 0 ]] && break
    echo "--> archive round $round: $remaining"
    extract_archives
    flatten_directory
    process_files
done
echo "=== Phase 2/3: classify, quarantine, and canonicalize ==="
process_files
remaining="$(count_archives)"
[[ "${remaining:-0}" -gt 0 ]] && echo "WARNING: $remaining archive(s) retained in quarantine" >&2
echo "--> action manifest: $ACTION_MANIFEST"
echo "Operation complete: derived tree flattened; evidence moved to quarantine, never deleted."
