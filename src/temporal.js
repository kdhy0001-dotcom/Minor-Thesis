// Temporal activity patterns for realistic message generation

export function createTemporalModel(config = {}) {
  const { seed = 42 } = config;
  
  // Simple PRNG for reproducibility
  function makeRNG(seed) {
    let x = seed % 2147483647;
    if (x <= 0) x += 2147483646;
    return () => {
      x = (x * 16807) % 2147483647;
      return (x - 1) / 2147483646;
    };
  }
  
  const rng = makeRNG(seed);

  // Activity multipliers by hour (0-23), modeling campus life
  // Low activity: 12am-7am (sleep)
  // Morning ramp: 8am-10am (classes start)
  // Peak activity: 2pm-3pm (between classes chaos/post lunch dread)
  // Evening decline: 8pm-11pm (winding down)
  const campusActivityPattern = [
    0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2,  // 12am-7am
    0.4, 0.8, 1.0, 1.2, 1.0, 0.6,            // 8am-1pm
    1.4, 1.3, 1.1, 0.9, 0.7, 0.5,            // 2pm-7pm
    0.4, 0.3, 0.2, 0.1                       // 8pm-11pm
  ];

  // Sample per-user daily message rates with realistic distribution
  function sampleUserMeans(numUsers, opts = {}) {
    const {
      minPerDay = 5,
      maxPerDay = 120,
      skew = 0.6,                    // bias toward lower rates
      heavyUserFraction = 0.15       // fraction of highly active users
    } = opts;

    const means = [];
    
    for (let i = 0; i < numUsers; i++) {
      if (rng() < heavyUserFraction) {
        // Heavy user: higher baseline activity
        const rate = minPerDay + rng() * (maxPerDay - minPerDay) * 0.8;
        means.push(Math.round(rate));
      } else {
        // Regular user: skewed toward lower activity
        const r = Math.pow(rng(), skew);
        const rate = minPerDay + r * (maxPerDay - minPerDay) * 0.4;
        means.push(Math.round(rate));
      }
    }
    
    return means;
  }

  // Generate message events across hours with temporal patterns
  function generateEventsForHours(userRates, hours, opts = {}) {
    const {
      epochStartMs = Date.now(),
      hourLengthMs = 60 * 60 * 1000
    } = opts;

    const events = [];

    for (let hour = 0; hour < hours; hour++) {
      const hourStart = epochStartMs + hour * hourLengthMs;
      const currentHour = (8 + hour) % 24;  // start at 8am
      const activityMultiplier = campusActivityPattern[currentHour];

      for (let userId = 0; userId < userRates.length; userId++) {
        const baseRate = userRates[userId] / 24;
        const adjustedRate = baseRate * activityMultiplier;
        
        // Poisson-like: probability of messaging this hour
        if (rng() < Math.min(0.8, adjustedRate)) {
          const numMessages = 1 + Math.floor(rng() * 3);
          
          for (let msg = 0; msg < numMessages; msg++) {
            const timeOffset = rng() * hourLengthMs;
            events.push({
              userId: userId,
              t: hourStart + timeOffset
            });
          }
        }
      }
    }

    return events.sort((a, b) => a.t - b.t);
  }

  return {
    sampleUserMeans,
    generateEventsForHours,
    // Convenience wrapper for multi-day simulations
    generateEventsForDays: (userRates, days = 1, opts = {}) => {
      return generateEventsForHours(userRates, days * 12, opts);
    }
  };
}