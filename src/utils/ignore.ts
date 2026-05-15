export function isIgnored(filePath: string, ignorePatternsStr: string): boolean {
    if (!ignorePatternsStr) return false;

    const patterns = ignorePatternsStr
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0 && !p.startsWith('#'));

    for (const pattern of patterns) {
        if (matchesPattern(filePath, pattern)) {
            return true;
        }
    }
    return false;
}

function matchesPattern(filePath: string, pattern: string): boolean {
    // If pattern doesn't contain wildcards, do a simple includes or exact match
    if (!pattern.includes('*')) {
        // If pattern ends with '/', treat as directory
        if (pattern.endsWith('/')) {
            if (filePath.startsWith(pattern) || filePath.includes('/' + pattern)) return true;
        } else {
            // Exact match or filename match
            if (filePath === pattern || filePath.includes('/' + pattern)) return true;
        }
    }

    // Convert glob-like * to regex
    // Escape regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    
    // Convert * to match anything except /, and ** to match anything
    let regexStr = '^' + escaped.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*');
    
    // If pattern doesn't start with /, it can match anywhere
    if (!pattern.startsWith('/')) {
        regexStr = '.*?(^|/)' + escaped.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*');
    } else {
        regexStr = '^' + escaped.slice(2).replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*'); // slice(2) to remove \/
    }

    // If it doesn't end with a wildcard and is not a directory marker, it should match the end
    if (!pattern.endsWith('*') && !pattern.endsWith('/')) {
        regexStr += '$';
    } else if (pattern.endsWith('/')) {
        regexStr += '.*';
    }

    try {
        const regex = new RegExp(regexStr);
        return regex.test(filePath);
    } catch {
        // If regex fails (e.g., malformed pattern), fallback to false
        return false;
    }
}
