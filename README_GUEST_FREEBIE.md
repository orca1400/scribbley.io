# Guest Freebie Feature Implementation

## Overview
This feature allows guest users to generate their first 5-chapter book for free without it counting toward their monthly word quota. Once they sign up, the usage tracking continues seamlessly.

## Database Schema

### Sessions Table
- `id`: UUID primary key
- `user_id`: Nullable UUID (links to users table)
- `is_guest`: Boolean (default true)
- `has_consumed_guest_freebie`: Boolean (default false)
- `created_at`, `updated_at`: Timestamps

### Usage Events Table
- `id`: UUID primary key
- `user_id`: Nullable UUID (links to users table)
- `session_id`: UUID (links to sessions table)
- `feature`: Text (e.g., 'book_5_chapters')
- `words`: Integer
- `tokens`: Integer
- `billable`: Boolean
- `reason`: Text (e.g., 'guest_free_book', 'regular')
- `created_at`: Timestamp

## Key Components

### 1. Session Management (`src/lib/session.ts`)
- `getOrCreateSession()`: Gets or creates session for current user/guest
- Handles cookie-based session tracking for guests
- Links guest sessions to user accounts upon login
- 1-year cookie expiry with HTTPOnly, SameSite=Lax

### 2. Usage Tracking (`src/lib/usage.ts`)
- `recordUsage()`: Records usage events with automatic billability determination
- `getBillableWordsThisMonth()`: Gets billable word usage for current month
- `getFreeWordsThisMonth()`: Gets free word usage for current month
- Uses Europe/Vienna timezone for monthly calculations

### 3. API Integration
- Updated `generate-book` function to record usage
- Passes session ID and user ID via headers
- Calculates word count and estimated tokens
- Records usage event after successful generation

### 4. Dashboard Integration
- Real-time usage tracking via `useUserProfile` hook
- Shows both billable and free usage
- Updates usage percentage based on real-time data

## Usage Flow

### Guest User Flow
1. Guest visits site → Session created with cookie
2. Generates first book → Marked as free (`billable=false`)
3. `has_consumed_guest_freebie` set to `true`
4. Subsequent generations are billable (but blocked for guests)

### Authenticated User Flow
1. User logs in → Existing guest session linked to account
2. All previous usage events updated with user ID
3. Normal billable usage tracking continues

## Integration Points

### Frontend
```typescript
// In book generation
const session = await getOrCreateSession();
const headers = {
  'x-session-id': session.id,
  'x-user-id': user?.id
};
```

### Backend (Edge Function)
```typescript
// In generate-book function
const sessionId = req.headers.get('x-session-id');
const userId = req.headers.get('x-user-id');

// After generation
await recordBookUsage(sessionId, userId, wordCount, estimatedTokens);
```

### Dashboard
```typescript
// Real-time usage display
const { realTimeUsage } = useUserProfile(user.id);
const wordsUsed = realTimeUsage?.billableWords ?? profile.words_used_this_month;
```

## Security Considerations

1. **RLS Policies**: Proper row-level security on both tables
2. **Cookie Security**: HTTPOnly, SameSite=Lax, 1-year expiry
3. **Session Validation**: Server-side session validation
4. **Abuse Prevention**: One freebie per session/device

## TODO for Full Integration

1. **Environment Variables**: Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
2. **Migration**: Run the database migration
3. **Testing**: Test guest flow, login linking, and usage tracking
4. **Monitoring**: Add logging for usage events and session management
5. **Analytics**: Optional analytics dashboard for usage patterns

## Edge Cases Handled

1. **Guest starts freebie, logs in mid-generation**: Session linking preserves freebie status
2. **Multiple browser sessions**: Each gets own session cookie
3. **Session expiry**: New session created automatically
4. **Failed usage recording**: Book generation continues (non-blocking)
5. **Timezone handling**: Consistent Europe/Vienna timezone for monthly calculations

## Monitoring Queries

```sql
-- Check guest freebie usage
SELECT COUNT(*) as guest_freebies 
FROM usage_events 
WHERE reason = 'guest_free_book';

-- Monthly billable words by user
SELECT user_id, SUM(words) as billable_words
FROM usage_events 
WHERE billable = true 
  AND created_at >= date_trunc('month', CURRENT_DATE)
GROUP BY user_id;

-- Session conversion rate
SELECT 
  COUNT(CASE WHEN is_guest = false THEN 1 END) as converted,
  COUNT(*) as total_sessions,
  ROUND(COUNT(CASE WHEN is_guest = false THEN 1 END) * 100.0 / COUNT(*), 2) as conversion_rate
FROM sessions;
```