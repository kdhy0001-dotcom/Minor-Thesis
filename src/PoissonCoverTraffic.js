// Poisson cover traffic manager - adds dummy messages to normalize link volumes

// Generate Poisson-distributed random numbers
function poissonSample(lambda) {
  if (lambda <= 0) return 0;
  
  // For small lambda, use Knuth's algorithm
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    
    return k - 1;
  }
  
  // For large lambda, use normal approximation
  const mean = lambda;
  const stddev = Math.sqrt(lambda);
  
  // Box-Muller transform for gaussian
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  
  return Math.max(0, Math.round(mean + z * stddev));
}

/**
 * Link-level volume normalization with Poisson-distributed cover traffic
 * Makes all links have similar volume by adding cover to each link independently
 */
export class PoissonCoverTrafficManager {
  constructor(users, socialGraph, tierMap, config = {}) {
    this.users = users;
    this.socialGraph = socialGraph;
    this.tierMap = tierMap;
    
    // Configuration parameters
    this.targetMultiplier = config.targetMultiplier || 2.0;  // 2x natural traffic
    this.minTarget = config.minTarget || 1;
    this.maxTarget = config.maxTarget || 5;
    this.windowSize = config.windowSize || 20;              // Look-back window
    this.noiseStddev = config.noiseStddev || 0.5;
    this.probabilityThreshold = config.probabilityThreshold || 0.75;
    
    // Track network activity for adaptive baseline
    this.networkActivityHistory = [];
    this.adaptiveBaseline = 0;
    
    // Track link activity history
    this.linkHistory = new Map();
    this.currentEpoch = 0;
    
    // Statistics
    this.coverTrafficGenerated = 0;
    this.realTrafficCounted = 0;
  }
  
  // Record a real message on a link
  recordRealMessage(senderId, recipientId, epoch) {
    const linkKey = this._getLinkKey(senderId, recipientId);
    
    if (!this.linkHistory.has(linkKey)) {
      this.linkHistory.set(linkKey, []);
    }
    
    const history = this.linkHistory.get(linkKey);
    
    // Find or create entry for this epoch
    let entry = history.find(e => e.epoch === epoch);
    if (!entry) {
      entry = { epoch, realCount: 0, coverCount: 0 };
      history.push(entry);
    }
    
    entry.realCount++;
    this.realTrafficCounted++;
    
    this._trimHistory(linkKey);
  }
  
  // Generate cover traffic for all links
  generateCoverTraffic(epoch, rng) {
    this.currentEpoch = epoch;
    const coverMessages = [];
    
    // Update adaptive baseline based on recent activity
    if (epoch >= this.windowSize) {
      this._updateAdaptiveBaseline(epoch);
    }
    
    // For each link in the social graph
    for (const [nodeId, neighbors] of this.socialGraph.entries()) {
      for (const neighborId of neighbors) {
        // Process each link only once
        if (nodeId < neighborId) {
          const linkKey = this._getLinkKey(nodeId, neighborId);
          
          // Count recent total traffic on this link
          const recentTotal = this._countRecentTotal(linkKey, epoch);
          
          // Sample a target volume with noise
          const target = this._sampleTarget(rng);
          
          // Calculate cover needed (using Poisson)
          const coverNeeded = this._calculateCoverAmount(recentTotal, target, rng);
          
          // Add cover messages with probability
          for (let i = 0; i < coverNeeded; i++) {
            if (rng() < this.probabilityThreshold) {
              coverMessages.push({
                from: nodeId,
                to: neighborId,
                epoch: epoch,
                dummy: true,
                type: 'poisson_volume_normalization'
              });
              
              this._recordCoverMessage(linkKey, epoch);
              this.coverTrafficGenerated++;
            }
          }
        }
      }
    }
    
    return coverMessages;
  }
  
  // Generate consistent link key
  _getLinkKey(nodeA, nodeB) {
    return nodeA < nodeB ? `${nodeA}-${nodeB}` : `${nodeB}-${nodeA}`;
  }
  
  // Count recent messages on a link
  _countRecentTotal(linkKey, currentEpoch) {
    const history = this.linkHistory.get(linkKey);
    if (!history) return 0;
    
    let count = 0;
    const cutoff = currentEpoch - this.windowSize;
    
    for (const entry of history) {
      if (entry.epoch >= cutoff && entry.epoch < currentEpoch) {
        // Count both real and cover for volume normalization
        count += entry.realCount + entry.coverCount;
      }
    }
    
    return count;
  }
  
  // Sample target volume with Gaussian noise
  _sampleTarget(rng) {
    const baseTarget = this.adaptiveBaseline || this.minTarget;
    
    // Box-Muller transform for Gaussian noise
    const u1 = rng();
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Add noise to baseline
    const noisyTarget = baseTarget + z * this.noiseStddev;
    
    // Clamp to bounds
    const target = Math.max(this.minTarget, Math.min(this.maxTarget, noisyTarget));
    
    return Math.floor(target);
  }
  
  // Update baseline based on network activity
  _updateAdaptiveBaseline(epoch) {
    let totalMessages = 0;
    let linkCount = 0;
    
    for (const [linkKey, history] of this.linkHistory.entries()) {
      let linkTotal = 0;
      for (const entry of history) {
        if (entry.epoch >= epoch - this.windowSize && entry.epoch < epoch) {
          linkTotal += entry.realCount;  // Only real messages for baseline
        }
      }
      if (linkTotal > 0) {
        totalMessages += linkTotal;
        linkCount++;
      }
    }
    
    if (linkCount > 0) {
      const avgPerActiveLink = totalMessages / linkCount;
      // Set baseline to targetMultiplier × average
      this.adaptiveBaseline = Math.max(
        this.minTarget,
        Math.min(this.maxTarget, avgPerActiveLink * this.targetMultiplier)
      );
    }
  }
  
  // Calculate amount of cover traffic needed
  _calculateCoverAmount(recentTotal, target, rng) {
    const deficit = Math.max(0, target - recentTotal);
    
    if (deficit === 0) return 0;
    
    // Sample from Poisson distribution for natural variation
    const amount = poissonSample(deficit);
    
    return amount;
  }
  
  // Record cover message was added
  _recordCoverMessage(linkKey, epoch) {
    if (!this.linkHistory.has(linkKey)) {
      this.linkHistory.set(linkKey, []);
    }
    
    const history = this.linkHistory.get(linkKey);
    let entry = history.find(e => e.epoch === epoch);
    if (!entry) {
      entry = { epoch, realCount: 0, coverCount: 0 };
      history.push(entry);
    }
    
    entry.coverCount++;
  }
  
  // Trim old entries from history
  _trimHistory(linkKey) {
    const history = this.linkHistory.get(linkKey);
    if (!history) return;
    
    const cutoff = this.currentEpoch - this.windowSize - 10;
    const filtered = history.filter(e => e.epoch >= cutoff);
    
    this.linkHistory.set(linkKey, filtered);
  }
  
  // Get statistics about cover traffic
  getStatistics() {
    const linkStats = [];
    
    for (const [linkKey, history] of this.linkHistory.entries()) {
      let totalReal = 0;
      let totalCover = 0;
      
      for (const entry of history) {
        totalReal += entry.realCount;
        totalCover += entry.coverCount;
      }
      
      linkStats.push({
        link: linkKey,
        realMessages: totalReal,
        coverMessages: totalCover,
        totalMessages: totalReal + totalCover,
        coverRatio: totalCover / (totalReal + totalCover + 0.001)
      });
    }
    
    return {
      totalRealMessages: this.realTrafficCounted,
      totalCoverMessages: this.coverTrafficGenerated,
      coverRatio: this.coverTrafficGenerated / (this.realTrafficCounted + this.coverTrafficGenerated + 0.001),
      linkCount: linkStats.length,
      linkStats: linkStats.slice(0, 10)  // Sample of links
    };
  }
  
  // Legacy methods for compatibility
  updateNetworkStats(epoch, messageCount) {}
  
  shouldInjectCoverTraffic(userId, epoch, rng) {
    return { inject: false };
  }
  
  selectRecipient(userId, rng) {
    return null;
  }
}

export default PoissonCoverTrafficManager;