use std::path::Path;
use std::fs;

const MAX_CONTRACT_CHARS: usize = 8000;

/// Read the CLAUDE.md contract file from the vault root.
pub fn read_contract(vault_path: &str) -> Option<String> {
    let path = Path::new(vault_path).join("CLAUDE.md");
    fs::read_to_string(&path).ok()
}

/// Read and extract prioritized sections from the contract.
pub fn read_contract_sections(vault_path: &str, priority_sections: &[&str]) -> Option<String> {
    let md = read_contract(vault_path)?;
    Some(extract_contract_sections(&md, priority_sections, MAX_CONTRACT_CHARS))
}

/// Extract prioritized sections from contract markdown, truncating to max_chars.
pub fn extract_contract_sections(md: &str, priority_sections: &[&str], max_chars: usize) -> String {
    let lines: Vec<&str> = md.lines().collect();
    let mut head: Vec<&str> = vec![];
    let mut blocks: Vec<(String, Vec<&str>)> = vec![];
    let mut current: Option<(String, Vec<&str>)> = None;

    for line in &lines {
        if let Some(title) = parse_heading(line) {
            if let Some(cur) = current.take() {
                blocks.push(cur);
            }
            current = Some((title, vec![line]));
        } else if let Some((_, ref mut lines)) = current {
            lines.push(line);
        } else {
            head.push(line);
        }
    }
    if let Some(cur) = current {
        blocks.push(cur);
    }

    // Sort: priority sections first
    let is_priority = |title: &str| {
        priority_sections.iter().any(|k| title.to_lowercase().contains(&k.to_lowercase()))
    };
    blocks.sort_by(|a, b| {
        let pa = is_priority(&a.0);
        let pb = is_priority(&b.0);
        pb.cmp(&pa)
    });

    // Reassemble
    let mut all: Vec<&str> = head.clone();
    for (_, block_lines) in &blocks {
        all.extend(block_lines.iter());
    }

    let joined = all.join("\n");
    truncate_contract(&joined, max_chars)
}

fn parse_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix("## ") {
        Some(rest.trim().to_string())
    } else if let Some(rest) = trimmed.strip_prefix("# ") {
        Some(rest.trim().to_string())
    } else {
        None
    }
}

fn truncate_contract(s: &str, max_chars: usize) -> String {
    if s.len() <= max_chars {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    // Try to cut at a line boundary
    if let Some(last_newline) = truncated.rfind('\n') {
        truncated[..last_newline].to_string()
    } else {
        truncated
    }
}
