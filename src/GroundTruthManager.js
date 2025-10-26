// GroundTruthManager.js - Manages deterministic social graph generation and storage

import fs from 'fs';
import path from 'path';
import { getTieredMeshGraph } from './socialGraph.js';

/**
 * Manages ground truth social graphs with deterministic generation and persistence
 */
export class GroundTruthManager {
  constructor(groundTruthDir = './ground_truth') {
    this.groundTruthDir = groundTruthDir;
    this.ensureDirectory();
  }

  /**
   * Ensure ground truth directory exists
   */
  ensureDirectory() {
    if (!fs.existsSync(this.groundTruthDir)) {
      fs.mkdirSync(this.groundTruthDir, { recursive: true });
      console.log(`✓ Created ground truth directory: ${this.groundTruthDir}`);
    }
  }

  /**
   * Generate filename for a given configuration
   */
  getFilename(N, seed, tierProb) {
    const probStr = `${tierProb.pIntimate}-${tierProb.pFriend}-${tierProb.pAcquaintance}`.replace(/\./g, '_');
    return `graph_N${N}_seed${seed}_${probStr}.json`;
  }

  /**
   * Check if ground truth exists for this configuration
   */
  exists(N, seed, tierProb) {
    const filename = this.getFilename(N, seed, tierProb);
    const filepath = path.join(this.groundTruthDir, filename);
    return fs.existsSync(filepath);
  }

  /**
   * Load existing ground truth from disk
   */
  load(N, seed, tierProb) {
    const filename = this.getFilename(N, seed, tierProb);
    const filepath = path.join(this.groundTruthDir, filename);

    if (!fs.existsSync(filepath)) {
      throw new Error(`Ground truth file not found: ${filename}`);
    }

    console.log(`📂 Loading ground truth: ${filename}`);
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

    // Reconstruct Map objects from plain objects
    const graph = new Map();
    for (const [nodeId, neighbors] of Object.entries(data.graph)) {
      graph.set(parseInt(nodeId), neighbors);
    }

    const tierMap = new Map();
    for (const [nodeId, tiers] of Object.entries(data.tierMap)) {
      const nodeTierMap = new Map();
      for (const [neighborId, tier] of Object.entries(tiers)) {
        nodeTierMap.set(parseInt(neighborId), tier);
      }
      tierMap.set(parseInt(nodeId), nodeTierMap);
    }

    return {
      graph,
      tierMap,
      metadata: data.metadata,
      statistics: data.statistics
    };
  }

  /**
   * Generate and save new ground truth
   */
  generate(users, N, seed, tierProb) {
    console.log(`🎲 Generating new ground truth: N=${N}, seed=${seed}`);

    // Generate the graph
    const { graph, tierMap } = getTieredMeshGraph(users, {
      pIntimate: tierProb.pIntimate,
      pFriend: tierProb.pFriend,
      pAcquaintance: tierProb.pAcquaintance,
      pBridge: tierProb.pBridge || 0.01,
      seed: seed
    });

    // Calculate statistics
    const stats = this.calculateStatistics(graph, tierMap, N);

    // Prepare for saving (convert Maps to plain objects)
    const graphObj = {};
    for (const [nodeId, neighbors] of graph.entries()) {
      graphObj[nodeId] = Array.from(neighbors);
    }

    const tierMapObj = {};
    for (const [nodeId, tiers] of tierMap.entries()) {
      tierMapObj[nodeId] = {};
      for (const [neighborId, tier] of tiers.entries()) {
        tierMapObj[nodeId][neighborId] = tier;
      }
    }

    const groundTruth = {
      metadata: {
        N,
        seed,
        tierProbabilities: tierProb,
        generatedAt: new Date().toISOString(),
        version: '1.0'
      },
      graph: graphObj,
      tierMap: tierMapObj,
      statistics: stats
    };

    // Save to disk
    this.save(N, seed, tierProb, groundTruth);

    return { graph, tierMap, metadata: groundTruth.metadata, statistics: stats };
  }

  /**
   * Save ground truth to disk
   */
  save(N, seed, tierProb, groundTruth) {
    const filename = this.getFilename(N, seed, tierProb);
    const filepath = path.join(this.groundTruthDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(groundTruth, null, 2));
    console.log(`💾 Saved ground truth: ${filename}`);
    console.log(`   Nodes: ${N}, Edges: ${groundTruth.statistics.totalEdges}, Avg Degree: ${groundTruth.statistics.avgDegree.toFixed(2)}`);
  }

  /**
   * Get or create ground truth (main method to use)
   */
  getOrCreate(users, N, seed, tierProb) {
    if (this.exists(N, seed, tierProb)) {
      // Load existing
      return this.load(N, seed, tierProb);
    } else {
      // Generate new
      return this.generate(users, N, seed, tierProb);
    }
  }

  /**
   * Calculate graph statistics
   */
  calculateStatistics(graph, tierMap, N) {
    const stats = {
      totalNodes: N,
      totalEdges: 0,
      avgDegree: 0,
      minDegree: Infinity,
      maxDegree: 0,
      degreeDistribution: {},
      tierDistribution: {
        intimate: 0,
        friend: 0,
        acquaintance: 0
      },
      components: null,
      diameter: null,
      clustering: null
    };

    // Degree statistics
    const degrees = [];
    for (const [nodeId, neighbors] of graph.entries()) {
      const degree = neighbors.length;
      degrees.push(degree);
      
      stats.totalEdges += degree;
      stats.minDegree = Math.min(stats.minDegree, degree);
      stats.maxDegree = Math.max(stats.maxDegree, degree);
      
      if (!stats.degreeDistribution[degree]) {
        stats.degreeDistribution[degree] = 0;
      }
      stats.degreeDistribution[degree]++;
    }

    stats.totalEdges = Math.floor(stats.totalEdges / 2); // Each edge counted twice
    stats.avgDegree = degrees.reduce((a, b) => a + b, 0) / degrees.length;

    // Tier distribution
    for (const [nodeId, tiers] of tierMap.entries()) {
      for (const [neighborId, tier] of tiers.entries()) {
        if (nodeId < neighborId) { // Count each edge once
          stats.tierDistribution[tier]++;
        }
      }
    }

    // Graph connectivity
    stats.components = this.countComponents(graph, N);
    stats.diameter = this.calculateDiameter(graph, N);
    stats.clustering = this.calculateClusteringCoefficient(graph);

    return stats;
  }

  /**
   * Count connected components
   */
  countComponents(graph, N) {
    const visited = new Set();
    let components = 0;

    const dfs = (node) => {
      visited.add(node);
      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        }
      }
    };

    for (let i = 0; i < N; i++) {
      if (!visited.has(i)) {
        components++;
        dfs(i);
      }
    }

    return components;
  }

  /**
   * Calculate graph diameter (longest shortest path)
   */
  calculateDiameter(graph, N) {
    let maxDistance = 0;

    // Sample approach: check from random nodes (full all-pairs is O(N^3))
    const sampleSize = Math.min(20, N);
    const samples = [];
    for (let i = 0; i < sampleSize; i++) {
      samples.push(Math.floor(Math.random() * N));
    }

    for (const start of samples) {
      const distances = new Map();
      const queue = [start];
      distances.set(start, 0);

      while (queue.length > 0) {
        const current = queue.shift();
        const dist = distances.get(current);

        const neighbors = graph.get(current) || [];
        for (const neighbor of neighbors) {
          if (!distances.has(neighbor)) {
            distances.set(neighbor, dist + 1);
            queue.push(neighbor);
            maxDistance = Math.max(maxDistance, dist + 1);
          }
        }
      }
    }

    return maxDistance;
  }

  /**
   * Calculate average clustering coefficient
   */
  calculateClusteringCoefficient(graph) {
    let totalCoefficient = 0;
    let nodeCount = 0;

    for (const [nodeId, neighbors] of graph.entries()) {
      if (neighbors.length < 2) continue;

      const neighborsSet = new Set(neighbors);
      let triangles = 0;
      let possibleTriangles = 0;

      // Count triangles
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          possibleTriangles++;
          const n1Neighbors = graph.get(neighbors[i]) || [];
          if (n1Neighbors.includes(neighbors[j])) {
            triangles++;
          }
        }
      }

      if (possibleTriangles > 0) {
        totalCoefficient += triangles / possibleTriangles;
        nodeCount++;
      }
    }

    return nodeCount > 0 ? totalCoefficient / nodeCount : 0;
  }

  /**
   * List all available ground truth files
   */
  listGroundTruths() {
    const files = fs.readdirSync(this.groundTruthDir)
      .filter(f => f.startsWith('graph_') && f.endsWith('.json'));

    console.log(`\n📂 Available Ground Truth Files (${files.length}):`);
    console.log('=' .repeat(80));

    for (const file of files) {
      const filepath = path.join(this.groundTruthDir, file);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      const meta = data.metadata;
      const stats = data.statistics;

      console.log(`\n${file}`);
      console.log(`  N=${meta.N}, seed=${meta.seed}`);
      console.log(`  Edges: ${stats.totalEdges}, Avg Degree: ${stats.avgDegree.toFixed(2)}`);
      console.log(`  Tiers: ${stats.tierDistribution.intimate} intimate, ${stats.tierDistribution.friend} friend, ${stats.tierDistribution.acquaintance} acquaintance`);
      console.log(`  Components: ${stats.components}, Diameter: ${stats.diameter}, Clustering: ${stats.clustering.toFixed(3)}`);
    }

    console.log('\n' + '='.repeat(80));
  }

  /**
   * Export ground truth to various formats
   */
  exportGroundTruth(N, seed, tierProb, format = 'edgelist') {
    const data = this.load(N, seed, tierProb);
    const basename = this.getFilename(N, seed, tierProb).replace('.json', '');

    switch (format) {
      case 'edgelist':
        return this.exportEdgeList(data, basename);
      case 'adjacency':
        return this.exportAdjacencyMatrix(data, basename);
      case 'gml':
        return this.exportGML(data, basename);
      case 'graphml':
        return this.exportGraphML(data, basename);
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  /**
   * Export as edge list
   */
  exportEdgeList(data, basename) {
    const lines = ['# source target tier'];
    const seen = new Set();

    for (const [nodeId, neighbors] of Object.entries(data.graph)) {
      const node = parseInt(nodeId);
      for (const neighbor of neighbors) {
        if (node < neighbor) {
          const edge = `${node}-${neighbor}`;
          if (!seen.has(edge)) {
            const tier = data.tierMap[nodeId][neighbor];
            lines.push(`${node} ${neighbor} ${tier}`);
            seen.add(edge);
          }
        }
      }
    }

    const filepath = path.join(this.groundTruthDir, `${basename}.edgelist`);
    fs.writeFileSync(filepath, lines.join('\n'));
    console.log(`✓ Exported edge list: ${basename}.edgelist`);
    return filepath;
  }

  /**
   * Export as adjacency matrix (CSV)
   */
  exportAdjacencyMatrix(data, basename) {
    const N = data.metadata.N;
    const matrix = Array(N).fill(0).map(() => Array(N).fill(0));

    for (const [nodeId, neighbors] of Object.entries(data.graph)) {
      const node = parseInt(nodeId);
      for (const neighbor of neighbors) {
        matrix[node][neighbor] = 1;
      }
    }

    const lines = matrix.map(row => row.join(','));
    const filepath = path.join(this.groundTruthDir, `${basename}.csv`);
    fs.writeFileSync(filepath, lines.join('\n'));
    console.log(`✓ Exported adjacency matrix: ${basename}.csv`);
    return filepath;
  }

  /**
   * Export as GML (Graph Modeling Language)
   */
  exportGML(data, basename) {
    const lines = [
      'graph [',
      '  directed 0',
      '  multigraph 0'
    ];

    // Nodes
    for (let i = 0; i < data.metadata.N; i++) {
      lines.push('  node [');
      lines.push(`    id ${i}`);
      lines.push(`    label "Node${i}"`);
      lines.push('  ]');
    }

    // Edges
    const seen = new Set();
    for (const [nodeId, neighbors] of Object.entries(data.graph)) {
      const node = parseInt(nodeId);
      for (const neighbor of neighbors) {
        if (node < neighbor) {
          const edge = `${node}-${neighbor}`;
          if (!seen.has(edge)) {
            const tier = data.tierMap[nodeId][neighbor];
            lines.push('  edge [');
            lines.push(`    source ${node}`);
            lines.push(`    target ${neighbor}`);
            lines.push(`    tier "${tier}"`);
            lines.push('  ]');
            seen.add(edge);
          }
        }
      }
    }

    lines.push(']');

    const filepath = path.join(this.groundTruthDir, `${basename}.gml`);
    fs.writeFileSync(filepath, lines.join('\n'));
    console.log(`✓ Exported GML: ${basename}.gml`);
    return filepath;
  }

  /**
   * Export as GraphML
   */
  exportGraphML(data, basename) {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
      '  <key id="tier" for="edge" attr.name="tier" attr.type="string"/>',
      '  <graph id="G" edgedefault="undirected">'
    ];

    // Nodes
    for (let i = 0; i < data.metadata.N; i++) {
      lines.push(`    <node id="n${i}"/>`);
    }

    // Edges
    const seen = new Set();
    let edgeId = 0;
    for (const [nodeId, neighbors] of Object.entries(data.graph)) {
      const node = parseInt(nodeId);
      for (const neighbor of neighbors) {
        if (node < neighbor) {
          const edge = `${node}-${neighbor}`;
          if (!seen.has(edge)) {
            const tier = data.tierMap[nodeId][neighbor];
            lines.push(`    <edge id="e${edgeId}" source="n${node}" target="n${neighbor}">`);
            lines.push(`      <data key="tier">${tier}</data>`);
            lines.push('    </edge>');
            seen.add(edge);
            edgeId++;
          }
        }
      }
    }

    lines.push('  </graph>');
    lines.push('</graphml>');

    const filepath = path.join(this.groundTruthDir, `${basename}.graphml`);
    fs.writeFileSync(filepath, lines.join('\n'));
    console.log(`✓ Exported GraphML: ${basename}.graphml`);
    return filepath;
  }
}

export default GroundTruthManager;