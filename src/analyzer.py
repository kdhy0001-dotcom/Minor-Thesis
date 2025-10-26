#!/usr/bin/env python3
"""
Analyzer for privacy experiment results
Generates plots and tables organized by seed
"""

import json
import os
import sys
import glob
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from collections import defaultdict

# Set style for better looking plots
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")

class ExperimentAnalyzer:
    def __init__(self, data_dir='out', output_dir='analysis'):
        self.data_dir = Path(data_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Load all experiment data
        self.data = self.load_all_data()
        
        # Group by seed for per-seed analysis
        self.data_by_seed = self.group_by_seed()
        
    def load_all_data(self):
        """Load all JSON result files"""
        pattern = str(self.data_dir / '*.json')
        files = glob.glob(pattern)
        
        if not files:
            print(f"No JSON files found in {self.data_dir}")
            return []
        
        data = []
        for filepath in files:
            if 'summary' in filepath:
                continue  # Skip summary file
                
            try:
                with open(filepath, 'r') as f:
                    result = json.load(f)
                    # Extract key parameters from filename
                    filename = os.path.basename(filepath)
                    parts = filename.replace('.json', '').split('_')
                    
                    # Parse filename components
                    params_dict = {}
                    for part in parts:
                        if '-' in part:
                            key, value = part.split('-', 1)
                            params_dict[key] = value
                    
                    result['filename'] = filename
                    result['params_from_file'] = params_dict
                    data.append(result)
            except Exception as e:
                print(f"Error loading {filepath}: {e}")
                
        print(f"Loaded {len(data)} experiment files")
        return data
    
    def group_by_seed(self):
        """Group experiments by seed"""
        by_seed = defaultdict(list)
        
        for exp in self.data:
            if 'params' in exp:
                seed = exp['params'].get('seed', 'unknown')
            else:
                # Try to extract from filename
                seed = exp['params_from_file'].get('seed', 'unknown')
            
            by_seed[seed].append(exp)
        
        return by_seed
    
    def create_seed_folder(self, seed):
        """Create output folder for a specific seed"""
        seed_dir = self.output_dir / f"seed_{seed}"
        seed_dir.mkdir(exist_ok=True)
        return seed_dir
    
    def analyze_seed(self, seed, experiments):
        """Analyze all experiments for a specific seed"""
        print(f"\n{'='*60}")
        print(f"Analyzing Seed {seed}: {len(experiments)} experiments")
        print('='*60)
        
        # Create output directory for this seed
        seed_dir = self.create_seed_folder(seed)
        
        # Extract data for analysis
        df_data = []
        for exp in experiments:
            params = exp.get('params', {})
            results = exp.get('results', {})
            
            row = {
                'N': params.get('N', 0),
                'Hmax': params.get('Hmax', 0),
                'obs_count': params.get('obsCount', 0),
                'placement': params.get('placement', 'unknown'),
                'cover_enabled': params.get('coverEnabled', False),
                'poison_rate': params.get('poisonRate', 0),
                
                # Basic metrics
                'accuracy': results.get('accuracy', 0),
                'total_guesses': results.get('total', 0),
                'correct_guesses': results.get('correct', 0),
                
                # Cover traffic metrics
                'total_messages': results.get('coverTraffic', {}).get('totalMessages', 0),
                'dummy_messages': results.get('coverTraffic', {}).get('dummyMessages', 0),
                'dummy_fraction': results.get('coverTraffic', {}).get('dummyFraction', 0),
                
                # Graph reconstruction metrics
                'graph_precision': results.get('graphReconstruction', {}).get('accuracy', {}).get('precision', 0),
                'graph_recall': results.get('graphReconstruction', {}).get('accuracy', {}).get('recall', 0),
                'graph_f1': results.get('graphReconstruction', {}).get('accuracy', {}).get('f1Score', 0),
                'estimated_nodes': results.get('graphReconstruction', {}).get('totalNodes', 0),
                'estimated_edges': results.get('graphReconstruction', {}).get('totalEdges', 0),
                'avg_confidence': results.get('graphReconstruction', {}).get('avgConfidence', 0),
                
                # Conversation metrics
                'total_replies': results.get('conversations', {}).get('totalReplies', 0),
                'avg_reply_delay': results.get('conversations', {}).get('avgReplyDelay', 0),
                'conversation_threads': results.get('conversations', {}).get('conversationThreads', 0),
                
                # Routing metrics
                'avg_path_length': results.get('routing', {}).get('avgPathLength', 0),
                'path_diversity': results.get('routing', {}).get('pathDiversity', 0),
            }
            df_data.append(row)
        
        df = pd.DataFrame(df_data)
        
        # Generate plots
        self.plot_accuracy_vs_n(df, seed_dir, seed)
        self.plot_accuracy_by_placement(df, seed_dir, seed)
        self.plot_cover_traffic_impact(df, seed_dir, seed)
        self.plot_graph_reconstruction(df, seed_dir, seed)
        self.plot_hmax_impact(df, seed_dir, seed)
        
        # Generate tables
        self.generate_summary_table(df, seed_dir, seed)
        self.generate_detailed_metrics_table(df, seed_dir, seed)
        
        # Save raw dataframe
        df.to_csv(seed_dir / 'raw_data.csv', index=False)
        
        return df
    
    def plot_accuracy_vs_n(self, df, output_dir, seed):
        """Plot adversary accuracy vs network size N"""
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # Group by N and cover traffic
        for cover in df['cover_enabled'].unique():
            data = df[df['cover_enabled'] == cover]
            
            # Average across other parameters
            grouped = data.groupby('N').agg({
                'accuracy': ['mean', 'std'],
                'graph_f1': ['mean', 'std']
            }).reset_index()
            
            label = 'With Cover' if cover else 'No Cover'
            color = 'blue' if cover else 'red'
            
            # Plot accuracy
            ax1.errorbar(grouped['N'], 
                        grouped['accuracy']['mean'],
                        yerr=grouped['accuracy']['std'],
                        marker='o', label=label, color=color,
                        capsize=5, capthick=2)
            
            # Plot graph F1
            ax2.errorbar(grouped['N'],
                        grouped['graph_f1']['mean'],
                        yerr=grouped['graph_f1']['std'],
                        marker='s', label=label, color=color,
                        capsize=5, capthick=2)
        
        ax1.set_xlabel('Network Size (N)')
        ax1.set_ylabel('Adversary Accuracy')
        ax1.set_title(f'Message Inference Accuracy vs Network Size (Seed {seed})')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        ax1.set_ylim([0, 1])
        
        ax2.set_xlabel('Network Size (N)')
        ax2.set_ylabel('Graph Reconstruction F1 Score')
        ax2.set_title(f'Graph Reconstruction Quality vs Network Size (Seed {seed})')
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        ax2.set_ylim([0, 1])
        
        plt.tight_layout()
        plt.savefig(output_dir / 'accuracy_vs_n.png', dpi=150, bbox_inches='tight')
        plt.close()
    
    def plot_accuracy_by_placement(self, df, output_dir, seed):
        """Plot accuracy by observer placement strategy"""
        fig, ax = plt.subplots(figsize=(10, 6))
        
        # Group by placement and cover
        placements = df['placement'].unique()
        x_pos = np.arange(len(placements))
        width = 0.35
        
        for i, cover in enumerate(df['cover_enabled'].unique()):
            data = df[df['cover_enabled'] == cover]
            means = []
            stds = []
            
            for placement in placements:
                subset = data[data['placement'] == placement]
                means.append(subset['accuracy'].mean())
                stds.append(subset['accuracy'].std())
            
            label = 'With Cover' if cover else 'No Cover'
            offset = width/2 if i == 0 else -width/2
            ax.bar(x_pos + offset, means, width, label=label,
                  yerr=stds, capsize=5, alpha=0.8)
        
        ax.set_xlabel('Observer Placement Strategy')
        ax.set_ylabel('Adversary Accuracy')
        ax.set_title(f'Impact of Observer Placement (Seed {seed})')
        ax.set_xticks(x_pos)
        ax.set_xticklabels(placements)
        ax.legend()
        ax.grid(True, alpha=0.3, axis='y')
        ax.set_ylim([0, 1])
        
        plt.tight_layout()
        plt.savefig(output_dir / 'accuracy_by_placement.png', dpi=150, bbox_inches='tight')
        plt.close()
    
    def plot_cover_traffic_impact(self, df, output_dir, seed):
        """Plot the impact of cover traffic"""
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(14, 10))
        
        # Filter to only experiments with cover traffic data
        cover_data = df[df['cover_enabled'] == True]
        no_cover_data = df[df['cover_enabled'] == False]
        
        # 1. Dummy fraction vs accuracy
        if not cover_data.empty:
            ax1.scatter(cover_data['dummy_fraction'], cover_data['accuracy'], alpha=0.6)
            ax1.set_xlabel('Fraction of Dummy Messages')
            ax1.set_ylabel('Adversary Accuracy')
            ax1.set_title('Accuracy vs Cover Traffic Volume')
            ax1.grid(True, alpha=0.3)
        
        # 2. Compare accuracy distributions
        data_to_plot = []
        labels = []
        if not no_cover_data.empty:
            data_to_plot.append(no_cover_data['accuracy'])
            labels.append('No Cover')
        if not cover_data.empty:
            data_to_plot.append(cover_data['accuracy'])
            labels.append('With Cover')
        
        if data_to_plot:
            bp = ax2.boxplot(data_to_plot, labels=labels, patch_artist=True)
            for patch, color in zip(bp['boxes'], ['red', 'blue'][:len(bp['boxes'])]):
                patch.set_facecolor(color)
                patch.set_alpha(0.5)
            ax2.set_ylabel('Adversary Accuracy')
            ax2.set_title('Accuracy Distribution')
            ax2.grid(True, alpha=0.3, axis='y')
        
        # 3. Message overhead
        if not cover_data.empty:
            grouped = cover_data.groupby('N').agg({
                'total_messages': 'mean',
                'dummy_messages': 'mean'
            }).reset_index()
            
            x = np.arange(len(grouped))
            ax3.bar(x - 0.2, grouped['total_messages'], 0.4, label='Total', alpha=0.8)
            ax3.bar(x + 0.2, grouped['dummy_messages'], 0.4, label='Dummy', alpha=0.8)
            ax3.set_xlabel('Network Size (N)')
            ax3.set_ylabel('Number of Messages')
            ax3.set_title('Message Overhead from Cover Traffic')
            ax3.set_xticks(x)
            ax3.set_xticklabels(grouped['N'])
            ax3.legend()
            ax3.grid(True, alpha=0.3, axis='y')
        
        # 4. Privacy preservation
        all_data = df.groupby(['N', 'cover_enabled']).agg({
            'accuracy': 'mean'
        }).reset_index()
        
        for cover in all_data['cover_enabled'].unique():
            data = all_data[all_data['cover_enabled'] == cover]
            privacy_preserved = 1 - data['accuracy']
            label = 'With Cover' if cover else 'No Cover'
            ax4.plot(data['N'], privacy_preserved, marker='o', label=label)
        
        ax4.set_xlabel('Network Size (N)')
        ax4.set_ylabel('Privacy Preserved (1 - Accuracy)')
        ax4.set_title('Privacy Preservation')
        ax4.legend()
        ax4.grid(True, alpha=0.3)
        ax4.set_ylim([0, 1])
        
        plt.suptitle(f'Cover Traffic Analysis (Seed {seed})', fontsize=14, y=1.02)
        plt.tight_layout()
        plt.savefig(output_dir / 'cover_traffic_impact.png', dpi=150, bbox_inches='tight')
        plt.close()
    
    def plot_graph_reconstruction(self, df, output_dir, seed):
        """Plot graph reconstruction metrics"""
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(14, 10))
        
        # 1. Precision vs Recall scatter
        ax1.scatter(df['graph_recall'], df['graph_precision'], 
                   c=df['N'], cmap='viridis', alpha=0.6)
        ax1.set_xlabel('Recall')
        ax1.set_ylabel('Precision')
        ax1.set_title('Graph Reconstruction: Precision vs Recall')
        ax1.grid(True, alpha=0.3)
        ax1.set_xlim([0, 1])
        ax1.set_ylim([0, 1])
        cbar = plt.colorbar(ax1.scatter(df['graph_recall'], df['graph_precision'], 
                                        c=df['N'], cmap='viridis', alpha=0.6), ax=ax1)
        cbar.set_label('Network Size (N)')
        
        # 2. F1 Score by configuration
        grouped = df.groupby(['placement', 'cover_enabled']).agg({
            'graph_f1': ['mean', 'std']
        }).reset_index()
        
        x_labels = [f"{p}\n{'Cover' if c else 'No Cover'}" 
                   for p, c in zip(grouped['placement'], grouped['cover_enabled'])]
        x_pos = np.arange(len(x_labels))
        
        ax2.bar(x_pos, grouped['graph_f1']['mean'], 
               yerr=grouped['graph_f1']['std'],
               capsize=5, alpha=0.8)
        ax2.set_xticks(x_pos)
        ax2.set_xticklabels(x_labels, rotation=45, ha='right')
        ax2.set_ylabel('F1 Score')
        ax2.set_title('Graph Reconstruction Quality by Configuration')
        ax2.grid(True, alpha=0.3, axis='y')
        ax2.set_ylim([0, 1])
        
        # 3. Confidence vs Accuracy
        ax3.scatter(df['avg_confidence'], df['graph_f1'], alpha=0.6)
        ax3.set_xlabel('Average Confidence')
        ax3.set_ylabel('F1 Score')
        ax3.set_title('Reconstruction Confidence vs Quality')
        ax3.grid(True, alpha=0.3)
        
        # 4. Edge detection by network size
        grouped_n = df.groupby('N').agg({
            'estimated_edges': 'mean',
            'graph_recall': 'mean'
        }).reset_index()
        
        ax4_twin = ax4.twinx()
        line1 = ax4.plot(grouped_n['N'], grouped_n['estimated_edges'], 
                        'b-', marker='o', label='Estimated Edges')
        line2 = ax4_twin.plot(grouped_n['N'], grouped_n['graph_recall'], 
                             'r-', marker='s', label='Recall')
        
        ax4.set_xlabel('Network Size (N)')
        ax4.set_ylabel('Number of Estimated Edges', color='b')
        ax4_twin.set_ylabel('Recall', color='r')
        ax4.set_title('Edge Detection Performance')
        ax4.tick_params(axis='y', labelcolor='b')
        ax4_twin.tick_params(axis='y', labelcolor='r')
        ax4.grid(True, alpha=0.3)
        
        # Combine legends
        lines = line1 + line2
        labels = [l.get_label() for l in lines]
        ax4.legend(lines, labels, loc='upper left')
        
        plt.suptitle(f'Graph Reconstruction Analysis (Seed {seed})', fontsize=14, y=1.02)
        plt.tight_layout()
        plt.savefig(output_dir / 'graph_reconstruction.png', dpi=150, bbox_inches='tight')
        plt.close()
    
    def plot_hmax_impact(self, df, output_dir, seed):
        """Plot the impact of Hmax parameter"""
        if 'Hmax' not in df.columns or df['Hmax'].nunique() <= 1:
            return  # Skip if Hmax not varied
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # Group by Hmax
        grouped = df.groupby(['Hmax', 'cover_enabled']).agg({
            'accuracy': ['mean', 'std'],
            'avg_path_length': ['mean', 'std']
        }).reset_index()
        
        for cover in grouped['cover_enabled'].unique():
            data = grouped[grouped['cover_enabled'] == cover]
            label = 'With Cover' if cover else 'No Cover'
            
            # Accuracy vs Hmax
            ax1.errorbar(data['Hmax'], data['accuracy']['mean'],
                        yerr=data['accuracy']['std'],
                        marker='o', label=label, capsize=5)
            
            # Path length vs Hmax
            ax2.errorbar(data['Hmax'], data['avg_path_length']['mean'],
                        yerr=data['avg_path_length']['std'],
                        marker='s', label=label, capsize=5)
        
        ax1.set_xlabel('Hmax (Max Hops)')
        ax1.set_ylabel('Adversary Accuracy')
        ax1.set_title(f'Impact of Hop Limit on Privacy (Seed {seed})')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        ax1.set_ylim([0, 1])
        
        ax2.set_xlabel('Hmax (Max Hops)')
        ax2.set_ylabel('Average Path Length')
        ax2.set_title(f'Routing Path Length vs Hop Limit (Seed {seed})')
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(output_dir / 'hmax_impact.png', dpi=150, bbox_inches='tight')
        plt.close()
    
    def generate_summary_table(self, df, output_dir, seed):
        """Generate summary statistics table"""
        summary = df.groupby(['N', 'placement', 'cover_enabled']).agg({
            'accuracy': ['mean', 'std', 'min', 'max'],
            'graph_f1': ['mean', 'std'],
            'dummy_fraction': 'mean',
            'total_messages': 'mean'
        }).round(3)
        
        # Save as CSV
        summary.to_csv(output_dir / 'summary_table.csv')
        
        # Save as formatted text
        with open(output_dir / 'summary_table.txt', 'w') as f:
            f.write(f"Summary Statistics for Seed {seed}\n")
            f.write("="*80 + "\n\n")
            f.write(summary.to_string())
            f.write("\n\n")
            
            # Add key insights
            f.write("Key Insights:\n")
            f.write("-"*40 + "\n")
            
            best_privacy = df.loc[df['accuracy'].idxmin()]
            f.write(f"Best Privacy (Lowest Accuracy): {best_privacy['accuracy']:.3f}\n")
            f.write(f"  Configuration: N={best_privacy['N']}, "
                   f"Placement={best_privacy['placement']}, "
                   f"Cover={'Yes' if best_privacy['cover_enabled'] else 'No'}\n\n")
            
            worst_privacy = df.loc[df['accuracy'].idxmax()]
            f.write(f"Worst Privacy (Highest Accuracy): {worst_privacy['accuracy']:.3f}\n")
            f.write(f"  Configuration: N={worst_privacy['N']}, "
                   f"Placement={worst_privacy['placement']}, "
                   f"Cover={'Yes' if worst_privacy['cover_enabled'] else 'No'}\n\n")
            
            if df['cover_enabled'].any():
                cover_improvement = (
                    df[df['cover_enabled'] == False]['accuracy'].mean() -
                    df[df['cover_enabled'] == True]['accuracy'].mean()
                )
                f.write(f"Average Privacy Improvement from Cover Traffic: {cover_improvement:.3f}\n")
                
                overhead = df[df['cover_enabled'] == True]['dummy_fraction'].mean()
                f.write(f"Average Cover Traffic Overhead: {overhead:.1%}\n")
    
    def generate_detailed_metrics_table(self, df, output_dir, seed):
        """Generate detailed metrics table"""
        # Select key columns for detailed view
        detailed = df[[
            'N', 'Hmax', 'obs_count', 'placement', 'cover_enabled',
            'accuracy', 'graph_f1', 'graph_precision', 'graph_recall',
            'dummy_fraction', 'avg_path_length', 'path_diversity',
            'total_replies', 'conversation_threads'
        ]].round(3)
        
        # Sort by N and accuracy
        detailed = detailed.sort_values(['N', 'accuracy'])
        
        # Save as CSV
        detailed.to_csv(output_dir / 'detailed_metrics.csv', index=False)
        
        # Create LaTeX table for paper
        latex_table = detailed.head(20).to_latex(
            index=False,
            caption=f'Experimental Results for Seed {seed}',
            label=f'tab:results_seed_{seed}',
            column_format='l' * len(detailed.columns)
        )
        
        with open(output_dir / 'results_table.tex', 'w') as f:
            f.write(latex_table)
    
    def analyze_all(self):
        """Run analysis for all seeds"""
        print(f"\nFound {len(self.data_by_seed)} different seeds")
        
        all_results = []
        
        for seed in sorted(self.data_by_seed.keys()):
            experiments = self.data_by_seed[seed]
            df = self.analyze_seed(seed, experiments)
            
            # Add seed column for combined analysis
            df['seed'] = seed
            all_results.append(df)
        
        # Combine all results
        if all_results:
            combined_df = pd.concat(all_results, ignore_index=True)
            self.generate_combined_analysis(combined_df)
    
    def generate_combined_analysis(self, df):
        """Generate analysis across all seeds"""
        print("\n" + "="*60)
        print("Generating Combined Analysis Across All Seeds")
        print("="*60)
        
        # Create combined output directory
        combined_dir = self.output_dir / "combined"
        combined_dir.mkdir(exist_ok=True)
        
        # Plot accuracy variance across seeds
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # Group by seed and calculate statistics
        seed_stats = df.groupby('seed').agg({
            'accuracy': ['mean', 'std'],
            'graph_f1': ['mean', 'std']
        }).reset_index()
        
        seeds = seed_stats['seed']
        x_pos = np.arange(len(seeds))
        
        # Accuracy by seed
        ax1.bar(x_pos, seed_stats['accuracy']['mean'],
               yerr=seed_stats['accuracy']['std'],
               capsize=5, alpha=0.8)
        ax1.set_xlabel('Seed')
        ax1.set_ylabel('Mean Adversary Accuracy')
        ax1.set_title('Accuracy Variation Across Seeds')
        ax1.set_xticks(x_pos)
        ax1.set_xticklabels(seeds)
        ax1.grid(True, alpha=0.3, axis='y')
        
        # Graph F1 by seed
        ax2.bar(x_pos, seed_stats['graph_f1']['mean'],
               yerr=seed_stats['graph_f1']['std'],
               capsize=5, alpha=0.8, color='green')
        ax2.set_xlabel('Seed')
        ax2.set_ylabel('Mean Graph F1 Score')
        ax2.set_title('Graph Reconstruction Variation Across Seeds')
        ax2.set_xticks(x_pos)
        ax2.set_xticklabels(seeds)
        ax2.grid(True, alpha=0.3, axis='y')
        
        plt.tight_layout()
        plt.savefig(combined_dir / 'seed_variation.png', dpi=150, bbox_inches='tight')
        plt.close()
        
        # Overall statistics
        overall_stats = {
            'Total Experiments': len(df),
            'Seeds Analyzed': df['seed'].nunique(),
            'Mean Accuracy': df['accuracy'].mean(),
            'Std Accuracy': df['accuracy'].std(),
            'Mean Graph F1': df['graph_f1'].mean(),
            'Std Graph F1': df['graph_f1'].std(),
            'Cover Traffic Benefit': (
                df[df['cover_enabled'] == False]['accuracy'].mean() -
                df[df['cover_enabled'] == True]['accuracy'].mean()
                if df['cover_enabled'].any() else 0
            )
        }
        
        # Save overall statistics
        with open(combined_dir / 'overall_statistics.txt', 'w') as f:
            f.write("Overall Experiment Statistics\n")
            f.write("="*40 + "\n\n")
            for key, value in overall_stats.items():
                if isinstance(value, float):
                    f.write(f"{key}: {value:.4f}\n")
                else:
                    f.write(f"{key}: {value}\n")
        
        # Save combined dataframe
        df.to_csv(combined_dir / 'all_results.csv', index=False)
        
        print(f"\nAnalysis complete! Results saved to {self.output_dir}")


def main():
    # Parse command line arguments
    data_dir = sys.argv[1] if len(sys.argv) > 1 else 'out'
    output_dir = sys.argv[2] if len(sys.argv) > 2 else 'analysis'
    
    # Run analysis
    analyzer = ExperimentAnalyzer(data_dir, output_dir)
    analyzer.analyze_all()


if __name__ == "__main__":
    main()