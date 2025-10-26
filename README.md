# ASMesh Simulation Framework: Evaluating Cover Traffic for Metadata Privacy

Author: **Kanika Dhyani**   
Thesis Title: *Privacy Beyond Encryption: Evaluating a Cover Traffic
Extension to the ASMesh Protocol*  

---

## Overview

This repository contains all source code, experiment results, and analysis files used in the thesis project. It implements and extends the ASMesh protocol to evaluate whether locally generated cover traffic can defend against timing-based metadata inference in decentralized mesh networks.

The project simulates community-scale messaging across social graphs with realistic human messaging patterns, adversary observation models, and noise injection strategies.

---

## Directory Structure

│
├── src/ # Source code for simulations and protocol logic
├── output/ # JSON logs of results and ground-truth graphs
├── analysis/ # Notebooks and scripts for plotting and evaluation
└── README.md # This file


---

## Experimental Configuration

All experiment combinations submittet here were run using the following parameter grid:

```js
const N_values = [50, 75, 100, 150, 200, 300, 400];      // Network sizes
const Hmax_values = [1, 3];                             // Max hop constraints
const seeds = [3, 21, 9, 28, 20, 76, 71, 7, 1, 99];      // 10 random seeds
const obsCounts = [5];                                  // Number of adversaries
const placements = ['random', 'high-degree', 'cluster']; // Observer placement
const poisonRates = [0, 0.05, 0.1];                     // Cover traffic rates




