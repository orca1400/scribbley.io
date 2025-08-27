# AI Book Generator - Project Overview

## 🏗️ Architecture

This is a full-stack AI-powered book generation platform built with React, TypeScript, Supabase, and OpenAI integration.

### Tech Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS + Vite
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **AI**: OpenAI GPT-4o-mini for text generation and DALL-E for covers
- **Payments**: Stripe integration with webhooks
- **Authentication**: Supabase Auth with email/password

## 🎯 Core Features

### 1. **Book Generation**
- **Guest Mode**: Try the service without signup (1 free 5-chapter book)
- **Authenticated Mode**: Full dashboard with project management
- **Dual Generation**: Simultaneous book content + cover generation
- **Chapter-by-Chapter**: Generate individual chapters with continuity
- **Multiple Genres**: Fiction and Non-Fiction with subgenre targeting

### 2. **Smart Content Management**
- **Chapter Summaries**: Auto-generated summaries for story continuity
- **Content Parsing**: Intelligent chapter detection and formatting
- **Rewrite System**: Select text and rewrite with AI assistance
- **Export**: PDF generation for finished books

### 3. **Plan-Based Limits**
- **Free**: 20K words/month, 5 chapters/book, 3 projects
- **Pro**: 500K words/month, 50 chapters/book, 10 projects, rewrites
- **Premium**: 2M words/month, 100 chapters/book, 20 projects, extra-long chapters

## 🔧 Key Components

### Frontend Architecture (`src/`)

```
src/
├── components/           # Reusable UI components
│   ├── AuthModal.tsx    # Login/signup with consent
│   ├── Dashboard.tsx    # Main user dashboard
│   ├── BookEditor.tsx   # Chapter editing interface
│   ├── SettingsPanel.tsx # User preferences & privacy
│   └── BackupPanel.tsx  # Data backup/restore
├── hooks/               # Custom React hooks
│   ├── useUserProfile.ts # Profile + usage tracking
│   ├── useEntitlements.ts # Server-side plan verification
│   └── useBackupScheduler.ts # Auto-backup scheduling
├── lib/                 # Core utilities
│   ├── supabase.ts     # Database client setup
│   ├── session.ts      # Guest/user session management
│   ├── usage.ts        # Usage tracking & billing
│   └── billing.ts      # Stripe integration
├── services/           # Business logic
│   ├── generation.ts   # AI content generation
│   ├── covers.ts       # Cover generation & management
│   └── backup.ts       # Data backup/restore
└── utils/              # Helper functions
    ├── bookParser.ts   # Chapter extraction from AI output
    └── coverPrompt.ts  # Cover prompt engineering
```

### Backend Architecture (`supabase/`)

```
supabase/
├── functions/          # Edge Functions (Deno runtime)
│   ├── generate-book/  # Main book generation
│   ├── generate-chapter/ # Individual chapter generation
│   ├── generate-cover/ # Cover image generation
│   ├── rewrite-passage/ # Text rewriting
│   ├── get-entitlements/ # Plan verification
│   ├── stripe-webhook/ # Payment processing
│   └── automated-backup/ # System backups
└── migrations/         # Database schema evolution
    └── *.sql          # Progressive schema updates
```

## 🔄 Data Flow

### 1. **Guest User Journey**
```
Landing Page → Genre Selection → Description Input → 
AI Generation (Book + Cover) → Preview → Signup Prompt
```

### 2. **Authenticated User Journey**
```
Dashboard → New Book → AI Generation → 
Chapter Editor → Add Chapters → Export PDF
```

### 3. **AI Generation Pipeline**
```
User Input → Session Tracking → Consent Check → 
Usage Limits → OpenAI API → Content Processing → 
Database Storage → Real-time Updates
```

## 🛡️ Security & Privacy

### Authentication & Authorization
- **JWT-based auth** with Supabase
- **Row Level Security (RLS)** on all tables
- **Server-side plan verification** via Edge Functions
- **Demo user bypass** for testing

### Privacy Compliance
- **GDPR consent** required for signup
- **AI processing consent** with versioning
- **Data retention settings** (30 days to never)
- **Training opt-out** available
- **Complete data export** and account deletion

### Rate Limiting
- **IP-based limits** for guests (5 requests/minute)
- **Plan-based limits** for authenticated users
- **Usage tracking** with monthly quotas
- **Abuse prevention** via session management

## 💳 Billing Integration

### Stripe Setup
- **Subscription management** with Pro/Premium tiers
- **Webhook processing** for real-time plan updates
- **Billing portal** for payment method management
- **Prorated upgrades** and downgrades

### Usage Tracking
- **Real-time word counting** with Europe/Vienna timezone
- **Billable vs free usage** separation
- **Guest freebie system** (1 free book per session)
- **Email alerts** at 80% and 100% usage

## 🗄️ Database Design

### Core Tables
- **`users`** - Supabase auth users
- **`user_profiles`** - Extended user data + plan info
- **`user_books`** - Book projects with metadata
- **`chapter_summaries`** - AI-generated chapter summaries
- **`sessions`** - Guest/user session tracking
- **`usage_events`** - Detailed usage logging

### Supporting Tables
- **`plans`** - Plan definitions with Stripe price IDs
- **`user_subscriptions`** - Stripe subscription details
- **`book_covers`** - Cover generation attempts
- **`system_backups`** - Automated backup logging

## 🚀 Deployment & Operations

### Development Workflow
1. **Local development** in WebContainer
2. **Edge Function testing** via local Supabase
3. **Manual deployment** to Supabase project
4. **Stripe webhook testing** with ngrok/test mode

### Production Considerations
- **Environment variables** properly configured
- **Stripe webhooks** pointing to production URLs
- **Database migrations** applied in order
- **Edge Functions** deployed and monitored

## 🔍 Key Features Deep Dive

### Guest Experience
- **No signup required** for first book
- **Session-based tracking** with cookies
- **Seamless upgrade path** to authenticated account
- **Data preservation** when converting to account

### Content Generation
- **Prompt engineering** for consistent quality
- **Genre-specific templates** and structures
- **Continuity management** via chapter summaries
- **Multiple generation modes** (full book vs chapter-by-chapter)

### Cover Generation
- **Simultaneous generation** with book content
- **Plan-based reroll limits** (Pro: 1, Premium: 2)
- **Storage optimization** (guests get base64, users get URLs)
- **Fallback handling** for generation failures

## 📊 Monitoring & Analytics

### Usage Tracking
- **Word count monitoring** per user/month
- **Feature usage analytics** (book vs chapter vs rewrite)
- **Plan conversion tracking** (guest → free → paid)
- **Error logging** and performance metrics

### Backup System
- **Manual user backups** (complete data export)
- **Automated system backups** (scheduled via Edge Functions)
- **Point-in-time recovery** capabilities
- **Data validation** and integrity checks

## 🎨 UI/UX Design

### Design System
- **Tailwind CSS** for consistent styling
- **Lucide React** icons throughout
- **Responsive design** (mobile-first)
- **Apple-level aesthetics** with micro-interactions

### User Experience
- **Progressive disclosure** (simple → advanced features)
- **Real-time feedback** during generation
- **Contextual help** and onboarding
- **Graceful error handling** with user-friendly messages

This architecture provides a scalable, secure, and user-friendly platform for AI-assisted book creation with proper billing, privacy compliance, and operational monitoring.