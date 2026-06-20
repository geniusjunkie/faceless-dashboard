/**
 * niches.js — Niche configuration
 *
 * Each niche defines:
 *  - keywords:    YouTube search queries to find relevant videos/channels
 *  - rpm:         Estimated RPM range in USD (from industry research)
 *  - section:     Which dashboard section this niche feeds into
 *  - minLenMin:   Minimum acceptable average video length (minutes)
 *  - maxLenMin:   Maximum acceptable average video length (minutes)
 *
 * To add a new niche: copy a block, change the fields, add to the array.
 */

module.exports = [
  {
    id: 'finance',
    label: 'Personal Finance',
    section: 'vidrush',
    keywords: [
      'passive income investing documentary explained',
      'how to build wealth financial freedom story',
      'investing for beginners money documentary',
    ],
    rpm: { min: 12, max: 18, median: 14.2 },
    minLenMin: 15,
    maxLenMin: 45,
  },
  {
    id: 'military',
    label: 'Military History',
    section: 'military',
    keywords: [
      'military history documentary battle explained',
      'special forces history elite units documentary',
      'world war history breakdown tactics documentary',
      'ancient warfare history battles explained',
    ],
    rpm: { min: 6, max: 12, median: 8.6 },
    minLenMin: 18,
    maxLenMin: 50,
  },
  {
    id: 'history',
    label: 'History Documentary',
    section: 'vidrush',
    keywords: [
      'ancient history documentary facts explained',
      'forgotten history story documentary',
      'historical mystery documentary investigation',
    ],
    rpm: { min: 7, max: 11, median: 9.0 },
    minLenMin: 18,
    maxLenMin: 45,
  },
  {
    id: 'true_crime',
    label: 'True Crime',
    section: 'vidrush',
    keywords: [
      'true crime documentary investigation case',
      'unsolved mystery cold case story',
      'criminal case documentary investigation',
    ],
    rpm: { min: 5, max: 10, median: 7.0 },
    minLenMin: 20,
    maxLenMin: 50,
  },
  {
    id: 'business',
    label: 'Business Documentary',
    section: 'vidrush',
    keywords: [
      'business rise fall documentary story',
      'company history documentary explained',
      'startup failure success story documentary',
    ],
    rpm: { min: 8, max: 14, median: 10.5 },
    minLenMin: 18,
    maxLenMin: 45,
  },
  {
    id: 'psychology',
    label: 'Psychology / Behaviour',
    section: 'vidrush',
    keywords: [
      'dark psychology documentary explained human behavior',
      'narcissism psychology story documentary',
      'manipulation psychology explained documentary',
    ],
    rpm: { min: 8, max: 13, median: 10.0 },
    minLenMin: 18,
    maxLenMin: 45,
  },
  {
    id: 'ai_tech',
    label: 'AI / Technology',
    section: 'vidrush',
    keywords: [
      'artificial intelligence explained documentary',
      'AI future technology story documentary',
      'tech company story documentary explained',
    ],
    rpm: { min: 10, max: 16, median: 12.5 },
    minLenMin: 18,
    maxLenMin: 45,
  },
  {
    id: 'sleep',
    label: 'Sleep / Calm Narration',
    section: 'sleep',
    keywords: [
      'sleep story bedtime adults calm narration',
      'calm history sleep documentary bedtime',
      'sleep meditation guided relaxation story',
      'boring history bedtime sleep narration',
    ],
    rpm: { min: 3, max: 7, median: 5.2 },
    minLenMin: 45,
    maxLenMin: 720, // up to 12-hour ambient
  },
];
