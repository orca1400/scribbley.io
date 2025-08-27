export const PLAN_LIMITS = {
  free: {
    name: 'Free',
    monthly_words: 20000,
    projects_limit: 3,
    rewrites_unlimited: false,
  },
  pro: {
    name: 'Pro',
    monthly_words: 500000,
    projects_limit: 10,
    rewrites_unlimited: true,
  },
  premium: {
    name: 'Premium',
    monthly_words: 2000000,
    projects_limit: 20,
    rewrites_unlimited: true,
  },
} as const;

export type PlanTier = keyof typeof PLAN_LIMITS;
