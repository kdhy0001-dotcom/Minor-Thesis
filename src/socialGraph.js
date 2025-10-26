// Social graph generation with tiered relationships

// Simple linear congruential generator for reproducibility
function makeRNG(seed) {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

// Weighted sampling without replacement (Efraimidis-Spirakis algorithm)
function weightedSample(candidates, k, rng) {
  if (k <= 0 || candidates.length === 0) return [];
  
  // Assign random key proportional to weight
  const keys = candidates.map(c => {
    const u = rng();
    const w = c.w > 0 ? c.w : 1e-12;
    return { c, key: Math.pow(u, 1 / w) };
  });
  
  // Select top k by key value
  keys.sort((a, b) => b.key - a.key);
  return keys.slice(0, k).map(({ c }) => c);
}

// Determine stronger relationship tier
function stronger(t1, t2) {
  const order = { intimate: 3, friend: 2, acquaintance: 1 };
  return order[t1] >= order[t2] ? t1 : t2;
}

/**
 * Generate tiered social graph with spatial clustering
 * Creates intimate, friend, and acquaintance connections
 */
export function getTieredMeshGraph(users, options = {}) {
  const n = users.length;
  const {
    pIntimate = 0.02,        // proportion of intimate connections
    pFriend = 0.08,          // proportion of friend connections
    pAcquaintance = 0.2,     // proportion of acquaintance connections
    pBridge = 0.01,          // probability of adding weak ties
    seed = 42,
    bandMultiplier = 2,      // candidate pool size multiplier
    bridgeSample = 3,        // number of bridge connections to add
  } = options;
  
  // Calculate target counts per tier
  const kInt = Math.max(1, Math.floor(pIntimate * (n - 1)));
  const kFri = Math.max(kInt + 2, Math.floor(pFriend * (n - 1)));
  const kAcq = Math.max(kFri + 3, Math.floor(pAcquaintance * (n - 1)));
  
  // Compute pairwise distances (spatial or pseudo-random)
  const dists = Array(n);
  const hasCoordinates = users[0] && (users[0].row !== undefined || users[0].col !== undefined);
  
  for (let i = 0; i < n; i++) {
    dists[i] = Array(n);
    for (let j = 0; j < n; j++) {
      if (i === j) {
        dists[i][j] = Infinity;
      } else if (hasCoordinates) {
        // Use actual spatial coordinates if available
        const dx = users[i].row - users[j].row;
        const dy = users[i].col - users[j].col;
        dists[i][j] = dx * dx + dy * dy;
      } else {
        // Use deterministic pseudo-random distance
        const hash = (i * 2654435761 + j * 2246822519) >>> 0;
        const normalizedHash = (hash / 0xffffffff);
        // Bias towards smaller distances for clustering
        dists[i][j] = Math.pow(normalizedHash, 2) * n;
      }
    }
  }
  
  // Initialize adjacency and tier maps
  const adj = new Map();
  const tierMap = new Map();
  for (const u of users) {
    adj.set(u.id, new Set());
    tierMap.set(u.id, new Map());
  }
  
  const rng = makeRNG(seed);
  
  // For each user, select neighbors by tier
  for (let i = 0; i < n; i++) {
    const uId = users[i].id;
    const picked = new Set();
    
    // Sort candidates by distance
    const candidates = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const vId = users[j].id;
      candidates.push({ id: vId, dist: dists[i][j] });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    
    // Helper to pick k neighbors for a tier
    const pickTier = (kTier, tierName) => {
      if (kTier <= 0) return;
      const m = Math.max(kTier, Math.floor(bandMultiplier * kTier));
      
      // Form candidate band from nearest unpicked nodes
      const band = [];
      for (const cand of candidates) {
        if (!picked.has(cand.id)) {
          band.push({ id: cand.id, w: 1 / (cand.dist + 1e-9) });
          if (band.length >= m) break;
        }
      }
      
      // Sample with distance-based weighting
      const selected = weightedSample(band, kTier, rng);
      for (const { id: vId } of selected) {
        picked.add(vId);
        adj.get(uId).add(vId);
        tierMap.get(uId).set(vId, tierName);
      }
    };
    
    // Build tiers from strongest to weakest
    pickTier(kInt, 'intimate');
    pickTier(kFri - kInt, 'friend');
    pickTier(kAcq - kFri, 'acquaintance');
  }
  
  // Enforce symmetry and reconcile tier conflicts
  for (const u of users) {
    const uId = u.id;
    for (const vId of adj.get(uId)) {
      adj.get(vId).add(uId);
      const tUV = tierMap.get(uId).get(vId);
      const tVU = tierMap.get(vId).get(uId);
      
      if (tUV && tVU) {
        // Keep stronger tier in both directions
        const strongerTier = stronger(tUV, tVU);
        tierMap.get(uId).set(vId, strongerTier);
        tierMap.get(vId).set(uId, strongerTier);
      } else if (tUV && !tVU) {
        tierMap.get(vId).set(uId, tUV);
      } else if (!tUV && tVU) {
        tierMap.get(uId).set(vId, tVU);
      }
    }
  }
  
  // Add weak-tie bridges for small-world properties
  if (pBridge > 0 && bridgeSample > 0) {
    for (const u of users) {
      const uId = u.id;
      if (rng() < pBridge) {
        const farCandidates = users.filter(v => 
          v.id !== uId && !adj.get(uId).has(v.id)
        );
        
        // Sample distant nodes to connect
        let toAdd = 0;
        let index = 0;
        while (toAdd < bridgeSample && index < farCandidates.length) {
          const r = rng();
          if (r < (bridgeSample - toAdd) / (farCandidates.length - index)) {
            const vId = farCandidates[index].id;
            adj.get(uId).add(vId);
            adj.get(vId).add(uId);
            
            // Bridge connections default to acquaintance
            if (!tierMap.get(uId).has(vId)) 
              tierMap.get(uId).set(vId, 'acquaintance');
            if (!tierMap.get(vId).has(uId)) 
              tierMap.get(vId).set(uId, 'acquaintance');
            toAdd++;
          }
          index++;
        }
      }
    }
  }
  
  // Convert sets to arrays for final graph
  const graph = new Map();
  for (const [uId, set] of adj) {
    graph.set(uId, Array.from(set));
  }
  
  return { graph, tierMap };
}

export default getTieredMeshGraph;

// Convert tier map to list of edges
export function tiersToList(tierMap) {
  const list = [];
  for (const [u, map] of tierMap) {
    for (const [v, tier] of map) {
      if (u < v) {  // avoid duplicates
        list.push({ u, v, tier });
      }
    }
  }
  return list;
}

// Generate deterministic tokens for user pairs
function generateToken(userId1, userId2, seed) {
  const pairId = userId1 < userId2 ? 
    `${userId1}:${userId2}` : `${userId2}:${userId1}`;
  
  // Simple string hash
  let hash = 0;
  for (let i = 0; i < pairId.length; i++) {
    hash = ((hash << 5) - hash + pairId.charCodeAt(i)) & 0xffffffff;
  }
  return (hash + seed) >>> 0;
}

// Extended graph with user personality types and tokens
export function getTokenBasedSocialGraph(users, options = {}) {
  const {
    pIntimate = 0.02,
    pFriend = 0.08,
    pAcquaintance = 0.2,
    pBridge = 0.01,
    talkativeRatio = 0.3,     // highly active users
    silentRatio = 0.5,        // low activity users
    bridgeRatio = 0.2,        // users bridging communities
    seed = 42
  } = options;

  // Generate base social graph
  const { graph, tierMap } = getTieredMeshGraph(users, options);
  const rng = makeRNG(seed + 100);
  
  // Assign personality types to users
  const userTypes = new Map();
  const personalities = ['talkative', 'silent', 'bridge'];
  const ratios = [talkativeRatio, silentRatio, bridgeRatio];
  
  for (const user of users) {
    const r = rng();
    let cumulative = 0;
    for (let i = 0; i < personalities.length; i++) {
      cumulative += ratios[i];
      if (r <= cumulative) {
        userTypes.set(user.id, personalities[i]);
        break;
      }
    }
  }
  
  // Generate tokens for each connection
  const tokenGraph = new Map();
  const userTokens = new Map();
  
  for (const [userId, connections] of graph.entries()) {
    const tokens = new Set();
    for (const friendId of connections) {
      const token = generateToken(userId, friendId, seed);
      tokens.add(token);
    }
    tokenGraph.set(userId, Array.from(connections));
    userTokens.set(userId, tokens);
  }
  
  return {
    socialGraph: graph,
    tierMap,
    userTypes,
    tokenGraph,
    userTokens
  };
}