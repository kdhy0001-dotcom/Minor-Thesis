// Network.js
// Basic network simulator with adversary support

import { getTieredMeshGraph } from "./socialGraph.js";
import { createTemporalModel } from "./temporal.js";

const range = (n) => Array.from({ length: n }, (_, i) => i);

const pickWeighted = (items, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
};

// Simple local-passive adversary for basic simulations
export class AdversaryLP {
  constructor(observedNodeIds = []) {
    this.observed = new Set(observedNodeIds);
    this.linkCounts = new Map();     // per-link packet counts
    this.sendEvents = new Map();     // sender activity by epoch
    this.guesses = [];               // inference attempts
  }

  _key(a, b, t) {
    const [x, y] = a < b ? [a, b] : [b, a];
    return `${x}-${y}-${t}`;
  }

  // Record contact (if at least one endpoint is observed)
  noteContact(t, aId, bId, packetsThisEpoch = 1) {
    if (!this.observed.has(aId) && !this.observed.has(bId)) return;
    const k = this._key(aId, bId, t);
    this.linkCounts.set(k, (this.linkCounts.get(k) || 0) + packetsThisEpoch);
  }

  // Record send event
  noteSend(t, senderId) {
    if (!this.sendEvents.has(t)) this.sendEvents.set(t, new Set());
    this.sendEvents.get(t).add(senderId);
  }

  // Guess recipient based on traffic volume
  guessRecipientForSend(t, senderId, neighbors, delta = 1) {
    let best = null, bestVal = -1;
    for (const v of neighbors) {
      let sum = 0;
      for (let tt = t; tt <= t + delta; tt++) {
        const k = this._key(senderId, v, tt);
        sum += this.linkCounts.get(k) || 0;
      }
      if (sum > bestVal) { 
        bestVal = sum; 
        best = v; 
      }
    }
    return best;
  }

  // Perform inference for an epoch
  inferEpoch(t, adjacencyLookup, delta = 1) {
    const senders = this.sendEvents.get(t) || new Set();
    for (const s of senders) {
      const nbrs = adjacencyLookup(s) || [];
      if (nbrs.length === 0) continue;
      const guess = this.guessRecipientForSend(t, s, nbrs, delta);
      this.guesses.push({ t, sender: s, guessRecipient: guess });
    }
  }
}

export default class Network {
  constructor(grid = [10, 10], number = 100, opts = {}) {
    this.grid = grid;
    this.number = number;
    this.users = [];
    this.sentLog = [];
    this._mkUsers(number);
    this.socialGraph = null;
    this.tierMap = null;
  }

  _mkUsers(n) {
    for (let i = 0; i < n; i++) {
      this.users.push({
        id: i,
        links: [],
        activity: 1.0,
        lastMeet: new Map(),
      });
    }
  }

  // Populate user.links from social graph
  buildLinksFromSocialGraph() {
    if (!this.socialGraph) return;
    for (const u of this.users) {
      u.links = [];
    }
    for (const [uId, neighbors] of this.socialGraph.entries()) {
      const user = this.users[uId];
      user.links = Array.from(new Set(neighbors)).map(n => this.users[n]);
    }
  }

  async run(protocol, options = {}, adv = null) {
    // Default configuration
    const opt = {
      T: 200,
      epochToDayMs: 24 * 60 * 60 * 1000,
      seed: 42,
      tierProb: { 
        pIntimate: 0.02, 
        pFriend: 0.08, 
        pAcquaintance: 0.20, 
        pBridge: 0.01 
      },
      temporalOpts: { 
        minPerDay: 5, 
        maxPerDay: 120, 
        heavyUserFraction: 0.15 
      },
      tierWeights: { 
        intimate: 3.0, 
        friend: 1.5, 
        acquaintance: 1.0 
      },
      adversaryDelta: 1,
      observedFraction: 0.05,
      verbose: false,
      ...options
    };

    // Build social graph
    const { graph, tierMap } = getTieredMeshGraph(this.users, {
      pIntimate: opt.tierProb.pIntimate,
      pFriend: opt.tierProb.pFriend,
      pAcquaintance: opt.tierProb.pAcquaintance,
      pBridge: opt.tierProb.pBridge,
      seed: opt.seed
    });
    
    this.socialGraph = graph;
    this.tierMap = tierMap;
    this.buildLinksFromSocialGraph();

    // Generate temporal events
    const tm = createTemporalModel({ seed: opt.seed });
    const userPerDayRates = tm.sampleUserMeans(this.users.length, opt.temporalOpts);
    const events = tm.generateEventsForHours(userPerDayRates, 24, {});

    const T = opt.T;
    const epochEvents = Array.from({ length: T }, () => []);
    
    // Map events to epochs
    for (const ev of events) {
      const epoch = Math.min(T - 1, Math.floor((ev.t / opt.epochToDayMs) * T));
      epochEvents[epoch].push(ev.userId);
    }

    // Setup adversary
    let adversary = adv;
    if (!adversary) {
      const obsCount = Math.max(1, Math.floor(this.number * opt.observedFraction));
      const observedNodes = [];
      for (let i = 0; i < obsCount; i++) observedNodes.push(i);
      adversary = new AdversaryLP(observedNodes);
    }

    const adjacencyLookup = (senderId) => this.socialGraph.get(senderId) || [];
    this.sentLog = Array.from({ length: T }, () => []);
    
    // Simulation loop
    for (let t = 0; t < T; t++) {
      if (protocol?.onEpoch) {
        protocol.onEpoch(t);
      }

      // Process sends for this epoch
      for (const uId of epochEvents[t]) {
        if (uId == null || uId < 0 || uId >= this.users.length) continue;
        
        const sender = this.users[uId];
        const neighbors = this.socialGraph.get(uId) || [];
        if (neighbors.length === 0) continue;

        // Select recipient with tier-based weighting
        const weights = neighbors.map(nId => {
          const tier = this.tierMap.get(uId)?.get(nId) || 'acquaintance';
          return opt.tierWeights[tier] || opt.tierWeights.acquaintance;
        });
        const recipientId = pickWeighted(neighbors, weights);
        if (recipientId == null) continue;
        
        const recipient = this.users[recipientId];
        const msgId = `t${t}-s${uId}-${Math.random().toString(36).slice(2, 7)}`;
        
        if (protocol?.onSend) {
          protocol.onSend(t, sender, recipient, msgId);
        }

        this.sentLog[t].push({ 
          t, 
          sender: sender.id, 
          recipient: recipient.id, 
          id: msgId 
        });

        if (adversary) adversary.noteSend(t, sender.id);
      }

      // Generate per-link counts
      const perLinkPacketCounts = new Map();

      for (const s of this.sentLog[t]) {
        const a = Math.min(s.sender, s.recipient);
        const b = Math.max(s.sender, s.recipient);
        const key = `${a}-${b}`;
        perLinkPacketCounts.set(key, (perLinkPacketCounts.get(key) || 0) + 1);
      }

      // Add some background noise
      for (let i = 0; i < Math.floor(this.number * 0.02); i++) {
        const a = Math.floor(Math.random() * this.number);
        const neighbors = this.socialGraph.get(a) || [];
        if (neighbors.length === 0) continue;
        const b = neighbors[Math.floor(Math.random() * neighbors.length)];
        const [x, y] = a < b ? [a, b] : [b, a];
        const k = `${x}-${y}`;
        perLinkPacketCounts.set(k, (perLinkPacketCounts.get(k) || 0) + 1);
      }

      // Update last contact times
      for (const key of perLinkPacketCounts.keys()) {
        const [aStr, bStr] = key.split("-");
        const a = parseInt(aStr, 10), b = parseInt(bStr, 10);
        this.users[a].lastMeet.set(b, t);
        this.users[b].lastMeet.set(a, t);
      }

      // Feed data to adversary
      for (const [key, cnt] of perLinkPacketCounts.entries()) {
        const [aStr, bStr] = key.split("-");
        const a = parseInt(aStr, 10), b = parseInt(bStr, 10);
        if (adversary) adversary.noteContact(t, a, b, cnt);
      }

      // Let adversary infer
      if (adversary) {
        adversary.inferEpoch(t, adjacencyLookup, opt.adversaryDelta);
      }

      if (protocol?.onEpochFinalize) {
        protocol.onEpochFinalize(t);
      }

      if (opt.verbose && t % Math.max(1, Math.floor(T / 10)) === 0) {
        console.log(`Epoch ${t}/${T} sends=${this.sentLog[t].length} links=${perLinkPacketCounts.size}`);
      }
    }

    return { sentLog: this.sentLog, adversary };
  }
}