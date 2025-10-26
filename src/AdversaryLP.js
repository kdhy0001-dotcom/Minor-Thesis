// Local-passive adversary with graph reconstruction capabilities

export default class AdversaryLP {
  constructor(observedNodeIds = [], opts = {}) {
    this.observed = new Set(observedNodeIds);
    this.delta = opts.delta || 1;
    this.linkCounts = new Map();         // Track traffic per link
    this.sendEvents = new Map();         // Track send events by epoch
    this.guesses = [];
    this.contactLog = [];
    this.recipientHistory = new Map();
    this.historicalWindow = opts.historicalWindow || 50;
    this.activityLog = new Map();
    
    // Social graph reconstruction data
    this.estimatedGraph = new Map();
    this.relationshipStrengths = new Map();
    this.relationshipTiers = new Map();
    this.communityStructure = new Map();
    this.confidenceScores = new Map();
    
    // Thresholds for tier classification
    this.TIER_THRESHOLDS = {
      intimate: 100,
      friend: 30,
      acquaintance: 5
    };
  }

  // Helper to generate edge key
  _edgeKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  _timeKey(a, b, t) {
    return `${this._edgeKey(a, b)}-${t}`;
  }

  // Record observed contact between nodes
  noteContact(t, aId, bId, count = 1) {
    if (!this.observed.has(aId) && !this.observed.has(bId)) return;
    
    const tk = this._timeKey(aId, bId, t);
    this.linkCounts.set(tk, (this.linkCounts.get(tk) || 0) + count);
    this.contactLog.push({ 
      t, 
      a: Math.min(aId, bId), 
      b: Math.max(aId, bId), 
      count 
    });
    
    // Track activity patterns
    if (!this.activityLog.has(t)) {
      this.activityLog.set(t, new Set());
    }
    this.activityLog.get(t).add(aId);
    this.activityLog.get(t).add(bId);
  }

  // Compute temporal correlation score
  _computeIntersectionScore(sender, recipient, t, window = 10) {
    let overlaps = 0, senderEvents = 0;
    
    for (let tt = Math.max(0, t - window); tt < t; tt++) {
      if (this.sendEvents.get(tt)?.has(sender)) {
        senderEvents++;
        if (this.activityLog.get(tt)?.has(recipient) || 
            this.activityLog.get(tt + 1)?.has(recipient)) {
          overlaps++;
        }
      }
    }
    return senderEvents > 0 ? overlaps / senderEvents : 0;
  }

  // Record send event
  noteSend(t, senderId) {
    if (!this.sendEvents.has(t)) this.sendEvents.set(t, new Set());
    this.sendEvents.get(t).add(senderId);
  }

  // Sum traffic counts over time window
  _sumCountsOverWindow(a, b, t0, delta) {
    let s = 0;
    for (let tt = t0; tt <= t0 + delta; tt++) {
      s += this.linkCounts.get(this._timeKey(a, b, tt)) || 0;
    }
    return s;
  }

  // Analyze relationship strength between two nodes
  _analyzeRelationship(nodeA, nodeB, windowSize = 100) {
    const key = this._edgeKey(nodeA, nodeB);
    
    // Volume-based analysis
    let totalVolume = 0;
    let volumeByEpoch = [];
    
    for (const [tk, count] of this.linkCounts.entries()) {
      if (tk.startsWith(key)) {
        totalVolume += count;
        volumeByEpoch.push(count);
      }
    }
    
    // Temporal correlation analysis
    let coActiveEpochs = 0;
    let totalEpochs = 0;
    
    for (const [epoch, nodes] of this.activityLog.entries()) {
      totalEpochs++;
      if (nodes.has(nodeA) && nodes.has(nodeB)) {
        coActiveEpochs++;
      }
    }
    
    const coActivityRate = totalEpochs > 0 ? coActiveEpochs / totalEpochs : 0;
    
    // Reciprocity analysis
    const aToB = this._countDirectedTraffic(nodeA, nodeB);
    const bToA = this._countDirectedTraffic(nodeB, nodeA);
    const reciprocity = Math.min(aToB, bToA) / (Math.max(aToB, bToA) + 1);
    
    // Consistency analysis
    const avgVolume = volumeByEpoch.length > 0 ? 
                     volumeByEpoch.reduce((a, b) => a + b, 0) / volumeByEpoch.length : 0;
    const variance = volumeByEpoch.length > 0 ?
                    volumeByEpoch.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumeByEpoch.length : 0;
    const consistency = 1 / (1 + Math.sqrt(variance));
    
    // Composite strength score
    const strength = {
      totalVolume,
      coActivityRate,
      reciprocity,
      consistency,
      overallScore: (
        totalVolume * 0.4 +
        coActivityRate * 100 * 0.2 +
        reciprocity * 50 * 0.2 +
        consistency * 50 * 0.2
      )
    };
    
    // Estimate tier based on volume
    let tier = 'unknown';
    let confidence = 0;
    
    if (totalVolume >= this.TIER_THRESHOLDS.intimate) {
      tier = 'intimate';
      confidence = Math.min(0.9, totalVolume / 200);
    } else if (totalVolume >= this.TIER_THRESHOLDS.friend) {
      tier = 'friend';
      confidence = Math.min(0.8, totalVolume / 60);
    } else if (totalVolume >= this.TIER_THRESHOLDS.acquaintance) {
      tier = 'acquaintance';
      confidence = Math.min(0.7, totalVolume / 15);
    } else if (totalVolume > 0) {
      tier = 'weak';
      confidence = 0.4;
    }
    
    // Adjust confidence based on other factors
    confidence *= (0.7 + 0.3 * reciprocity);
    confidence *= (0.8 + 0.2 * consistency);
    
    return { strength, tier, confidence };
  }

  // Count directed traffic between nodes
  _countDirectedTraffic(sender, recipient) {
    let count = 0;
    for (const guess of this.guesses) {
      if (guess.sender === sender && guess.guessRecipient === recipient) {
        count++;
      }
    }
    return count;
  }

  // Build estimated social graph from observations
  buildSocialGraphEstimate() {
    this.estimatedGraph.clear();
    this.relationshipStrengths.clear();
    this.relationshipTiers.clear();
    this.confidenceScores.clear();
    
    // Collect all observed node pairs
    const nodePairs = new Set();
    for (const [timeKey] of this.linkCounts.entries()) {
      const match = timeKey.match(/^(\d+)-(\d+)/);
      if (match) {
        const [_, a, b] = match;
        nodePairs.add(`${a}-${b}`);
      }
    }
    
    // Analyze each pair
    for (const pairKey of nodePairs) {
      const [a, b] = pairKey.split('-').map(Number);
      
      const analysis = this._analyzeRelationship(a, b);
      
      // Add edge if confident enough
      if (analysis.confidence >= 0.3) {
        if (!this.estimatedGraph.has(a)) {
          this.estimatedGraph.set(a, new Set());
        }
        if (!this.estimatedGraph.has(b)) {
          this.estimatedGraph.set(b, new Set());
        }
        
        this.estimatedGraph.get(a).add(b);
        this.estimatedGraph.get(b).add(a);
        
        this.relationshipStrengths.set(pairKey, analysis.strength.overallScore);
        this.relationshipTiers.set(pairKey, analysis.tier);
        this.confidenceScores.set(pairKey, analysis.confidence);
      }
    }
    
    this._detectCommunities();
    
    return {
      graph: this.estimatedGraph,
      strengths: this.relationshipStrengths,
      tiers: this.relationshipTiers,
      confidence: this.confidenceScores,
      communities: this.communityStructure
    };
  }

  // Simple community detection using label propagation
  _detectCommunities() {
    const nodes = Array.from(this.estimatedGraph.keys());
    const labels = new Map();
    
    // Initialize each node with its own label
    for (const node of nodes) {
      labels.set(node, node);
    }
    
    let changed = true;
    let iterations = 0;
    const maxIterations = 20;
    
    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;
      
      // Process nodes in random order
      const shuffled = nodes.slice().sort(() => Math.random() - 0.5);
      
      for (const node of shuffled) {
        const neighbors = this.estimatedGraph.get(node) || new Set();
        if (neighbors.size === 0) continue;
        
        // Count labels among neighbors
        const labelCounts = new Map();
        for (const neighbor of neighbors) {
          const label = labels.get(neighbor);
          labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
        }
        
        // Adopt most frequent label
        let maxCount = 0;
        let bestLabel = labels.get(node);
        for (const [label, count] of labelCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            bestLabel = label;
          }
        }
        
        if (bestLabel !== labels.get(node)) {
          labels.set(node, bestLabel);
          changed = true;
        }
      }
    }
    
    this.communityStructure = labels;
  }

  // Get tier bonus for scoring
  _getTierBonus(tier) {
    const bonuses = {
      intimate: 10,
      friend: 5,
      acquaintance: 2,
      weak: 0.5,
      unknown: 0
    };
    return bonuses[tier] || 0;
  }

  // Infer recipient for each send event in epoch
  inferEpoch(t, adjacencyLookup) {
    const senders = this.sendEvents.get(t) || new Set();
    
    for (const s of senders) {
      const nbrs = adjacencyLookup(s) || [];
      if (nbrs.length === 0) continue;
      
      // Use estimated graph to narrow candidates
      const estimatedNbrs = this.estimatedGraph.get(s);
      const candidateSet = estimatedNbrs && estimatedNbrs.size > 0 ? 
                          Array.from(estimatedNbrs).filter(n => nbrs.includes(n)) :
                          nbrs;
      
      if (candidateSet.length === 0) continue;
      
      // Score each candidate
      const scores = new Map();
      for (const v of candidateSet) {
        const immediateScore = this._sumCountsOverWindow(s, v, t, this.delta);
        const history = this.recipientHistory.get(s);
        const historicalScore = history ? (history.get(v) || 0) : 0;
        const intersectionScore = this._computeIntersectionScore(s, v, t, 10);
        
        const edgeKey = this._edgeKey(s, v);
        const relationshipBonus = this.relationshipStrengths.get(edgeKey) || 0;
        const tierBonus = this._getTierBonus(this.relationshipTiers.get(edgeKey));
        
        // Combined score with various factors
        scores.set(v, 
          (immediateScore * 0.5 + historicalScore * 0.2 + intersectionScore * 0.1) * 0.7 +
          (relationshipBonus * 0.001 + tierBonus) * 0.3
        );
      }
      
      // Pick best candidate
      const best = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])[0];
      
      if (best) {
        this.guesses.push({ t, sender: s, guessRecipient: best[0] });
        this._updateHistory(s, best[0]);
      }
    }
    
    // Periodically rebuild graph estimate
    if (t % 20 === 0 && t > 0) {
      this.buildSocialGraphEstimate();
    }
  }

  // Update recipient history
  _updateHistory(sender, guessedRecipient) {
    if (!this.recipientHistory.has(sender)) {
      this.recipientHistory.set(sender, new Map());
    }
    const history = this.recipientHistory.get(sender);
    history.set(guessedRecipient, (history.get(guessedRecipient) || 0) + 1);
  }

  // Get graph analysis statistics
  getGraphAnalysis() {
    this.buildSocialGraphEstimate();
    
    const stats = {
      totalNodes: this.estimatedGraph.size,
      totalEdges: Array.from(this.estimatedGraph.values())
                      .reduce((sum, neighbors) => sum + neighbors.size, 0) / 2,
      tierDistribution: {},
      avgConfidence: 0,
      communities: new Set(this.communityStructure.values()).size
    };
    
    // Count tier distribution
    for (const tier of this.relationshipTiers.values()) {
      stats.tierDistribution[tier] = (stats.tierDistribution[tier] || 0) + 1;
    }
    
    // Average confidence
    const confidences = Array.from(this.confidenceScores.values());
    stats.avgConfidence = confidences.length > 0 ?
                         confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
    
    return stats;
  }

  // Compute results against ground truth
  results(groundByEpoch) {
    let total = 0, correct = 0;
    const perGuess = [];
    
    for (const g of this.guesses) {
      const truths = (groundByEpoch[g.t] || []).filter(x => x.sender === g.sender);
      let bestR = null, bestN = -1;
      const tally = new Map();
      
      for (const tr of truths) {
        tally.set(tr.recipient, (tally.get(tr.recipient) || 0) + 1);
      }
      
      for (const [r, n] of tally.entries()) {
        if (n > bestN) { bestN = n; bestR = r; }
      }
      
      if (bestR != null) {
        total++;
        const ok = Number(bestR) === Number(g.guessRecipient);
        if (ok) correct++;
        perGuess.push({ 
          t: g.t, 
          sender: g.sender, 
          guess: g.guessRecipient, 
          truth: bestR, 
          ok 
        });
      }
    }
    
    const graphAnalysis = this.getGraphAnalysis();
    
    return { 
      accuracy: total ? correct / total : 0, 
      total, 
      correct, 
      perGuess, 
      contactLog: this.contactLog,
      graphReconstruction: graphAnalysis,
      estimatedGraph: this.estimatedGraph,
      relationshipTiers: this.relationshipTiers,
      confidenceScores: this.confidenceScores
    };
  }
}