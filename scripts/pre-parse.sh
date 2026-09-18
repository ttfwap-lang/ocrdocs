# The staged directory is passed as $1 by server/services/importService.ts.
# Fall back to a placeholder so the script is still runnable ad-hoc.
TARGET_DIR="${1:-/path/to/queued/folder}"

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
           [[ "$ext_guess" =~ ^(dll|sys|scr|lnk|cpl|cab|msi|msp|inf|reg|chm|hlp|bat|cmd|vbs|vbe|wsf|wsc|cur|ani|ico|obj|lib|pdb)$ ]]; then
            rm -f "$filepath"; exit 0
        fi
        
        # Skip if file type is entirely unidentifiable
        [[ "$ext_guess" == "???" || -z "$ext_guess" ]] && exit 0
        new_ext="${ext_guess%%/*}"
        
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
            
            7z x -mmt=1 -y -o"$temp_out" "$filepath" >/dev/null 2>&1
            [[ $? -eq 0 ]] && rm -f "$filepath"
        fi
    ' _ {}
}

# --- MAIN EXECUTION PIPELINE ---
echo "=== Phase 1/4: Initial Flattening ==="
flatten_directory

echo "=== Phase 2/4: Initial Process & Rename ==="
process_files

echo "=== Phase 3/4: Extracting Archives ==="
extract_archives

echo "=== Phase 4/4: Final Flattening & Processing ==="
# This second flatten pulls all the newly extracted files out of the "_ext_" temp folders from Phase 3
flatten_directory
process_files

echo "Operation Complete. Folder is flattened, cleaned, and simplified."