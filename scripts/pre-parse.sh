# The staged directory is passed as $1 by server/services/importService.ts.
# Fall back to a placeholder so the script is still runnable ad-hoc.
TARGET_DIR="${1:-}"
if [[ -z "$TARGET_DIR" || ! -d "$TARGET_DIR" ]]; then
    echo "usage: pre-parse.sh <existing-target-dir>" >&2
    exit 2
fi
# Archive tool: 7z (p7zip) or 7zz. Missing tool = archives are left in place, loudly.
SEVENZ="$(command -v 7z || command -v 7zz || true)"
export SEVENZ

# --- FUNCTION: FLATTEN FOLDER ---
flatten_directory() {
    echo "--> Moving all nested files to the root directory..."
    # -mindepth 2 ensures we only grab files inside subdirectories
    find "$TARGET_DIR" -mindepth 2 -type f -print0 | xargs -0 -P $(nproc) -I {} mv --backup=t "{}" "$TARGET_DIR"/
    
    # Clean up empty subdirectories
    find "$TARGET_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null
}

# --- FUNCTION: PURGE, IDENTIFY & RENAME ---
process_files() {
    echo "--> Purging files 2KB or smaller..."
    find "$TARGET_DIR" -maxdepth 1 -type f -size -2049c -delete

    echo "--> Purging Windows junk, identifying types, deduplicating, and renaming..."
    find "$TARGET_DIR" -maxdepth 1 -type f -print0 | xargs -0 -P $(nproc) -I {} bash -c '
        filepath="$1"
        [[ ! -f "$filepath" ]] && exit 0
        
        # SINGLE-PASS IDENTIFICATION: Grabs both mime and extension guess simultaneously to save I/O
        # Example output: "application/x-dosexec; charset=binary    exe"
        file_info=$(file -b --mime-type --extension "$filepath")
        mime=$(echo "$file_info" | awk "{print \$1}" | sed "s/;//")
        ext_guess=$(echo "$file_info" | awk "{print \$NF}")
        
        # 1. EXTENDED INTELLIGENT WINDOWS SYSTEM PURGE
        base_lower=$(basename "$filepath" | tr "[:upper:]" "[:lower:]")
        
        # Purge by precise filename (Caches, Logs, Mac/Win Metadata, Hibernation, Pagefiles)
        if [[ "$base_lower" =~ ^(thumbs\.db|ehthumbs\.db|ehthumbs_vista\.db|desktop\.ini|iconcache\.db|ntuser\.dat.*|bootmgr|hiberfil\.sys|pagefile\.sys|swapfile\.sys|\.ds_store|win386\.swp)$ ]]; then
            rm -f "$filepath"; exit 0
        fi
        
        # Purge by true binary file type / MIME / Extension guess
        # Targets: Executables (PE32/PE32+), DLLs, Sys Drivers, Installers (MSI, CAB, MSP), 
        # Registry files, Compiled HTML Help, Cursors/Icons, Object files, and Shortcuts.
        if [[ "$mime" =~ application/(x-dosexec|x-msdownload|vnd\.ms-cab-compressed|x-msi|x-ms-installer|x-ms-shortcut) ]] || \
           [[ "$ext_guess" =~ ^(exe|com|dll|sys|scr|lnk|cpl|cab|msi|msp|inf|reg|chm|hlp|bat|cmd|vbs|vbe|wsf|wsc|cur|ani|ico|obj|lib|pdb)$ ]]; then
            rm -f "$filepath"; exit 0
        fi
        
        # Skip if file type is entirely unidentifiable
        [[ "$ext_guess" == "???" || -z "$ext_guess" ]] && exit 0
        new_ext="${ext_guess%%/*}"
        # Guard against a non-standard `file` build emitting words instead of extensions.
        if [[ ! "$new_ext" =~ ^[a-z0-9]{2,5}$ ]]; then
            exit 0
        fi
        
        # 2. HASH, DEDUPLICATE, AND RENAME
        file_hash=$(md5sum "$filepath" | cut -d" " -f1)
        short_hash="${file_hash:0:12}"
        new_name="${new_ext}_${short_hash}.${new_ext}"
        new_filepath="${filepath%/*}/${new_name}"
        
        if [[ "$filepath" != "$new_filepath" ]]; then
            if [[ -f "$new_filepath" ]]; then
                # An exact content duplicate already claimed this simplified name! Delete this copy.
                rm -f "$filepath"
            else
                mv "$filepath" "$new_filepath"
            fi
        fi
    ' _ {}
}

# --- FUNCTION: EXTRACT ARCHIVES ---
extract_archives() {
    echo "--> Identifying and extracting archives..."
    find "$TARGET_DIR" -maxdepth 1 -type f -print0 | xargs -0 -P $(nproc) -I {} bash -c '
        filepath="$1"
        [[ ! -f "$filepath" ]] && exit 0
        
        mime=$(file -b --mime-type "$filepath")
        if [[ "$mime" =~ application/(zip|x-rar|x-7z-compressed|gzip|x-tar|x-bzip2|x-xz|vnd\.rar) ]]; then
            # Extract to a temp folder named after the archive to avoid filename collisions during extraction
            temp_out="${filepath%/*}/_ext_${filepath##*/}"
            mkdir -p "$temp_out"
            
            if [[ -z "$SEVENZ" ]]; then
                echo "WARNING: no 7z/7zz installed; leaving archive ${filepath##*/} unextracted" >&2
                rmdir "$temp_out" 2>/dev/null
                exit 0
            fi
            "$SEVENZ" x -mmt=1 -y -o"$temp_out" "$filepath" >/dev/null 2>&1
            [[ $? -eq 0 ]] && rm -f "$filepath"
        fi
    ' _ {}
}

# --- FUNCTION: COUNT REMAINING ARCHIVES ---
count_archives() {
    find "$TARGET_DIR" -maxdepth 1 -type f -print0 | xargs -0 -r file -b --mime-type 2>/dev/null         | grep -Ecs 'application/(zip|x-rar|x-7z-compressed|gzip|x-tar|x-bzip2|x-xz|vnd\.rar)' || true
}

# --- MAIN EXECUTION PIPELINE ---
echo "=== Phase 1/3: Initial Flattening ==="
flatten_directory

echo "=== Phase 2/3: Initial Process & Rename ==="
process_files

echo "=== Phase 3/3: Extracting Archives (repeats for nested archives, e.g. tar.gz, zip-in-zip) ==="
for round in 1 2 3 4 5 6; do
    remaining=$(count_archives)
    [[ "${remaining:-0}" -eq 0 ]] && break
    echo "--> round $round: $remaining archive(s)"
    extract_archives
    # Pull extracted files out of the "_ext_" temp folders, then clean/rename/dedup them.
    flatten_directory
    process_files
done
remaining=$(count_archives)
[[ "${remaining:-0}" -gt 0 ]] && echo "WARNING: $remaining archive(s) could not be extracted" >&2

echo "Operation Complete. Folder is flattened, cleaned, and simplified."
