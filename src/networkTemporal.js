// Network_temporal.js - Enhanced with conversations, random routing, sub-epochs, and cover traffic
import { getTieredMeshGraph } from "./socialGraph.js";
import { createTemporalModel } from "./temporal.js";
import { GroundTruthManager } from "./GroundTruthManager.js";
import { PoissonCoverTrafficManager } from "./PoissonCoverTraffic.js";
import { CollaborativeCoverManager } from "./CollaborativeCoverTraffic.js";

const range = (n) => Array.from({ length: n }, (_, i) => i);

function pickWeighted(items, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Reply behavior configuration
const REPLY_CONFIG = {
  instantReplyProb: 0.25,
  delayedReplyProb: 0.60,
  eventualReplyProb: 0.10,
  noReplyProb: 0.05,
  tierMultipliers: {
    intimate: 1.5,
    friend: 1.0,
    acquaintance: 0.6
  },
  conversationDecay: 0.7,
  maxConversationLength: 5
};

// Routing configuration
const ROUTING_CONFIG = {
  shortestPathProb: 0.4,
  nearShortestProb: 0.35,
  diversePathProb: 0.20,
  randomWalkProb: 0.05,
  maxPathLengthMultiplier: 1.5,
  diversityBonus: 0.3
};

// Sub-epoch configuration
const EPOCH_CONFIG = {
  subEpochsPerHour: 6,
  burstProbability: 0.2,
  burstSize: { min: 2, max: 5 },
  burstWindow: 2
};

// Cover traffic configuration
const COVER_TRAFFIC_CONFIG = {
  strategy: 'adaptive',
  quietBoost: {
    inactiveThreshold: 5,
    boostRate: 0.15,
    maxDummies: 3
  },
  activityMaintenance: {
    targetMessagesPerDay: 20,
    variability: 0.3,
    checkWindow: 10
  },
  adaptive: {
    matchNetworkRate: true,
    personalizedNoise: true,
    temporalConsistency: true,
    relationshipBased: true
  }
};

// Conversation thread tracking
class ConversationThread {
  constructor(participants) {
    this.participants = new Set(participants);
    this.messageCount = 0;
    this.lastActive = 0;
    this.isActive = true;
  }
  
  shouldContinue(t, rng) {
    if (this.messageCount >= REPLY_CONFIG.maxConversationLength) return false;
    if (t - this.lastActive > 10) return false;
    return rng() < Math.pow(REPLY_CONFIG.conversationDecay, this.messageCount);
  }
}

// Path diversity tracker
class PathDiversityTracker {
  constructor() {
    this.nodeUsage = new Map();
    this.edgeUsage = new Map();
  }
  
  recordPath(path) {
    for (const node of path) {
      this.nodeUsage.set(node, (this.nodeUsage.get(node) || 0) + 1);
    }
    for (let i = 0; i < path.length - 1; i++) {
      const edge = [path[i], path[i+1]].sort().join('-');
      this.edgeUsage.set(edge, (this.edgeUsage.get(edge) || 0) + 1);
    }
  }
  
  getNodeScore(nodeId) {
    const usage = this.nodeUsage.get(nodeId) || 0;
    return 1.0 / (1.0 + usage * 0.1);
  }
  
  getEdgeScore(nodeA, nodeB) {
    const edge = [nodeA, nodeB].sort().join('-');
    const usage = this.edgeUsage.get(edge) || 0;
    return 1.0 / (1.0 + usage * 0.1);
  }
}

// OLD CODE - Removed because it was node-level adaptive (broken)
// Now using PoissonCoverTrafficManager for link-level volume normalization
// See PoissonCoverTraffic.js for the new implementation

/*
// User activity profile for cover traffic
class UserActivityProfile {
  ... [removed for brevity - was causing node-level adaptation]
}

// Cover traffic manager  
class CoverTrafficManager {
  ... [removed - was doing node-level adaptation which leaks info]
  ... [New approach: link-level volume normalization with Poisson noise]
}
*/

// Shortest path finding
function shortestPath(graph, src, dst, Hmax = 4) {
  if (src === dst) return [src];
  
  const q = [[src]];
  const seen = new Set([src]);
  
  while (q.length > 0) {
    const path = q.shift();
    if (path.length > Hmax + 1) continue;
    
    const last = path[path.length - 1];
    const neighbors = graph.get(last) || [];
    
    for (const n of neighbors) {
      if (seen.has(n)) continue;
      const newPath = path.concat([n]);
      if (n === dst) return newPath;
      seen.add(n);
      q.push(newPath);
    }
  }
  return null;
}

// Diverse path finding
function findDiversePath(graph, src, dst, Hmax, diversityTracker, rng) {
  if (src === dst) return [src];
  
  const queue = [[src]];
  const pathsFound = [];
  const seen = new Set([src]);
  
  while (queue.length > 0 && pathsFound.length < 20) {
    const path = queue.shift();
    if (path.length > Hmax + 1) continue;
    
    const last = path[path.length - 1];
    const neighbors = graph.get(last) || [];
    
    for (const n of neighbors) {
      if (seen.has(n) && n !== dst) continue;
      const newPath = path.concat([n]);
      
      if (n === dst) {
        pathsFound.push(newPath);
        if (pathsFound.length >= 20) break;
        continue;
      }
      
      seen.add(n);
      queue.push(newPath);
    }
  }
  
  if (pathsFound.length === 0) return null;
  
  const scoredPaths = pathsFound.map(path => {
    let score = 0;
    for (const node of path) {
      score += diversityTracker.getNodeScore(node);
    }
    for (let i = 0; i < path.length - 1; i++) {
      score += diversityTracker.getEdgeScore(path[i], path[i+1]);
    }
    score *= Math.pow(0.95, path.length);
    return { path, score };
  });
  
  const totalScore = scoredPaths.reduce((sum, p) => sum + p.score, 0);
  let r = rng() * totalScore;
  for (const { path, score } of scoredPaths) {
    r -= score;
    if (r <= 0) return path;
  }
  
  return scoredPaths[0].path;
}

// Random walk path
function randomWalkPath(graph, src, dst, maxLength, rng) {
  const path = [src];
  let current = src;
  const seen = new Set([src]);
  
  for (let i = 0; i < maxLength - 1; i++) {
    const neighbors = graph.get(current) || [];
    if (neighbors.length === 0) break;
    
    const dstIsNeighbor = neighbors.includes(dst);
    if (dstIsNeighbor && rng() < 0.3) {
      path.push(dst);
      return path;
    }
    
    const unvisited = neighbors.filter(n => !seen.has(n));
    const candidates = unvisited.length > 0 ? unvisited : neighbors;
    const next = candidates[Math.floor(rng() * candidates.length)];
    
    path.push(next);
    seen.add(next);
    current = next;
    
    if (current === dst) return path;
  }
  
  const finalPath = shortestPath(graph, current, dst, maxLength - path.length);
  if (finalPath) {
    return path.concat(finalPath.slice(1));
  }
  
  return [src, dst];
}

// Main path selection
function selectPath(graph, src, dst, Hmax, diversityTracker, tierMap, rng) {
  const r = rng();
  
  const shortestPathResult = shortestPath(graph, src, dst, Hmax);
  if (!shortestPathResult) return null;
  
  const shortestLength = shortestPathResult.length;
  const maxLength = Math.floor(shortestLength * ROUTING_CONFIG.maxPathLengthMultiplier);
  
  if (r < ROUTING_CONFIG.shortestPathProb) {
    return shortestPathResult;
  } else if (r < ROUTING_CONFIG.shortestPathProb + ROUTING_CONFIG.nearShortestProb) {
    const targetLength = shortestLength + 1 + Math.floor(rng() * 2);
    const path = findDiversePath(graph, src, dst, Math.min(targetLength, maxLength), 
                                  diversityTracker, rng);
    return path || shortestPathResult;
  } else if (r < 1 - ROUTING_CONFIG.randomWalkProb) {
    const path = findDiversePath(graph, src, dst, maxLength, diversityTracker, rng);
    return path || shortestPathResult;
  } else {
    return randomWalkPath(graph, src, dst, maxLength, rng);
  }
}

// Schedule reply
function scheduleReply(recipient, sender, t, tierMap, rng) {
  const tier = tierMap.get(recipient.id)?.get(sender.id) || 'acquaintance';
  const tierMult = REPLY_CONFIG.tierMultipliers[tier];
  
  const r = rng();
  const adjustedInstant = REPLY_CONFIG.instantReplyProb * tierMult;
  const adjustedDelayed = REPLY_CONFIG.delayedReplyProb * tierMult;
  const adjustedEventual = REPLY_CONFIG.eventualReplyProb * tierMult;
  
  const total = adjustedInstant + adjustedDelayed + adjustedEventual + REPLY_CONFIG.noReplyProb;
  
  if (r < adjustedInstant / total) {
    return { type: 'instant', epoch: t };
  } else if (r < (adjustedInstant + adjustedDelayed) / total) {
    const delay = 1 + Math.floor(rng() * 5);
    return { type: 'delayed', epoch: t + delay };
  } else if (r < (adjustedInstant + adjustedDelayed + adjustedEventual) / total) {
    const delay = 5 + Math.floor(rng() * 15);
    return { type: 'eventual', epoch: t + delay };
  } else {
    return null;
  }
}

// Distribute events to sub-epochs
function distributeEventsToSubEpochs(events, T, subEpochsPerHour, rng) {
  const totalSubEpochs = T * subEpochsPerHour;
  const subEpochEvents = Array.from({ length: totalSubEpochs }, () => []);
  
  for (const ev of events) {
    const baseSubEpoch = Math.floor((ev.t / (24 * 60 * 60 * 1000)) * totalSubEpochs);
    const jitter = Math.floor((rng() - 0.5) * 2);
    const subEpoch = Math.max(0, Math.min(totalSubEpochs - 1, baseSubEpoch + jitter));
    
    subEpochEvents[subEpoch].push(ev.userId);
  }
  
  return subEpochEvents;
}

// Add message bursts
function addMessageBursts(subEpochEvents, users, socialGraph, tierMap, rng) {
  for (let se = 0; se < subEpochEvents.length; se++) {
    for (const userId of subEpochEvents[se]) {
      if (rng() < EPOCH_CONFIG.burstProbability) {
        const burstSize = EPOCH_CONFIG.burstSize.min + 
                         Math.floor(rng() * (EPOCH_CONFIG.burstSize.max - EPOCH_CONFIG.burstSize.min + 1));
        
        for (let b = 1; b < burstSize; b++) {
          const offset = Math.floor(rng() * EPOCH_CONFIG.burstWindow);
          const targetSE = se + offset;
          if (targetSE < subEpochEvents.length) {
            subEpochEvents[targetSE].push(userId);
          }
        }
      }
    }
  }
  
  return subEpochEvents;
}

export default class NetworkTemporal {
  constructor(number = 100) {
    this.number = number;
    this.users = [];
    this.sentLog = [];
    this.socialGraph = null;
    this.tierMap = null;
    this._mkUsers(number);
  }

  _mkUsers(n) {
    for (let i = 0; i < n; i++) {
      this.users.push({ 
        id: i, 
        links: [], 
        lastMeet: new Map(),
        replyQueue: [],
        pendingReplies: new Map()
      });
    }
  }

  buildLinksFromSocialGraph() {
    if (!this.socialGraph) return;
    for (const u of this.users) u.links = [];
    for (const [uId, neighbors] of this.socialGraph.entries()) {
      this.users[uId].links = Array.from(new Set(neighbors)).map(n => this.users[n]);
    }
  }

  async run(protocol, options = {}, adv = null) {
    // Set defaults
    const defaults = {
      T: 200,
      seed: 42,
      epochToDayMs: 24 * 60 * 60 * 1000,
      tierProb: { 
        pIntimate: 0.02, 
        pFriend: 0.08, 
        pAcquaintance: 0.20, 
        pBridge: 0.01 
      },
      temporalOpts: { 
        minPerDay: 5, 
        maxPerDay: 120, 
        heavyUserFraction: 0.15, 
        skew: 0.6 
      },
      tierWeights: { 
        intimate: 3.0, 
        friend: 1.5, 
        acquaintance: 1.0 
      },
      adversaryDelta: 1,
      noiseEdgesPerEpoch: 0,
      verbose: false,
      Hmax: 4,
      cover: { 
        enabled: false, 
        quietPercentile: 0.3, 
        poisonRate: 0.01 
      }
    };
    
    // Merge options, ensuring nested objects are properly merged
    const opt = {
      ...defaults,
      ...options,
      tierProb: { ...defaults.tierProb, ...(options.tierProb || {}) },
      temporalOpts: { ...defaults.temporalOpts, ...(options.temporalOpts || {}) },
      tierWeights: { ...defaults.tierWeights, ...(options.tierWeights || {}) },
      cover: { ...defaults.cover, ...(options.cover || {}) }
    };
    
    const T = opt.T;

    // Build or load social graph using ground truth system
    const gtManager = new GroundTruthManager('./ground_truth');
    const groundTruth = gtManager.getOrCreate(
      this.users,
      this.number,
      opt.seed,
      {
        pIntimate: opt.tierProb.pIntimate,
        pFriend: opt.tierProb.pFriend,
        pAcquaintance: opt.tierProb.pAcquaintance,
        pBridge: opt.tierProb.pBridge
      }
    );
    
    this.socialGraph = groundTruth.graph;
    this.tierMap = groundTruth.tierMap;
    this.groundTruthMetadata = groundTruth.metadata;
    this.groundTruthStats = groundTruth.statistics;
    this.buildLinksFromSocialGraph();

    // Initialize protocol
    if (protocol?.onSession) {
      for (const [uId, neighbors] of this.socialGraph.entries()) {
        const u = this.users[uId];
        for (const vId of neighbors) {
          const v = this.users[vId];
          try { 
            protocol.onSession(u, v, this.socialGraph); 
          } catch (e) { }
        }
      }
    }

    // Simple RNG
    let seed = opt.seed;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // Generate temporal activity
    const tm = createTemporalModel({ seed: opt.seed });
    const userPerDayRates = tm.sampleUserMeans(this.users.length, opt.temporalOpts);
    const events = tm.generateEventsForHours(userPerDayRates, 24, {});

    // Initialize managers
    const pathDiversityTracker = new PathDiversityTracker();
    const coverTrafficMgr = opt.cover?.enabled ? new PoissonCoverTrafficManager(
      this.users,
      this.socialGraph,
      this.tierMap,
      {
        targetMultiplier: opt.cover.targetMultiplier || 0.3,
        minTarget: opt.cover.minTarget || 0.2,
        maxTarget: opt.cover.maxTarget || 1.0,
        windowSize: opt.cover.windowSize || 20,
        noiseStddev: opt.cover.noiseStddev || 0.3,
        probabilityThreshold: opt.cover.probabilityThreshold || 0.6
      }
    ) : null;

    // Distribute to sub-epochs
    const subEpochsPerHour = EPOCH_CONFIG.subEpochsPerHour;
    const totalSubEpochs = T * subEpochsPerHour;
    let subEpochEvents = distributeEventsToSubEpochs(events, T, subEpochsPerHour, rng);
    subEpochEvents = addMessageBursts(subEpochEvents, this.users, this.socialGraph, this.tierMap, rng);

    // Track conversations
    const activeThreads = new Map();

    // Future link activity
    const futureLinkCounts = Array.from({ length: T }, () => new Map());
    this.sentLog = Array.from({ length: T }, () => []);

    // Main simulation loop
    for (let se = 0; se < totalSubEpochs; se++) {
      const t = Math.floor(se / subEpochsPerHour);
      if (protocol?.onEpoch && se % subEpochsPerHour === 0) protocol.onEpoch(t);

      let realMessageCount = 0;

      // Process scheduled replies
      for (const user of this.users) {
        const repliesForThisSubEpoch = user.replyQueue.filter(r => r.subEpoch === se);
        
        for (const reply of repliesForThisSubEpoch) {
          const recipientId = reply.to;
          const recipient = this.users[recipientId];
          const msgId = `reply_se${se}_u${user.id}_${Math.random().toString(36).slice(2, 7)}`;
          
          const threadKey = [user.id, recipientId].sort().join('-');
          let thread = activeThreads.get(threadKey);
          if (!thread) {
            thread = new ConversationThread([user.id, recipientId]);
            activeThreads.set(threadKey, thread);
          }
          
          if (thread.shouldContinue(t, rng)) {
            if (protocol?.onSend) {
              protocol.onSend(t, user, recipient, msgId);
            }
            
            const path = selectPath(this.socialGraph, user.id, recipient.id, opt.Hmax, 
                                   pathDiversityTracker, this.tierMap, rng);
            if (!path) continue;                  
            pathDiversityTracker.recordPath(path);
            
            const hopTimes = [];
            for (let i = 0; i < path.length - 1; i++) {
              const epochIdx = t + i;
              if (epochIdx >= T) break;
              const a = Math.min(path[i], path[i + 1]);
              const b = Math.max(path[i], path[i + 1]);
              const key = `${a}-${b}`;
              const map = futureLinkCounts[epochIdx];
              map.set(key, (map.get(key) || 0) + 1);
              hopTimes.push(epochIdx);
            }
            
            this.sentLog[t].push({
              t,
              sender: user.id,
              recipient: recipient.id,
              id: msgId,
              path,
              hopTimes,
              dummy: false,
              isReply: true
            });
            
            if (adv?.noteSend) adv.noteSend(t, user.id);
            if (coverTrafficMgr) coverTrafficMgr.recordRealMessage(user.id, recipient.id, t);
            
            thread.messageCount++;
            thread.lastActive = t;
            realMessageCount++;
            
            const counterReply = scheduleReply(recipient, user, t, this.tierMap, rng);
            if (counterReply) {
              const replySubEpoch = counterReply.epoch * subEpochsPerHour + 
                                   Math.floor(rng() * subEpochsPerHour);
              recipient.replyQueue.push({
                subEpoch: replySubEpoch,
                to: user.id,
                type: counterReply.type
              });
            }
          }
        }
        
        user.replyQueue = user.replyQueue.filter(r => r.subEpoch > se);
      }

      // Process actual user messages
      for (const uId of subEpochEvents[se]) {
        if (uId == null || uId < 0 || uId >= this.users.length) continue;
        
        const sender = this.users[uId];
        const neighbors = this.socialGraph.get(uId) || [];
        if (neighbors.length === 0) continue;
        
        const weights = neighbors.map(nId => {
          const tier = this.tierMap.get(uId)?.get(nId) || 'acquaintance';
          return opt.tierWeights[tier] || opt.tierWeights.acquaintance;
        });
        const recipientId = pickWeighted(neighbors, weights);
        if (recipientId == null) continue;
        
        const recipient = this.users[recipientId];
        const msgId = `t${t}-se${se}-s${uId}-${Math.random().toString(36).slice(2, 7)}`;

        if (protocol?.onSession) {
          try { 
            protocol.onSession(sender, recipient, this.socialGraph); 
          } catch (e) { }
        }

        if (protocol?.onSend) {
          protocol.onSend(t, sender, recipient, msgId);
        }

        const path = selectPath(this.socialGraph, sender.id, recipient.id, opt.Hmax, 
                               pathDiversityTracker, this.tierMap, rng);
        pathDiversityTracker.recordPath(path);
        
        const hopTimes = [];
        for (let i = 0; i < path.length - 1; i++) {
          const epochIdx = t + i;
          if (epochIdx >= T) break;
          const a = Math.min(path[i], path[i + 1]);
          const b = Math.max(path[i], path[i + 1]);
          const key = `${a}-${b}`;
          const map = futureLinkCounts[epochIdx];
          map.set(key, (map.get(key) || 0) + 1);
          hopTimes.push(epochIdx);
        }

        this.sentLog[t].push({
          t,
          sender: sender.id,
          recipient: recipient.id,
          id: msgId,
          path,
          hopTimes,
          dummy: false,
          isReply: false
        });
        
        if (adv?.noteSend) adv.noteSend(t, sender.id);
        if (coverTrafficMgr) coverTrafficMgr.recordRealMessage(sender.id, recipient.id, t);
        realMessageCount++;
        
        // Schedule reply
        const reply = scheduleReply(recipient, sender, t, this.tierMap, rng);
        if (reply) {
          const replySubEpoch = reply.epoch * subEpochsPerHour + 
                               Math.floor(rng() * subEpochsPerHour);
          recipient.replyQueue.push({
            subEpoch: replySubEpoch,
            to: sender.id,
            type: reply.type
          });
        }
      }

      // Inject light Poisson cover traffic (once per epoch)
      if (se % subEpochsPerHour === 0 && coverTrafficMgr) {
        // Generate cover traffic (light volume normalization)
        const coverMessages = coverTrafficMgr.generateCoverTraffic 
          ? coverTrafficMgr.generateCoverTraffic(t, rng)
          : [];
        
        // Inject each cover message
        for (const coverMsg of coverMessages) {
          const senderId = coverMsg.from;
          const recipientId = coverMsg.to;
          
          // Select path for cover message
          const path = selectPath(this.socialGraph, senderId, recipientId, opt.Hmax, 
                                 pathDiversityTracker, this.tierMap, rng);
          pathDiversityTracker.recordPath(path);
          
          // Track hop times
          const hopTimes = [];
          for (let i = 0; i < path.length - 1; i++) {
            const epochIdx = t + i;
            if (epochIdx >= T) break;
            const a = Math.min(path[i], path[i + 1]);
            const b = Math.max(path[i], path[i + 1]);
            const key = `${a}-${b}`;
            const map = futureLinkCounts[epochIdx];
            map.set(key, (map.get(key) || 0) + 1);
            hopTimes.push(t + i);
          }
          
          // Create dummy message
          const msgId = `dummy_poisson_t${t}_${senderId}_${recipientId}_${Math.random().toString(36).slice(2, 6)}`;
          this.sentLog[t].push({
            t,
            sender: senderId,
            recipient: recipientId,
            id: msgId,
            path,
            hopTimes,
            dummy: true,
            coverType: 'poisson_volume_normalization'
          });
          
          // Notify adversary (they see cover as normal traffic)
          if (adv?.noteSend) adv.noteSend(t, senderId);
        }
      }

      // Materialize link activity (once per epoch)
      if (se % subEpochsPerHour === subEpochsPerHour - 1 || se === totalSubEpochs - 1) {
        const perLinkPacketCounts = new Map(futureLinkCounts[t] || []);

        for (let i = 0; i < opt.noiseEdgesPerEpoch; i++) {
          const a = Math.floor(rng() * this.number);
          const nbrs = this.socialGraph.get(a) || [];
          if (nbrs.length === 0) continue;
          const b = nbrs[Math.floor(rng() * nbrs.length)];
          const x = Math.min(a, b), y = Math.max(a, b);
          const k = `${x}-${y}`;
          perLinkPacketCounts.set(k, (perLinkPacketCounts.get(k) || 0) + 1);
        }

        for (const [k, cnt] of perLinkPacketCounts.entries()) {
          const [aStr, bStr] = k.split("-");
          const a = parseInt(aStr, 10), b = parseInt(bStr, 10);
          this.users[a].lastMeet.set(b, t);
          this.users[b].lastMeet.set(a, t);
          if (adv?.noteContact) adv.noteContact(t, a, b, cnt);
        }

        if (adv?.inferEpoch) {
          const adj = (sid) => this.socialGraph.get(sid) || [];
          adv.inferEpoch(t, adj);
        }

        if (protocol?.onEpochFinalize) protocol.onEpochFinalize(t);
        
        if (opt.verbose && (t % Math.max(1, Math.floor(T / 10)) === 0)) {
          console.log(`Epoch ${t}/${T} sends=${this.sentLog[t].length} edges=${perLinkPacketCounts.size}`);
        }
      }
    }

    return { sentLog: this.sentLog };
  }
}