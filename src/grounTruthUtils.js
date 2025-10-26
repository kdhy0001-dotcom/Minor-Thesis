// - Utility script for managing ground truth files

import { GroundTruthManager } from './GroundTruthManager.js';

const manager = new GroundTruthManager('./ground_truth');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              Ground Truth Management Utility                  ║
╚═══════════════════════════════════════════════════════════════╝

Usage: node ground_truth_utils.js <command> [options]

Commands:
  list                          List all ground truth files
  
  generate N seed               Generate ground truth for N nodes with seed
  
  export N seed format          Export ground truth to format
                               Formats: edgelist, adjacency, gml, graphml
  
  stats N seed                  Show detailed statistics for a graph
  
  compare N seed1 seed2         Compare two graphs (same N, different seeds)
  
  visualize N seed              Create visualization data (for plotting)

Examples:
  node ground_truth_utils.js list
  node ground_truth_utils.js generate 100 42
  node ground_truth_utils.js export 100 42 edgelist
  node ground_truth_utils.js stats 100 42
  node ground_truth_utils.js compare 100 42 17
`);
}

async function runCommand() {
  const defaultTierProb = {
    pIntimate: 0.02,
    pFriend: 0.08,
    pAcquaintance: 0.20,
    pBridge: 0.01
  };

  switch (command) {
    case 'list':
      manager.listGroundTruths();
      break;

    case 'generate': {
      const N = parseInt(args[1]);
      const seed = parseInt(args[2]);
      
      if (!N || !seed) {
        console.error('❌ Error: Need N and seed');
        console.log('Usage: node ground_truth_utils.js generate <N> <seed>');
        process.exit(1);
      }

      console.log(`\n🎲 Generating ground truth for N=${N}, seed=${seed}...`);
      
      // Create users array
      const users = Array.from({ length: N }, (_, i) => ({ 
        id: i, 
        links: [],
        lastMeet: new Map(),
        replyQueue: [],
        pendingReplies: new Map()
      }));

      const result = manager.generate(users, N, seed, defaultTierProb);
      
      console.log('\n✓ Generation complete!');
      console.log(`\n📊 Graph Statistics:`);
      console.log(`   Nodes: ${result.statistics.totalNodes}`);
      console.log(`   Edges: ${result.statistics.totalEdges}`);
      console.log(`   Avg Degree: ${result.statistics.avgDegree.toFixed(2)}`);
      console.log(`   Min Degree: ${result.statistics.minDegree}`);
      console.log(`   Max Degree: ${result.statistics.maxDegree}`);
      console.log(`\n   Tier Distribution:`);
      console.log(`     Intimate: ${result.statistics.tierDistribution.intimate}`);
      console.log(`     Friend: ${result.statistics.tierDistribution.friend}`);
      console.log(`     Acquaintance: ${result.statistics.tierDistribution.acquaintance}`);
      console.log(`\n   Topology:`);
      console.log(`     Components: ${result.statistics.components}`);
      console.log(`     Diameter: ${result.statistics.diameter}`);
      console.log(`     Clustering: ${result.statistics.clustering.toFixed(3)}`);
      break;
    }

    case 'export': {
      const N = parseInt(args[1]);
      const seed = parseInt(args[2]);
      const format = args[3] || 'edgelist';

      if (!N || !seed) {
        console.error('❌ Error: Need N and seed');
        console.log('Usage: node ground_truth_utils.js export <N> <seed> <format>');
        process.exit(1);
      }

      console.log(`\n📤 Exporting ground truth for N=${N}, seed=${seed} to ${format}...`);
      
      try {
        const filepath = manager.exportGroundTruth(N, seed, defaultTierProb, format);
        console.log(`✓ Exported successfully: ${filepath}`);
      } catch (error) {
        console.error(`❌ Export failed: ${error.message}`);
        process.exit(1);
      }
      break;
    }

    case 'stats': {
      const N = parseInt(args[1]);
      const seed = parseInt(args[2]);

      if (!N || !seed) {
        console.error('❌ Error: Need N and seed');
        console.log('Usage: node ground_truth_utils.js stats <N> <seed>');
        process.exit(1);
      }

      try {
        const data = manager.load(N, seed, defaultTierProb);
        
        console.log('\n' + '='.repeat(70));
        console.log(`Ground Truth Statistics: N=${N}, seed=${seed}`);
        console.log('='.repeat(70));
        
        console.log(`\n📅 Metadata:`);
        console.log(`   Generated: ${data.metadata.generatedAt}`);
        console.log(`   Version: ${data.metadata.version}`);
        
        console.log(`\n📊 Basic Statistics:`);
        console.log(`   Nodes: ${data.statistics.totalNodes}`);
        console.log(`   Edges: ${data.statistics.totalEdges}`);
        console.log(`   Average Degree: ${data.statistics.avgDegree.toFixed(2)}`);
        console.log(`   Degree Range: ${data.statistics.minDegree} - ${data.statistics.maxDegree}`);
        
        console.log(`\n🔗 Relationship Tiers:`);
        console.log(`   Intimate: ${data.statistics.tierDistribution.intimate} (${(data.statistics.tierDistribution.intimate / data.statistics.totalEdges * 100).toFixed(1)}%)`);
        console.log(`   Friend: ${data.statistics.tierDistribution.friend} (${(data.statistics.tierDistribution.friend / data.statistics.totalEdges * 100).toFixed(1)}%)`);
        console.log(`   Acquaintance: ${data.statistics.tierDistribution.acquaintance} (${(data.statistics.tierDistribution.acquaintance / data.statistics.totalEdges * 100).toFixed(1)}%)`);
        
        console.log(`\n🌐 Topology:`);
        console.log(`   Connected Components: ${data.statistics.components}`);
        console.log(`   Diameter: ${data.statistics.diameter}`);
        console.log(`   Clustering Coefficient: ${data.statistics.clustering.toFixed(3)}`);
        
        console.log(`\n📈 Degree Distribution (top 10):`);
        const degDist = Object.entries(data.statistics.degreeDistribution)
          .map(([deg, count]) => ({ degree: parseInt(deg), count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        
        for (const { degree, count } of degDist) {
          const bar = '█'.repeat(Math.ceil(count / data.statistics.totalNodes * 50));
          console.log(`   Degree ${degree.toString().padStart(2)}: ${bar} ${count} nodes`);
        }
        
        console.log('\n' + '='.repeat(70));
        
      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
      }
      break;
    }

    case 'compare': {
      const N = parseInt(args[1]);
      const seed1 = parseInt(args[2]);
      const seed2 = parseInt(args[3]);

      if (!N || !seed1 || !seed2) {
        console.error('❌ Error: Need N, seed1, and seed2');
        console.log('Usage: node ground_truth_utils.js compare <N> <seed1> <seed2>');
        process.exit(1);
      }

      try {
        const data1 = manager.load(N, seed1, defaultTierProb);
        const data2 = manager.load(N, seed2, defaultTierProb);
        
        console.log('\n' + '='.repeat(70));
        console.log(`Comparing Ground Truths: N=${N}`);
        console.log('='.repeat(70));
        
        console.log(`\n📊 Graph 1 (seed=${seed1})  vs  Graph 2 (seed=${seed2})`);
        console.log('-'.repeat(70));
        
        const s1 = data1.statistics;
        const s2 = data2.statistics;
        
        console.log(`\nEdges:              ${s1.totalEdges.toString().padStart(6)} vs ${s2.totalEdges.toString().padStart(6)} (Δ ${Math.abs(s1.totalEdges - s2.totalEdges)})`);
        console.log(`Avg Degree:         ${s1.avgDegree.toFixed(2).padStart(6)} vs ${s2.avgDegree.toFixed(2).padStart(6)} (Δ ${Math.abs(s1.avgDegree - s2.avgDegree).toFixed(2)})`);
        console.log(`Components:         ${s1.components.toString().padStart(6)} vs ${s2.components.toString().padStart(6)} (Δ ${Math.abs(s1.components - s2.components)})`);
        console.log(`Diameter:           ${s1.diameter.toString().padStart(6)} vs ${s2.diameter.toString().padStart(6)} (Δ ${Math.abs(s1.diameter - s2.diameter)})`);
        console.log(`Clustering:         ${s1.clustering.toFixed(3).padStart(6)} vs ${s2.clustering.toFixed(3).padStart(6)} (Δ ${Math.abs(s1.clustering - s2.clustering).toFixed(3)})`);
        
        console.log(`\n🔗 Tier Distribution:`);
        console.log(`Intimate:           ${s1.tierDistribution.intimate.toString().padStart(6)} vs ${s2.tierDistribution.intimate.toString().padStart(6)} (Δ ${Math.abs(s1.tierDistribution.intimate - s2.tierDistribution.intimate)})`);
        console.log(`Friend:             ${s1.tierDistribution.friend.toString().padStart(6)} vs ${s2.tierDistribution.friend.toString().padStart(6)} (Δ ${Math.abs(s1.tierDistribution.friend - s2.tierDistribution.friend)})`);
        console.log(`Acquaintance:       ${s1.tierDistribution.acquaintance.toString().padStart(6)} vs ${s2.tierDistribution.acquaintance.toString().padStart(6)} (Δ ${Math.abs(s1.tierDistribution.acquaintance - s2.tierDistribution.acquaintance)})`);
        
        console.log('\n' + '='.repeat(70));
        
      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
      }
      break;
    }

    case 'visualize': {
      const N = parseInt(args[1]);
      const seed = parseInt(args[2]);

      if (!N || !seed) {
        console.error('❌ Error: Need N and seed');
        console.log('Usage: node ground_truth_utils.js visualize <N> <seed>');
        process.exit(1);
      }

      try {
        const data = manager.load(N, seed, defaultTierProb);
        
        // Export to multiple formats for visualization
        console.log(`\n🎨 Creating visualization data for N=${N}, seed=${seed}...`);
        
        manager.exportGroundTruth(N, seed, defaultTierProb, 'edgelist');
        manager.exportGroundTruth(N, seed, defaultTierProb, 'gml');
        manager.exportGroundTruth(N, seed, defaultTierProb, 'graphml');
        
        console.log(`\n✓ Visualization files created!`);
        console.log(`\nYou can now visualize the graph using:`);
        console.log(`  - Gephi: Import the .gml or .graphml file`);
        console.log(`  - NetworkX (Python): Load the .edgelist file`);
        console.log(`  - Cytoscape: Import the .graphml file`);
        
      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
      }
      break;
    }

    default:
      if (command) {
        console.error(`❌ Unknown command: ${command}\n`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// Run the command
runCommand().catch(error => {
  console.error(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});