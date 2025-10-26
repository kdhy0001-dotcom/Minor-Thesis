// Graph metrics for comparing inferred vs ground truth social graphs

/**
 * Compare adversary's inferred graph to ground truth
 * Returns precision, recall, F1 and tier classification metrics
 */
export function compareGraphs(trueGraph, trueTiers, inferredGraph, inferredTiers) {
  const trueEdges = new Set();
  const inferredEdges = new Set();
  
  // Extract ground truth edges (avoid duplicates)
  for (const [u, neighbors] of trueGraph.entries()) {
    if (!neighbors) continue;
    for (const v of neighbors) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      if (a !== b) trueEdges.add(`${a}-${b}`);
    }
  }
  
  // Extract inferred edges
  for (const [u, neighbors] of inferredGraph.entries()) {
    if (!neighbors) continue;
    for (const v of neighbors) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      if (a !== b) inferredEdges.add(`${a}-${b}`);
    }
  }
  
  // Calculate precision, recall, F1 for edge detection
  const truePositives = Array.from(inferredEdges).filter(e => trueEdges.has(e)).length;
  const falsePositives = inferredEdges.size - truePositives;
  const falseNegatives = trueEdges.size - truePositives;
  
  const precision = inferredEdges.size > 0 ? truePositives / inferredEdges.size : 0;
  const recall = trueEdges.size > 0 ? truePositives / trueEdges.size : 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  
  // Tier classification accuracy (only for correctly identified edges)
  let tierCorrect = 0, tierTotal = 0;
  const tierConfusion = {
    intimate: { intimate: 0, friend: 0, acquaintance: 0, total: 0 },
    friend: { intimate: 0, friend: 0, acquaintance: 0, total: 0 },
    acquaintance: { intimate: 0, friend: 0, acquaintance: 0, total: 0 }
  };
  
  const tierDistribution = {
    true: { intimate: 0, friend: 0, acquaintance: 0 },
    inferred: { intimate: 0, friend: 0, acquaintance: 0 }
  };
  
  // Analyze tier classification for true positive edges
  for (const edge of inferredEdges) {
    if (trueEdges.has(edge)) {
      const [a, b] = edge.split('-').map(Number);
      const trueTier = trueTiers.get(a)?.get(b);
      const inferredTier = inferredTiers.get(a)?.get(b);
      
      if (trueTier && inferredTier) {
        tierTotal++;
        tierConfusion[trueTier].total++;
        tierConfusion[trueTier][inferredTier]++;
        if (trueTier === inferredTier) tierCorrect++;
      }
    }
  }
  
  // Count tier distributions
  for (const edge of trueEdges) {
    const [a, b] = edge.split('-').map(Number);
    const tier = trueTiers.get(a)?.get(b);
    if (tier) tierDistribution.true[tier]++;
  }
  
  for (const edge of inferredEdges) {
    const [a, b] = edge.split('-').map(Number);
    const tier = inferredTiers.get(a)?.get(b);
    if (tier) tierDistribution.inferred[tier]++;
  }
  
  const tierAccuracy = tierTotal > 0 ? tierCorrect / tierTotal : 0;
  
  // Per-tier precision and recall
  const tierMetrics = {};
  for (const tier of ['intimate', 'friend', 'acquaintance']) {
    const trueTierEdges = new Set();
    const inferredTierEdges = new Set();
    
    // Find edges of this tier in ground truth
    for (const edge of trueEdges) {
      const [a, b] = edge.split('-').map(Number);
      if (trueTiers.get(a)?.get(b) === tier) trueTierEdges.add(edge);
    }
    
    // Find edges of this tier in inferred graph
    for (const edge of inferredEdges) {
      const [a, b] = edge.split('-').map(Number);
      if (inferredTiers.get(a)?.get(b) === tier) inferredTierEdges.add(edge);
    }
    
    const tp = Array.from(inferredTierEdges).filter(e => trueTierEdges.has(e)).length;
    const fp = inferredTierEdges.size - tp;
    const fn = trueTierEdges.size - tp;
    
    const p = inferredTierEdges.size > 0 ? tp / inferredTierEdges.size : 0;
    const r = trueTierEdges.size > 0 ? tp / trueTierEdges.size : 0;
    const f = (p + r) > 0 ? 2 * p * r / (p + r) : 0;
    
    tierMetrics[tier] = {
      precision: p,
      recall: r,
      f1: f,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      support: trueTierEdges.size
    };
  }
  
  return {
    // Overall edge detection
    precision,
    recall,
    f1,
    truePositives,
    falsePositives,
    falseNegatives,
    
    // Privacy metrics
    privacyLoss: recall,  // % of true relationships discovered
    privacyPreserved: 1 - recall,
    
    // Tier classification
    tierAccuracy,
    tierConfusion,
    tierDistribution,
    tierMetrics,
    
    // Counts
    totalTrueEdges: trueEdges.size,
    totalInferredEdges: inferredEdges.size,
    
    // Edge lists for detailed analysis
    truePositiveEdges: Array.from(inferredEdges).filter(e => trueEdges.has(e)),
    falsePositiveEdges: Array.from(inferredEdges).filter(e => !trueEdges.has(e)),
    falseNegativeEdges: Array.from(trueEdges).filter(e => !inferredEdges.has(e))
  };
}

/**
 * Compute aggregate statistics across multiple runs
 */
export function aggregateGraphMetrics(metrics) {
  const n = metrics.length;
  if (n === 0) return null;
  
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const mean = (arr) => sum(arr) / arr.length;
  const std = (arr) => {
    const m = mean(arr);
    const variance = sum(arr.map(x => (x - m) ** 2)) / arr.length;
    return Math.sqrt(variance);
  };
  
  const fields = [
    'precision', 'recall', 'f1', 'privacyLoss', 
    'tierAccuracy', 'truePositives', 'falsePositives', 'falseNegatives'
  ];
  
  const aggregated = {};
  
  for (const field of fields) {
    const values = metrics.map(m => m[field]);
    aggregated[field] = {
      mean: mean(values),
      std: std(values),
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }
  
  return aggregated;
}

export default compareGraphs;