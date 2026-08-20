use crate::types::{GraphData, GraphNode, GraphEdge, GraphInput};
use std::collections::{HashMap, HashSet};

pub struct GraphEngine {
    data: GraphData,
}

impl GraphEngine {
    pub fn new() -> Self {
        Self {
            data: GraphData {
                nodes: vec![],
                edges: vec![],
            },
        }
    }

    pub fn rebuild(&mut self, inputs: &[GraphInput]) {
        let mut nodes: Vec<GraphNode> = vec![];
        let mut edges: Vec<GraphEdge> = vec![];
        let mut adjacency: HashMap<String, HashSet<String>> = HashMap::new();

        // Build slug -> path map for link resolution
        let slug_map: HashMap<String, String> = inputs.iter().map(|n| {
            let slug = n.path
                .trim_end_matches(".md")
                .rsplit('/')
                .next()
                .unwrap_or(&n.path)
                .to_string();
            (slug, n.path.clone())
        }).collect();

        for input in inputs {
            let id = input.path.trim_end_matches(".md").to_string();
            let mut degree = 0u32;

            // Wikilink edges
            for link in &input.links {
                // Resolve link to a path
                let target_path = slug_map.get(link)
                    .cloned()
                    .or_else(|| {
                        // Try matching as path suffix
                        if link.ends_with(".md") {
                            Some(link.clone())
                        } else {
                            None
                        }
                    });

                if let Some(tp) = target_path {
                    let target_id = tp.trim_end_matches(".md").to_string();
                    if target_id != id {
                        edges.push(GraphEdge {
                            source: id.clone(),
                            target: target_id.clone(),
                            edge_type: "link".to_string(),
                            weight: 1.0,
                        });
                        adjacency.entry(id.clone()).or_default().insert(target_id.clone());
                        adjacency.entry(target_id).or_default().insert(id.clone());
                        degree += 1;
                    }
                }
            }

            // Tag edges (connect notes with same tag)
            for other in inputs {
                if other.path == input.path { continue; }
                let other_id = other.path.trim_end_matches(".md").to_string();
                let shared_tags: Vec<_> = input.tags.iter()
                    .filter(|t| other.tags.contains(t))
                    .collect();
                if !shared_tags.is_empty() {
                    let weight = shared_tags.len() as f64 * 0.5;
                    // Avoid duplicate tag edges
                    let edge_exists = edges.iter().any(|e|
                        (e.source == id && e.target == other_id || e.source == other_id && e.target == id)
                        && e.edge_type == "tag"
                    );
                    if !edge_exists {
                        edges.push(GraphEdge {
                            source: id.clone(),
                            target: other_id.clone(),
                            edge_type: "tag".to_string(),
                            weight,
                        });
                        degree += 1;
                    }
                }
            }

            let strength = if degree > 0 { 1.0 / (1.0 + degree as f64 * 0.1) } else { 0.0 };

            nodes.push(GraphNode {
                id: id.clone(),
                label: input.title.clone(),
                tags: input.tags.clone(),
                degree,
                strength,
                x: None,
                y: None,
                vx: None,
                vy: None,
            });
        }

        // AI relation edges would be added here from frontmatter ai_relations
        // For now, just link edges and tag edges

        self.data = GraphData { nodes, edges };
    }

    pub fn get_data(&self) -> GraphData {
        self.data.clone()
    }

    pub fn get_neighborhood(&self, node_id: &str, radius: u32) -> GraphData {
        let mut visited: HashSet<String> = HashSet::new();
        let mut frontier: Vec<String> = vec![node_id.to_string()];

        for _ in 0..=radius {
            let mut next_frontier = vec![];
            for node in &frontier {
                if visited.insert(node.clone()) {
                    // Find connected nodes
                    for edge in &self.data.edges {
                        if edge.source == *node && !visited.contains(&edge.target) {
                            next_frontier.push(edge.target.clone());
                        }
                        if edge.target == *node && !visited.contains(&edge.source) {
                            next_frontier.push(edge.source.clone());
                        }
                    }
                }
            }
            frontier = next_frontier;
        }

        let nodes: Vec<GraphNode> = self.data.nodes.iter()
            .filter(|n| visited.contains(&n.id))
            .cloned()
            .collect();

        let edges: Vec<GraphEdge> = self.data.edges.iter()
            .filter(|e| visited.contains(&e.source) && visited.contains(&e.target))
            .cloned()
            .collect();

        GraphData { nodes, edges }
    }
}
