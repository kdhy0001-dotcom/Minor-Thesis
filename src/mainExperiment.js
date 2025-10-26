import fs from 'fs';
import path from 'path';
import NetworkTemporal from './networkTemporal.js';
import Protocol from './Protocol.js';
import AdversaryLP from './AdversaryLP.js';

function ensureDir(p) { 
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); 
}

function rndPick(arr, k) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0 && k > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// Observer placement strategies
function pickRandomObservers(N, count) {
  const arr = Array.from({ length: N }, (_, i) => i);
  return rndPick(arr, count);
}

function pickHighDegreeObservers(graph, count) {
  const degrees = Array.from(graph.entries())
    .map(([id, nbrs]) => ({ id: Number(id), deg: (nbrs || []).length }));
  degrees.sort((a, b) => b.deg - a.deg);
  return degrees.slice(0, count).map(x => x.id);
}

function pickClusterObservers(graph, count) {
  const nodes = Array.from(graph.keys());
  const start = nodes[Math.floor(Math.random() * nodes.length)];
  const q = [start];
  const seen = new Set([start]);
  
  while (q.length > 0 && seen.size < count) {
    const v = q.shift();
    for (const nb of (graph.get(v) || [])) {
      if (!seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
        if (seen.size >= count) break;
      }
    }
  }
  
  if (seen.size < count) {
    const all = Array.from(graph.keys()).filter(x => !seen.has(x));
    while (seen.size < count && all.length) {
      const idx = Math.floor(Math.random() * all.length);
      seen.add(all.splice(idx, 1)[0]);
    }
  }
  
  return Array.from(seen).slice(0, count);
}

// Calculate overhead metrics
function computeCost(sentLog) {
  let total = 0, dummy = 0;
  for (const epoch of sentLog) {
    for (const msg of epoch) {
      total++;
      if (msg.dummy) dummy++;
    }
  }
  return { 
    totalMessages: total, 
    dummyMessages: dummy, 
    dummyFraction: total ? (dummy / total) : 0 
  };
}

// NEW: Conversation metrics
function calculateConversationMetrics(sentLog) {
  const replies = sentLog.flat().filter(m => m.isReply);
  const conversations = new Map();
  
  for (const msg of sentLog.flat()) {
    const key = [msg.sender, msg.recipient].sort().join('-');
    if (!conversations.has(key)) {
      conversations.set(key, { messages: [], threadLengths: [] });
    }
    conversations.get(key).messages.push(msg);
  }
  
  let totalReplyDelay = 0;
  let replyCount = 0;
  
  for (const [key, conv] of conversations.entries()) {
    const msgs = conv.messages.sort((a, b) => a.t - b.t);
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].isReply) {
        totalReplyDelay += msgs[i].t - msgs[i-1].t;
        replyCount++;
      }
    }
  }
  
  return {
    totalReplies: replies.length,
    avgReplyDelay: replyCount > 0 ? totalReplyDelay / replyCount : 0,
    conversationThreads: conversations.size,
    avgMessagesPerThread: conversations.size > 0 ? 
      sentLog.flat().length / conversations.size : 0
  };
}

// NEW: Routing metrics
function calculateRoutingMetrics(sentLog) {
  const allMessages = sentLog.flat();
  const pathLengths = allMessages.map(m => m.path.length);
  const avgPathLength = pathLengths.reduce((a, b) => a + b, 0) / pathLengths.length;
  
  // Calculate path diversity (unique paths vs total messages)
  const pathSet = new Set(allMessages.map(m => m.path.join('-')));
  const pathDiversity = pathSet.size / allMessages.length;
  
  // Count shortest path usage (estimate)
  let shortestPathCount = 0;
  for (const msg of allMessages) {
    if (msg.path.length <= 3) shortestPathCount++; // Rough heuristic
  }
  
  return {
    avgPathLength,
    pathDiversity,
    shortestPathUsage: shortestPathCount / allMessages.length,
    totalPaths: pathSet.size
  };
}

// NEW: Cover traffic metrics
function analyzeCoverTrafficEffectiveness(sentLog, advResults) {
  const allMessages = sentLog.flat();
  const dummyMessages = allMessages.filter(m => m.dummy);
  
  // Distribution across users
  const senderCounts = new Map();
  for (const msg of dummyMessages) {
    senderCounts.set(msg.sender, (senderCounts.get(msg.sender) || 0) + 1);
  }
  
  // Calculate entropy of dummy distribution
  const total = dummyMessages.length;
  let entropy = 0;
  if (total > 0) {
    for (const count of senderCounts.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  
  // Compare accuracy with/without cover traffic (rough estimate)
  const coverEffectiveness = {
    dummyDistributionEntropy: entropy,
    uniqueSendersWithDummies: senderCounts.size,
    avgDummiesPerSender: senderCounts.size > 0 ? total / senderCounts.size : 0
  };
  
  return coverEffectiveness;
}

// NEW: Graph reconstruction accuracy
function compareGraphs(estimatedGraph, actualGraph) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  
  const estimatedEdges = new Set();
  for (const [node, neighbors] of estimatedGraph.entries()) {
    for (const neighbor of neighbors) {
      if (node < neighbor) {
        estimatedEdges.add(`${node}-${neighbor}`);
      }
    }
  }
  
  const actualEdges = new Set();
  for (const [node, neighbors] of actualGraph.entries()) {
    for (const neighbor of neighbors) {
      if (node < neighbor) {
        actualEdges.add(`${node}-${neighbor}`);
      }
    }
  }
  
  for (const edge of estimatedEdges) {
    if (actualEdges.has(edge)) {
      truePositives++;
    } else {
      falsePositives++;
    }
  }
  
  for (const edge of actualEdges) {
    if (!estimatedEdges.has(edge)) {
      falseNegatives++;
    }
  }
  
  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1Score: f1
  };
}

// NEW: Enhanced evaluation
function evaluateExperiment(results, groundTruth, actualGraph) {
  return {
    // Basic accuracy
    accuracy: results.accuracy,
    total: results.total,
    correct: results.correct,
    
    // Conversation metrics
    conversations: calculateConversationMetrics(groundTruth),
    
    // Routing metrics
    routing: calculateRoutingMetrics(groundTruth),
    
    // Cover traffic metrics
    coverTraffic: {
      ...computeCost(groundTruth),
      effectiveness: analyzeCoverTrafficEffectiveness(groundTruth, results)
    },
    
    // Graph reconstruction metrics
    graphReconstruction: {
      ...results.graphReconstruction,
      accuracy: compareGraphs(results.estimatedGraph, actualGraph)
    }
  };
}

// Run a single experiment
async function runOneConfig({ 
  N, seed, obsCount, placement, poisonRate, 
  coverEnabled, Hmax = 1, T = 200 
}) {
  const outDir = path.join(process.cwd(), 'out');
  ensureDir(outDir);

  const net = new NetworkTemporal(N);
  const prot = new Protocol(8, 10, true, true, 'none', 'max', true, false, true);
  
  await net.run(prot, { T: 1, cover: { enabled: false } }, null);
  const graph = net.socialGraph;

  let observedNodes = [];
  switch (placement) {
    case 'high-degree':
      observedNodes = pickHighDegreeObservers(graph, obsCount);
      break;
    case 'cluster':
      observedNodes = pickClusterObservers(graph, obsCount);
      break;
    default:
      observedNodes = pickRandomObservers(N, obsCount);
  }

  const adv = new AdversaryLP(observedNodes, { delta: 1 });
  const opts = {
    T,
    seed,
    noiseEdgesPerEpoch: 0,
    Hmax,
    cover: { 
      enabled: coverEnabled,
      // Light Poisson: Just add 30% extra volume to each link
      targetMultiplier: 0.3,      // Add 30% extra (1.3× total)
      minTarget: 0.2,             // Minimum 0.2 messages per window
      maxTarget: 1.0,             // Maximum 1 message per window
      windowSize: 20,             // Look-back window (20 epochs)
      noiseStddev: 0.3,           // Small noise for naturalness
      probabilityThreshold: 0.6   // Add cover 60% of the time
    }
  };

  const { sentLog } = await net.run(prot, opts, adv);
  const res = adv.results(sentLog);
  
  // Enhanced evaluation
  const evaluation = evaluateExperiment(res, sentLog, graph);

  // Add ground truth reference
  const groundTruthInfo = {
    metadata: net.groundTruthMetadata,
    statistics: net.groundTruthStats,
    filename: net.groundTruthMetadata?.filename || `graph_N${N}_seed${seed}_0_02-0_08-0_2.json`
  };

  const fname = `enhanced_Hmax-${Hmax}_N-${N}_seed-${seed}_obs-${obsCount}_pl-${placement}_cov-${coverEnabled ? poisonRate : 0}.json`;
  const fpath = path.join(outDir, fname);
  fs.writeFileSync(fpath, JSON.stringify({
    params: { N, seed, obsCount, placement, poisonRate, coverEnabled, Hmax, T },
    results: evaluation,
    groundTruth: groundTruthInfo,
    observer_log: res.contactLog.slice(0, 100), // Limit size
    sample_messages: sentLog.slice(0, 10).map(epoch => epoch.slice(0, 5)) // Sample only
  }, null, 2));
  
  console.log(
    `${fname}\n` +
    `  acc=${(res.accuracy * 100).toFixed(2)}%  ` +
    `total=${res.total}  ` +
    `dummy=${(evaluation.coverTraffic.dummyFraction * 100).toFixed(2)}%  ` +
    `replies=${evaluation.conversations.totalReplies}  ` +
    `avgPath=${evaluation.routing.avgPathLength.toFixed(2)}  ` +
    `graphF1=${(evaluation.graphReconstruction.accuracy.f1Score * 100).toFixed(1)}%`
  );
  
  return evaluation;
}

// Main experiment sweep
async function sweep() {
  ensureDir(path.join(process.cwd(), 'out'));
  
  // Smaller parameter space for testing
  const N_values = [50, 75, 100, 150, 200, 300, 400];
  const Hmax_values = [1, 3];
  const seeds = [3, 21, 9, 28, 20, 76, 71, 7 , 1, 99];
  const obsCounts = [5];
  const placements = ['random', 'high-degree', 'cluster'];
  const poisonRates = [0, 0.05, 0.1];
  
  const total = N_values.length * Hmax_values.length * seeds.length * 
                obsCounts.length * placements.length * poisonRates.length;
  console.log(`Running ${total} enhanced experiments...\n`);
  
  const allResults = [];
  
  for (const N of N_values) {
    for (const Hmax of Hmax_values) {
      for (const seed of seeds) {
        for (const obsCount of obsCounts) {
          for (const placement of placements) {
            for (const pr of poisonRates) {
              const coverEnabled = (pr > 0);
              try {
                const result = await runOneConfig({ 
                  N, seed, obsCount, placement,
                  poisonRate: pr, coverEnabled, Hmax, T: 200 
                });
                allResults.push({
                  params: { N, Hmax, seed, obsCount, placement, pr },
                  ...result
                });
              } catch (e) {
                console.error('Error:', { N, Hmax, seed, obsCount, placement, pr });
                console.error(e.message);
              }
            }
          }
        }
      }
    }
  }
  
  // Save summary
  const summary = {
    totalExperiments: allResults.length,
    avgAccuracy: allResults.reduce((sum, r) => sum + r.accuracy, 0) / allResults.length,
    avgDummyFraction: allResults.reduce((sum, r) => sum + r.coverTraffic.dummyFraction, 0) / allResults.length,
    avgGraphF1: allResults.reduce((sum, r) => sum + r.graphReconstruction.accuracy.f1Score, 0) / allResults.length,
    avgReplies: allResults.reduce((sum, r) => sum + r.conversations.totalReplies, 0) / allResults.length
  };
  
  fs.writeFileSync(
    path.join(process.cwd(), 'out', 'summary.json'),
    JSON.stringify(summary, null, 2)
  );
  
  console.log('\n=== SUMMARY ===');
  console.log(`Total experiments: ${summary.totalExperiments}`);
  console.log(`Avg accuracy: ${(summary.avgAccuracy * 100).toFixed(2)}%`);
  console.log(`Avg dummy fraction: ${(summary.avgDummyFraction * 100).toFixed(2)}%`);
  console.log(`Avg graph F1: ${(summary.avgGraphF1 * 100).toFixed(2)}%`);
  console.log(`Avg replies per exp: ${summary.avgReplies.toFixed(1)}`);
}

sweep().catch(e => { 
  console.error(e); 
  process.exit(1); 
});