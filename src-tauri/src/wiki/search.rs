use crate::types::*;
use std::collections::HashMap;

pub struct SearchIndex {
    notes: HashMap<String, IndexedNote>,
}

#[derive(Clone)]
struct IndexedNote {
    path: String,
    title: String,
    body: String,
    tags: Vec<String>,
    summary: Option<String>,
    words: Vec<String>,
}

impl SearchIndex {
    pub fn new() -> Self {
        Self {
            notes: HashMap::new(),
        }
    }

    pub fn rebuild(&mut self, notes: &[NoteMeta], vault: &crate::wiki::VaultManager) -> Result<(), String> {
        self.notes.clear();
        for n in notes {
            if n.kind != "file" { continue; }
            if let Ok(content) = vault.read_note(&n.path) {
                self.index_note(&content);
            }
        }
        Ok(())
    }

    pub fn index_note(&mut self, note: &NoteContent) {
        let words = tokenize(&format!("{} {} {}", note.title, note.tags.join(" "), note.raw_body));
        self.notes.insert(note.path.clone(), IndexedNote {
            path: note.path.clone(),
            title: note.title.clone(),
            body: note.raw_body.clone(),
            tags: note.tags.clone(),
            summary: note.ai_summary.clone(),
            words,
        });
    }

    pub fn remove_note(&mut self, path: &str) {
        self.notes.remove(path);
    }

    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<SearchResult>, String> {
        let query_words = tokenize(query);
        if query_words.is_empty() {
            return Ok(vec![]);
        }

        let mut results: Vec<(f64, &IndexedNote)> = vec![];

        for note in self.notes.values() {
            let score = self.score_note(note, &query_words, query);
            if score > 0.0 {
                results.push((score, note));
            }
        }

        results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        Ok(results.into_iter()
            .take(limit as usize)
            .map(|(score, note)| {
                let snippet = make_snippet(&note.body, &query_words, 200);
                SearchResult {
                    path: note.path.clone(),
                    title: note.title.clone(),
                    snippet,
                    score,
                    summary: note.summary.clone(),
                }
            })
            .collect())
    }

    fn score_note(&self, note: &IndexedNote, query_words: &[String], raw_query: &str) -> f64 {
        let mut score = 0.0;

        // Title match (high weight)
        let title_lower = note.title.to_lowercase();
        if title_lower.contains(&raw_query.to_lowercase()) {
            score += 10.0;
        }
        for qw in query_words {
            if title_lower.contains(qw) {
                score += 5.0;
            }
        }

        // Tag match
        for qw in query_words {
            for tag in &note.tags {
                if tag.to_lowercase().contains(qw) {
                    score += 3.0;
                }
            }
        }

        // Body word frequency
        for qw in query_words {
            let count = note.words.iter().filter(|w| *w == qw).count() as f64;
            score += count * 0.5;
        }

        // Summary match
        if let Some(summary) = &note.summary {
            let summary_lower = summary.to_lowercase();
            for qw in query_words {
                if summary_lower.contains(qw) {
                    score += 2.0;
                }
            }
        }

        score
    }
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty() && s.len() > 1)
        .map(|s| s.to_string())
        .collect()
}

fn make_snippet(body: &str, query_words: &[String], max_len: usize) -> String {
    let body_lower = body.to_lowercase();
    let mut best_pos = 0;
    let mut best_score = 0;

    for (i, _) in body.char_indices() {
        let end = (i + max_len).min(body.len());
        let window = &body_lower[i..end];
        let score = query_words.iter().filter(|qw| window.contains(*qw)).count();
        if score > best_score {
            best_score = score;
            best_pos = i;
        }
    }

    let end = (best_pos + max_len).min(body.len());
    let snippet = &body[best_pos..end];
    if best_pos > 0 {
        format!("...{}", snippet)
    } else {
        snippet.to_string()
    }
}
