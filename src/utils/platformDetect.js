/**
 * Detect the platform from a course URL.
 * Returns { id, name, icon } or { id: 'custom', name: 'Custom', icon: null }
 */

const PLATFORMS = [
  {
    id: 'udemy',
    name: 'Udemy',
    icon: 'U',
    patterns: [
      /udemy\.com/i
    ]
  },
  {
    id: 'coursera',
    name: 'Coursera',
    icon: 'C',
    patterns: [
      /coursera\.org/i
    ]
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: 'Y',
    patterns: [
      /youtube\.com/i,
      /youtu\.be/i
    ]
  },
  {
    id: 'hahow',
    name: 'Hahow',
    icon: 'H',
    patterns: [
      /hahow\.in/i
    ]
  },
  {
    id: 'skillshare',
    name: 'Skillshare',
    icon: 'S',
    patterns: [
      /skillshare\.com/i
    ]
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Learning',
    icon: 'L',
    patterns: [
      /linkedin\.com\/learning/i
    ]
  },
  {
    id: 'pluralsight',
    name: 'Pluralsight',
    icon: 'P',
    patterns: [
      /pluralsight\.com/i
    ]
  }
];

export const detectPlatform = (url) => {
  if (!url || typeof url !== 'string') {
    return { id: 'custom', name: 'Custom', icon: null };
  }

  for (const platform of PLATFORMS) {
    for (const pattern of platform.patterns) {
      if (pattern.test(url)) {
        return {
          id: platform.id,
          name: platform.name,
          icon: platform.icon
        };
      }
    }
  }

  return { id: 'custom', name: 'Custom', icon: null };
};

export const getPlatformIcon = (platformId) => {
  const platform = PLATFORMS.find(p => p.id === platformId);
  return platform?.icon || null;
};

export const getPlatformColor = (platformId) => {
  const colors = {
    udemy: '#A435F0',
    coursera: '#0056D2',
    youtube: '#FF0000',
    hahow: '#00C3FF',
    skillshare: '#00FF84',
    linkedin: '#0A66C2',
    pluralsight: '#E80A89',
    custom: '#6B7280'
  };
  return colors[platformId] || colors.custom;
};
